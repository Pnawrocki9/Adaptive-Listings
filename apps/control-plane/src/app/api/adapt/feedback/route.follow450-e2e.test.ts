/**
 * End-to-end route-driven PGlite test for FOLLOW-450 AC4.
 *
 * Chains the ACTUAL production route handlers — `POST /api/adapt` (production
 * adaptation endpoint) then `POST /api/adapt/feedback` (bandit/conversion-label
 * loop, ADR-0015) — against a real in-memory Postgres engine (PGlite), driven
 * by a REAL registered tenant API key (not the `ADAPT_API_KEY` ops bypass).
 *
 * This proves the full chain the ticket asks for:
 *
 *   adapt (POST /api/adapt, real API-key auth via resolveApiKey())
 *     → adapt_decision_id + variant returned to the caller
 *   → outcome event (simulated: caller observed a conversion for that decision)
 *   → feedback ping (POST /api/adapt/feedback, SAME real API key)
 *     → conversion_labels row keyed to adapt_decision_id
 *     → ab_bandit_weights row updated for (archetype, variant)
 *
 * "resolved (not body) tenant" (AC4 wording): both routes resolve tenant_id
 * from the SHA-256(bearer) → `api_keys` lookup (`resolveApiKey()`, ADR-0015) —
 * never from a request-body field. Every assertion below reads rows keyed by
 * `TENANT_ID` (the row `resolveApiKey()` actually returned), not by any
 * caller-supplied value. A WHERE-clause or auth-resolution regression in
 * either route (e.g. reverting to `body.tenant_id`) breaks this test.
 *
 * Rule T compliance: imports the real POST handlers from `./route` (feedback)
 * and `../route` (adapt) — no handler logic is re-implemented or mocked.
 * Only non-DB dependencies unrelated to auth/DB-write correctness (LLM
 * gateway, RAG retrieval, embeddings, tenant schema, bandit-arm sampling,
 * A/B holdout assignment) are mocked, following the same pattern as
 * `route.follow451.test.ts` (POST /api/adapt auth-matrix suite).
 *
 * @vitest-environment node
 *
 * Why node environment?
 *   PGlite (WebAssembly Postgres) requires the Node.js WebAssembly runtime,
 *   unavailable reliably under the package's default jsdom environment.
 *
 * @module apps/control-plane/src/app/api/adapt/feedback/route.follow450-e2e.test
 */

import { NextRequest } from 'next/server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';

// ─── PGlite factory reference (hoisting workaround, mirrors
// crm/outcome/route-driven-pglite.test.ts) ─────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- PGlite db; schema type is wide
let _testDb: ReturnType<typeof drizzlePglite<any>> | null = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- same reason
function getTestDb(): ReturnType<typeof drizzlePglite<any>> {
  if (!_testDb) throw new Error('PGlite test DB not initialised — is beforeAll() running?');
  return _testDb;
}

// ─── Module mocks (hoisted) ─────────────────────────────────────────────────

// @estalara/db: real schema + real query builder, only createAdminClient swapped
// for the PGlite-backed client. Both route.ts (adapt) and api-key-auth.ts
// (resolveApiKey, shared by both routes) call createAdminClient() at request
// time, so this single override covers auth resolution AND the bandit/label
// writes.
vi.mock('@estalara/db', async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports -- vi.mock importOriginal generic requires inline import() type
  const real = await importOriginal<typeof import('@estalara/db')>();
  return {
    ...real,
    createAdminClient: () => getTestDb(),
  };
});

// drizzle-orm is NOT mocked — real `and`/`eq`/`isNull`/`or`/`gt` are required to
// generate real SQL against PGlite (unlike route.follow451.test.ts, which fully
// mocks @estalara/db and therefore also fakes drizzle-orm's operators).

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

// ─── Non-DB dependencies of POST /api/adapt, mocked exactly as in
// route.follow451.test.ts — none of these affect tenant resolution or the
// DB-write path under test here. ───────────────────────────────────────────

vi.mock('@/lib/llm-gateway', () => ({
  callLlmGateway: vi.fn().mockResolvedValue(null),
}));

vi.mock('@estalara/auth', () => ({
  getAuthClaims: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/bandit-query', () => ({
  SEED_VARIANTS: ['control', 'v1', 'v2'] as const,
  getBanditArms: vi
    .fn()
    .mockResolvedValue([{ variant: 'control', alpha: 1, beta: 1, paused: false }]),
}));

vi.mock('@/lib/rag-retrieval', () => ({
  retrieveListingContext: vi.fn().mockResolvedValue({}),
}));

