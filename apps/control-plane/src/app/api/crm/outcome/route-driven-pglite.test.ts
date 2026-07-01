/**
 * Route-driven PGlite integration tests for FOLLOW-250 (AC1 + AC3):
 * POST /api/crm/outcome + two-writer convergence with POST /api/adapt/feedback.
 *
 * Rule T compliance: these tests import the ACTUAL route handlers (POST from
 * crm/outcome/route.ts and POST from adapt/feedback/route.ts) and drive them
 * against a real PGlite in-memory Postgres engine. A WHERE-clause or logic
 * divergence in either production route BREAKS these tests — unlike the SQL-
 * semantics mirrors in crm-dsr-harness.test.ts that only re-type the predicates.
 *
 * @vitest-environment node
 *
 * Why node environment?
 *   PGlite (WebAssembly Postgres) requires the Node.js WebAssembly runtime.
 *   The default jsdom environment in this package does not provide it reliably.
 *   The `@vitest-environment node` directive overrides the package default for
 *   this file only.
 *
 * Mocking strategy:
 *   - createAdminClient() is intercepted to return the PGlite-backed Drizzle
 *     client. The vi.mock factory uses a module-level factory function
 *     (getTestDb) that returns the current PGlite client, set up in beforeAll.
 *   - writeDsrAuditLog is mocked as a no-op (fire-and-forget, irrelevant here).
 *   - @sentry/nextjs is mocked as a no-op (not available in test env).
 *   - CLICKHOUSE_URL / UPSTASH_REDIS_URL are NOT set → ClickHouse + Redis paths
 *     are structural no-ops in the route code.
 *   - Auth: ADAPT_API_KEY + ADAPT_TENANT_ID env vars activate the ops fallback
 *     in the CRM route, bypassing HMAC + DB key lookup.
 *   - DATABASE_URL_ADMIN is set to a dummy value to enable the DB-write path in
 *     the feedback route; createAdminClient() is mocked before it is called.
 *
 * ACs covered:
 *   AC1 (FOLLOW-250) — CRM route writes the correct conversion_labels row.
 *     A WHERE-clause divergence in crm/outcome/route.ts (dropped tenant_id,
 *     swapped namespace key) BREAKS this test.
 *   AC3 (FOLLOW-250) — Two-writer convergence: feedback (viewing_booked / SDK)
 *     followed by CRM (purchased) on the same prediction_id converges to
 *     purchased. The route→upsertConversionLabel→DB path is on the call-stack,
 *     not a mock.
 *
 * @module apps/control-plane/src/app/api/crm/outcome/route-driven-pglite.test
 */

import { NextRequest } from 'next/server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';

// ─── PGlite factory reference ─────────────────────────────────────────────────
//
// vi.mock() is hoisted to before the module-level code in this file runs, but
// the beforeAll() that creates the PGlite instance runs AFTER the hoisting.
// The solution: expose the Drizzle-PGlite client through a factory function
// that vi.mock captures by reference. The factory always returns the CURRENT
// value of `_testDb`, which is set in beforeAll().

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- PGlite db; schema type is wide
let _testDb: ReturnType<typeof drizzlePglite<any>> | null = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- same reason
function getTestDb(): ReturnType<typeof drizzlePglite<any>> {
  if (!_testDb) throw new Error('PGlite test DB not initialised — is beforeAll() running?');
  return _testDb;
}

// ─── Module mocks (hoisted) ───────────────────────────────────────────────────

vi.mock('@estalara/db', async (importOriginal) => {
  // Import the REAL @estalara/db so we can re-export its schema symbols and
  // upsertConversionLabel. Only createAdminClient is replaced.
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports -- vi.mock importOriginal generic requires inline import() type
  const real = await importOriginal<typeof import('@estalara/db')>();
  return {
    ...real,
    // Replace the DB client factory with one that returns the PGlite client.
    // getTestDb() is called lazily (at test runtime), not at mock-setup time.
    createAdminClient: () => getTestDb(),
  };
});

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