vi.mock('@/lib/tenant-schema', () => ({
  getTenantSchema: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/embedding-lookup', () => ({
  fetchArchetypeEmbedding: vi.fn().mockResolvedValue(null),
  fetchListingEmbeddings: vi.fn().mockResolvedValue(new Map()),
  LISTING_EMBEDDING_BATCH_LIMIT: 20,
}));

vi.mock('@/lib/demo-override-store', () => ({
  getDemoOverride: vi.fn().mockResolvedValue({
    enabled: false,
    overrideArchetype: null,
    overrideModel: 'claude-sonnet-4-6',
  }),
  DEMO_OVERRIDE_CONFIDENCE: 0.95,
  DEMO_OVERRIDE_SIMILARITY: 0.75,
}));

// assignHoldout / thompsonSample from @estalara/shared are overridden to a
// deterministic treatment-arm assignment + fixed 'control' variant so the
// response carries a predictable adapt_decision_id/variant pair to chain into
// the feedback ping. Every other @estalara/shared export (errorBody,
// updateBanditArm, outcomeClassFromConverted, computeCosineSimilarity, …) is
// real — both route handlers use them for real.
vi.mock('@estalara/shared', async () => {
  const mod = await vi.importActual<Record<string, unknown>>('@estalara/shared');
  return {
    ...mod,
    assignHoldout: vi.fn().mockResolvedValue({
      holdout_group: false,
      skipped: false,
      assigned_at: new Date().toISOString(),
    }),
    thompsonSample: vi.fn().mockReturnValue('control'),
  };
});

// ─── Fixture DDL — tenants, api_keys, conversion_labels, ab_bandit_weights ──

const FIXTURE_DDL = /* sql */ `
  CREATE TABLE IF NOT EXISTS tenants (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name       text NOT NULL,
    slug       text NOT NULL UNIQUE,
    status     text NOT NULL DEFAULT 'pending',
    plan       text NOT NULL DEFAULT 'free',
    allowed_origins text[] NOT NULL DEFAULT '{}',
    brand_config jsonb DEFAULT '{}',
    quiz_config  jsonb DEFAULT '{}',
    consent_required boolean NOT NULL DEFAULT true,
    pilot_frozen     boolean NOT NULL DEFAULT false,
    quiz_enabled     boolean NOT NULL DEFAULT false,
    profile_mode_enabled    boolean NOT NULL DEFAULT false,
    profile_mode_enabled_at timestamptz,
    profile_mode_enabled_by uuid,
    stripe_customer_id      text UNIQUE,
    stripe_subscription_id  text UNIQUE,
    registration_id uuid,
    approved_by     uuid,
    approved_at     timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz
  );

  CREATE TABLE IF NOT EXISTS api_keys (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    type          text NOT NULL,
    prefix        text NOT NULL,
    hashed_key    text NOT NULL UNIQUE,
    last_4        text NOT NULL,
    scopes        text[] NOT NULL DEFAULT '{}',
    allowed_origins text[],
    created_by    uuid,
    created_at    timestamptz NOT NULL DEFAULT now(),
    expires_at    timestamptz,
    last_used_at  timestamptz,
    rotated_at    timestamptz,
    revoked_at    timestamptz,
    revoke_reason text
  );

  CREATE TABLE IF NOT EXISTS conversion_labels (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    prediction_id text NOT NULL,
    lead_id       text NOT NULL DEFAULT '',
    outcome_class text NOT NULL,
    outcome_raw   jsonb,
    labeled_at    timestamptz NOT NULL DEFAULT now(),
    label_source  text NOT NULL,
    confidence    real,
    notes         text,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
  );

  CREATE UNIQUE INDEX IF NOT EXISTS conversion_labels_tenant_prediction_unique
    ON conversion_labels (tenant_id, prediction_id);

  CREATE TABLE IF NOT EXISTS ab_bandit_weights (
    tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    archetype  text NOT NULL,
    variant    text NOT NULL,
    alpha      double precision NOT NULL DEFAULT 1.0,
    beta       double precision NOT NULL DEFAULT 1.0,
    paused     boolean NOT NULL DEFAULT false,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, archetype, variant)
  );
`;

// ─── Suite globals ───────────────────────────────────────────────────────────

let pg: PGlite;
let TENANT_ID: string;
let OTHER_TENANT_ID: string;

const RAW_API_KEY = 'sk_live_follow450_e2e_key';

async function sha256Hex(input: string): Promise<string> {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(input));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

beforeAll(async () => {
  pg = new PGlite();
  await pg.waitReady;
  await pg.exec(FIXTURE_DDL);

  _testDb = drizzlePglite(pg);

  const tenantRow = await pg.query<{ id: string }>(
    `INSERT INTO tenants (name, slug) VALUES ('FOLLOW-450 E2E Tenant', 'follow450-e2e') RETURNING id`,
  );
  TENANT_ID = tenantRow.rows[0]!.id;

  const otherTenantRow = await pg.query<{ id: string }>(
    `INSERT INTO tenants (name, slug) VALUES ('FOLLOW-450 Other Tenant', 'follow450-other') RETURNING id`,
  );
  OTHER_TENANT_ID = otherTenantRow.rows[0]!.id;

  const hashedKey = await sha256Hex(RAW_API_KEY);
  await pg.query(
    `INSERT INTO api_keys (tenant_id, type, prefix, hashed_key, last_4)
     VALUES ($1, 'secret', 'sk_live_', $2, $3)`,
    [TENANT_ID, hashedKey, RAW_API_KEY.slice(-4)],
  );
}, 30_000); // PGlite WASM cold-start can exceed vitest's 10s default hookTimeout when
// several other PGlite-backed suites (crm/outcome, dsr/erase, dsr/disclosure) run
// concurrently in the same full-suite invocation and contend for CPU.

afterAll(async () => {
  _testDb = null;
  await pg.close();
});

beforeEach(async () => {
  await pg.exec('DELETE FROM conversion_labels');
  await pg.exec('DELETE FROM ab_bandit_weights');
  vi.stubEnv('CLICKHOUSE_URL', '');
  vi.stubEnv('DATABASE_URL_ADMIN', 'postgresql://localhost/test');
  // Bearer token is not JWT-shaped (no dots) → verifyDemoJwt throws
  // DemoJwtInvalidError → falls through to the real API-key path.
  vi.stubEnv('DEMO_MODE_JWT_SECRET', 'unrelated-demo-secret-32-chars-long!!');
  vi.stubEnv('ADAPT_API_KEY', ''); // force the feedback route's non-ops path too
  vi.stubEnv('FEEDBACK_ENDPOINT_ENABLED', 'true');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ─── Import the ACTUAL production route handlers ────────────────────────────

import { POST as postAdapt } from '../route';
import { POST as postFeedback } from './route';

async function computeHmac(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function makeAdaptRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/adapt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RAW_API_KEY}` },
    body: JSON.stringify(body),
  });
}

async function makeFeedbackRequest(body: Record<string, unknown>): Promise<NextRequest> {
  const bodyStr = JSON.stringify(body);
  const sig = await computeHmac(RAW_API_KEY, bodyStr);
  return new NextRequest('http://localhost/api/adapt/feedback', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${RAW_API_KEY}`,
      'X-Estalara-Signature': sig,
    },
    body: bodyStr,
  });
}