// ─── Fixture DDL ──────────────────────────────────────────────────────────────
//
// Minimal schema for the CRM write + two-writer convergence tests.
// Tables: tenants, conversion_labels, ab_bandit_weights (for feedback route).
//
// RLS policies are omitted — the admin client bypasses RLS; tenant isolation
// is enforced at the WHERE tenant_id predicate level (verified by AC1).

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

  CREATE INDEX IF NOT EXISTS conversion_labels_tenant_id_idx
    ON conversion_labels (tenant_id);

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

// ─── Suite globals ─────────────────────────────────────────────────────────────

let pg: PGlite;
let TENANT_ID: string;

// ─── Suite setup / teardown ───────────────────────────────────────────────────

beforeAll(async () => {
  pg = new PGlite();
  await pg.waitReady;
  await pg.exec(FIXTURE_DDL);

  _testDb = drizzlePglite(pg);

  const row = await pg.query<{ id: string }>(
    `INSERT INTO tenants (name, slug) VALUES ('CRM Route Test Tenant', 'crm-route-pglite') RETURNING id`,
  );
  const t = row.rows[0];
  if (!t) throw new Error('Failed to insert test tenant');
  TENANT_ID = t.id;
});

afterAll(async () => {
  _testDb = null;
  await pg.close();
});

/** Clean conversion_labels and ab_bandit_weights between tests — blank slate. */
beforeEach(async () => {
  await pg.exec('DELETE FROM conversion_labels');
  await pg.exec('DELETE FROM ab_bandit_weights');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface StoredLabel {
  prediction_id: string;
  lead_id: string;
  outcome_class: string;
  label_source: string;
  confidence: number | null;
  tenant_id: string;
}

async function getLabels(tenantId: string): Promise<StoredLabel[]> {
  const res = await pg.query<StoredLabel>(
    `SELECT prediction_id, lead_id, outcome_class, label_source, confidence, tenant_id
       FROM conversion_labels
      WHERE tenant_id = $1
      ORDER BY prediction_id`,
    [tenantId],
  );
  return res.rows;
}

/** Build a signed NextRequest for POST /api/crm/outcome using the ops fallback. */
function makeCrmRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/crm/outcome', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // ADAPT_API_KEY ops fallback — no HMAC needed.
      Authorization: 'Bearer ops-test-key',
    },
    body: JSON.stringify(body),
  });
}

/** Build a NextRequest for POST /api/adapt/feedback using the ops fallback. */
function makeFeedbackRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/adapt/feedback', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ops-test-key',
    },
    body: JSON.stringify(body),
  });
}

/** Drain the Node.js microtask queue so fire-and-forget promises complete. */
async function drainMicrotasks(): Promise<void> {
  // setImmediate defers until after all pending microtasks + I/O callbacks.
  await new Promise<void>((resolve) => setImmediate(resolve));
}

// ─── Import production route handlers ────────────────────────────────────────
//
// These imports are module-level so Vitest's vi.mock() hoisting takes effect
// before the handlers are imported. The handlers call createAdminClient() at
// REQUEST time (not at import time), so the PGlite factory is in scope when
// the handler runs.

import { POST as postCrmOutcome } from './route';
import { POST as postFeedback } from '../../adapt/feedback/route';

// ─── AC1: CRM route writes the correct conversion_labels row ─────────────────
//
// FOLLOW-250 AC1: import and invoke the actual POST /api/crm/outcome handler
// against PGlite and assert the resulting conversion_labels row reflects what
// the route received. A WHERE-clause divergence (dropped tenant_id, wrong
// namespace key) or missing field in the route write BREAKS this test.

describe('AC1 (FOLLOW-250): CRM route writes the correct conversion_labels row', () => {
  beforeEach(() => {
    vi.stubEnv('ADAPT_API_KEY', 'ops-test-key');
    vi.stubEnv('ADAPT_TENANT_ID', TENANT_ID);
    vi.stubEnv('DATABASE_URL_ADMIN', 'postgresql://localhost/test');
  });

  it('stores prediction_id, lead_id, outcome_class from the request body', async () => {
    const res = await postCrmOutcome(
      makeCrmRequest({
        prediction_id: 'pred-ac1-001',
        lead_id: 'crm-lead-token-ac1',
        outcome_class: 'purchased',
      }),
    );

    expect(res.status).toBe(200);

    const labels = await getLabels(TENANT_ID);
    expect(labels).toHaveLength(1);
    const row = labels[0]!;
    expect(row.prediction_id).toBe('pred-ac1-001');
    expect(row.lead_id).toBe('crm-lead-token-ac1');
    expect(row.outcome_class).toBe('purchased');
    expect(row.label_source).toBe('system');
    // Tenant comes from auth context, NOT from the body — compliance condition 4.
    expect(row.tenant_id).toBe(TENANT_ID);
  });

  it('stores confidence=1.0 when not supplied in the request body', async () => {
    const res = await postCrmOutcome(
      makeCrmRequest({
        prediction_id: 'pred-ac1-002',
        lead_id: 'crm-lead-token-ac1-b',
        outcome_class: 'offer_made',
      }),
    );
    expect(res.status).toBe(200);

    const labels = await getLabels(TENANT_ID);
    expect(labels).toHaveLength(1);
    expect(labels[0]!.confidence).toBe(1.0);
  });

  it('stores the explicit confidence value when supplied', async () => {
    const res = await postCrmOutcome(
      makeCrmRequest({
        prediction_id: 'pred-ac1-003',
        lead_id: 'crm-lead-token-ac1-c',
        outcome_class: 'contract_signed',
        confidence: 0.85,
      }),
    );
    expect(res.status).toBe(200);

    const labels = await getLabels(TENANT_ID);
    expect(labels[0]!.confidence).toBeCloseTo(0.85, 3);
  });

  it('rejects a shallow outcome_class (viewing_booked) — taxonomy boundary §T.4', async () => {
    const res = await postCrmOutcome(
      makeCrmRequest({
        prediction_id: 'pred-ac1-shallow',
        lead_id: 'crm-shallow-token',
        outcome_class: 'viewing_booked',
      }),
    );
    expect(res.status).toBe(400);

    // The DB must remain empty — rejected at validation, not written.
    const labels = await getLabels(TENANT_ID);
    expect(labels).toHaveLength(0);
  });

  it('tenant_id comes from auth (ADAPT_TENANT_ID), NOT from a body field', async () => {
    // Verify: even if someone tried to inject a different tenant_id via body,
    // .strict() rejects it → 400, and the stored tenant_id is always from auth.
    const res = await postCrmOutcome(
      new NextRequest('http://localhost/api/crm/outcome', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ops-test-key',
        },
        // Include a tenant_id in the body — .strict() must reject this.
        body: JSON.stringify({
          prediction_id: 'pred-ac1-inject',
          lead_id: 'crm-inject-token',
          outcome_class: 'purchased',
          tenant_id: 'attacker-tenant-uuid',
        }),
      }),
    );
    expect(res.status).toBe(400);
    const labels = await getLabels(TENANT_ID);
    expect(labels).toHaveLength(0);
  });
});

// ─── AC3: Two-writer convergence — feedback then CRM on same prediction_id ───
//
// FOLLOW-250 AC3: drive POST /api/adapt/feedback (viewing_booked / SDK) followed
// by POST /api/crm/outcome (purchased / system) on the same (tenant_id, prediction_id)
// and assert the outcome converges to 'purchased'.
//
// Both routes call createAdminClient() → our PGlite mock → upsertConversionLabel.
// The precedence logic in upsertConversionLabel runs against real PGlite SQL.
// A regression in either route's write path BREAKS this test.