/** Drain the Node.js microtask + I/O queue so afterResponse's fallback fire-and-forget completes. */
async function drainMicrotasks(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

async function getBanditRow(
  tenantId: string,
  archetype: string,
  variant: string,
): Promise<{ alpha: number; beta: number } | undefined> {
  const res = await pg.query<{ alpha: number; beta: number }>(
    `SELECT alpha, beta FROM ab_bandit_weights WHERE tenant_id = $1 AND archetype = $2 AND variant = $3`,
    [tenantId, archetype, variant],
  );
  return res.rows[0];
}

async function getLabel(
  tenantId: string,
  predictionId: string,
): Promise<
  { outcome_class: string; tenant_id: string; label_source: string; confidence: number } | undefined
> {
  const res = await pg.query<{
    outcome_class: string;
    tenant_id: string;
    label_source: string;
    confidence: number;
  }>(
    `SELECT outcome_class, tenant_id, label_source, confidence FROM conversion_labels
      WHERE tenant_id = $1 AND prediction_id = $2`,
    [tenantId, predictionId],
  );
  return res.rows[0];
}

// ─── FOLLOW-450 AC4: adapt → outcome event → feedback ping → DB writes ──────

describe('FOLLOW-450 AC4: adapt → outcome event → feedback ping, all under the resolved (not body) tenant', () => {
  it('POST /api/adapt (real API key) then POST /api/adapt/feedback (same key) updates ab_bandit_weights and writes a conversion_labels row keyed to the resolved tenant', async () => {
    // ── Step 1: adapt — drives the REAL POST /api/adapt handler. Auth resolves
    // TENANT_ID from the api_keys row via resolveApiKey() (ADR-0015 / FOLLOW-451),
    // NOT from body.tenant_id (which is set to the SAME tenant here — the
    // cross-tenant-mismatch case is covered separately below).
    const adaptRes = await postAdapt(
      makeAdaptRequest({
        tenant_id: TENANT_ID,
        session_id: 'sess-follow450-e2e-001',
        page_type: 'listing_detail',
        archetype_hint: 'family_buyer',
        confidence: 0.5, // <= CONFIDENCE_THRESHOLD → Branch 1 (no LLM call needed)
        similarity: 0.5,
      }),
    );
    expect(adaptRes.status).toBe(200);
    const adaptBody = (await adaptRes.json()) as {
      adapt_decision_id: string;
      archetype: string;
      variant?: string;
    };
    expect(typeof adaptBody.adapt_decision_id).toBe('string');
    expect(adaptBody.archetype).toBe('family_buyer');
    // thompsonSample is mocked to return 'control' deterministically.
    expect(adaptBody.variant).toBe('control');

    // ── Step 2: outcome event (simulated) — the caller observed a conversion
    // for this adapt_decision_id. The SDK's outcome-event listener would fire
    // postFeedbackPing() with exactly these fields (archetype, variant,
    // prediction_id = adapt_decision_id) — see packages/sdk/src/core/adapt.ts.
    //
    // ── Step 3: feedback ping — drives the REAL POST /api/adapt/feedback
    // handler with the SAME registered API key (non-ops resolveApiKey path).
    const feedbackRes = await postFeedback(
      await makeFeedbackRequest({
        session_id: 'sess-follow450-e2e-001',
        tenant_id: TENANT_ID,
        archetype: adaptBody.archetype,
        variant: adaptBody.variant,
        converted: true,
        prediction_id: adaptBody.adapt_decision_id,
      }),
    );
    expect(feedbackRes.status).toBe(202);

    // Fire-and-forget writes (updateArmAsync + upsertConversionLabelAsync) run
    // via afterResponse()'s non-request-scope fallback — drain to let them land.
    await drainMicrotasks();

    // ── Step 4: bandit update — ab_bandit_weights row for (TENANT_ID,
    // family_buyer, control) moved from the Beta(1,1) default to Beta(2,1)
    // (alpha += 1 on converted=true), exactly the real updateBanditArm() math.
    const banditRow = await getBanditRow(TENANT_ID, 'family_buyer', 'control');
    expect(banditRow).toBeDefined();
    expect(banditRow!.alpha).toBe(2);
    expect(banditRow!.beta).toBe(1);

    // ── Step 5: conversion_labels row — keyed to adapt_decision_id, under the
    // RESOLVED tenant (TENANT_ID from resolveApiKey()), not a body field.
    const label = await getLabel(TENANT_ID, adaptBody.adapt_decision_id);
    expect(label).toBeDefined();
    expect(label!.tenant_id).toBe(TENANT_ID);
    expect(label!.outcome_class).toBe('viewing_booked'); // outcomeClassFromConverted(true)
    expect(label!.label_source).toBe('system');
    expect(label!.confidence).toBe(1.0);
  });

  it('a feedback ping whose body.tenant_id names a DIFFERENT tenant than the resolved key is rejected 403 and writes nothing — proves writes are resolved-tenant-scoped, not body-scoped', async () => {
    const adaptRes = await postAdapt(
      makeAdaptRequest({
        tenant_id: TENANT_ID,
        session_id: 'sess-follow450-e2e-crosstenant',
        page_type: 'listing_detail',
        archetype_hint: 'yield_hunter',
        confidence: 0.5,
        similarity: 0.5,
      }),
    );
    expect(adaptRes.status).toBe(200);
    const adaptBody = (await adaptRes.json()) as { adapt_decision_id: string; archetype: string };

    // The RAW_API_KEY resolves to TENANT_ID (per api_keys row), but the body
    // claims OTHER_TENANT_ID — the same forged-body attack ADR-0015 closes.
    const feedbackRes = await postFeedback(
      await makeFeedbackRequest({
        session_id: 'sess-follow450-e2e-crosstenant',
        tenant_id: OTHER_TENANT_ID,
        archetype: adaptBody.archetype,
        variant: 'control',
        converted: true,
        prediction_id: adaptBody.adapt_decision_id,
      }),
    );
    expect(feedbackRes.status).toBe(403);
    await drainMicrotasks();

    // Neither tenant's bandit row nor conversion_labels row was written.
    expect(await getBanditRow(TENANT_ID, 'yield_hunter', 'control')).toBeUndefined();
    expect(await getBanditRow(OTHER_TENANT_ID, 'yield_hunter', 'control')).toBeUndefined();
    expect(await getLabel(TENANT_ID, adaptBody.adapt_decision_id)).toBeUndefined();
    expect(await getLabel(OTHER_TENANT_ID, adaptBody.adapt_decision_id)).toBeUndefined();
  });
});