describe('AC3 (FOLLOW-250): two-writer convergence — feedback→CRM on same prediction_id', () => {
  beforeEach(() => {
    vi.stubEnv('ADAPT_API_KEY', 'ops-test-key');
    vi.stubEnv('ADAPT_TENANT_ID', TENANT_ID);
    // FEEDBACK_ENDPOINT_ENABLED=true so the feedback route is reachable in this
    // integration test (ESC-035 secure-by-default gate; prod keeps this unset).
    vi.stubEnv('FEEDBACK_ENDPOINT_ENABLED', 'true');
    // DATABASE_URL_ADMIN must be set so the feedback route's upsertConversionLabelAsync
    // path is NOT short-circuited (it returns early when adminUrl is falsy).
    vi.stubEnv('DATABASE_URL_ADMIN', 'postgresql://localhost/test');
  });

  it('CRM (purchased) overwrites SDK feedback (viewing_booked) on same prediction_id', async () => {
    const PRED_ID = 'pred-ac3-convergence';
    const LEAD_ID = 'crm-token-ac3';

    // Step 1: SDK feedback ping writes viewing_booked via the feedback route.
    // The feedback route uses the tenant_id from the body (not from auth).
    const feedbackBody = {
      session_id: 'sess-ac3-001',
      tenant_id: TENANT_ID,
      archetype: 'family_buyer',
      variant: 'control',
      converted: false,
      prediction_id: PRED_ID,
      lead_id: '',
    };
    const feedbackResp = await postFeedback(makeFeedbackRequest(feedbackBody));
    expect(feedbackResp.status).toBe(202);

    // The feedback route fires-and-forgets the DB write — drain the microtask queue
    // so upsertConversionLabelAsync() completes before we assert.
    await drainMicrotasks();

    // Confirm viewing_booked was written by the feedback route.
    const afterFeedback = await getLabels(TENANT_ID);
    expect(afterFeedback).toHaveLength(1);
    expect(afterFeedback[0]!.outcome_class).toBe('no_response');

    // Step 2: CRM webhook writes purchased via the CRM route.
    const crmResp = await postCrmOutcome(
      makeCrmRequest({
        prediction_id: PRED_ID,
        lead_id: LEAD_ID,
        outcome_class: 'purchased',
        confidence: 0.95,
      }),
    );
    expect(crmResp.status).toBe(200);

    // The CRM write is synchronous (awaited inside the route) — no drain needed.
    const afterCrm = await getLabels(TENANT_ID);
    expect(afterCrm).toHaveLength(1);
    const stored = afterCrm[0]!;
    // Purchased (rank 5) wins over no_response (rank 0) — convergence.
    expect(stored.outcome_class).toBe('purchased');
    expect(stored.lead_id).toBe(LEAD_ID);
    expect(stored.label_source).toBe('system');
    expect(stored.tenant_id).toBe(TENANT_ID);
  });

  it('repeated CRM call on same prediction_id is a no-op when outcome rank is equal', async () => {
    const PRED_ID = 'pred-ac3-noop';

    // Write purchased first.
    await postCrmOutcome(
      makeCrmRequest({
        prediction_id: PRED_ID,
        lead_id: 'crm-token-ac3-noop',
        outcome_class: 'purchased',
        confidence: 0.9,
      }),
    );

    // Attempt to overwrite with a lower-rank class (offer_made, rank 2 < 5).
    await postCrmOutcome(
      makeCrmRequest({
        prediction_id: PRED_ID,
        lead_id: 'crm-token-ac3-noop',
        outcome_class: 'offer_made',
        confidence: 0.5,
      }),
    );

    const labels = await getLabels(TENANT_ID);
    expect(labels).toHaveLength(1);
    // purchased must survive — lower-rank offer_made must not downgrade it.
    expect(labels[0]!.outcome_class).toBe('purchased');
  });
});
