/**
 * scripts/dev/seed-local-tenant.mts — idempotent local-dev tenant + API key seed.
 *
 * Purpose:
 *   Creates a fixed-UUID tenant row, a matching `api_keys` row, and a
 *   `tenant_site_schemas` row so the browser SDK's `data-tenant-id` /
 *   `data-api-key` attributes can resolve locally without a round-trip to
 *   production. Intended for local E2E testing against the Estalara-app
 *   SvelteKit dev server (http://localhost:5173) and against
 *   `tests/e2e/follow-819/fixture-listing.html`.
 *
 *   FOLLOW-1072: the `tenant_site_schemas` row closes a real gap, not a
 *   cosmetic one. `getTenantSchema()` (`apps/control-plane/src/lib/tenant-schema.ts`)
 *   returns the hardcoded `DEMO_SCHEMA` only for the literal tenant id
 *   `est_demo_tenant`; every other tenant — including this one — falls
 *   through to a DB lookup that returns `null` on an empty table. With
 *   `tenant_site_schemas` empty, the adapt route's reorder block
 *   (`route.ts:1804`, gated on `tenantSchema && listing_ids.length > 0` —
 *   NOT on confidence) is never entered, so
 *   `adaptation_decisions.scoring_path` can never take a discriminating
 *   value (`cosine` / `djb2_fallback` / `djb2_guard`) on this substrate at
 *   any confidence. Without this row, FOLLOW-819's differentiator E2E
 *   measures `scoring_path` as `'not_applicable'` on every run regardless
 *   of the confidence gate.
 *
 * Idempotency:
 *   All INSERTs use ON CONFLICT DO NOTHING. Re-running the script is safe — it is
 *   a no-op when the rows already exist. The raw API key is deterministic (hardcoded),
 *   so the printed env-var values are stable across re-runs.
 *
 * Hashing (MUST match the verify path in production):
 *   `/api/quiz/public-config` and `/api/intent/config` authenticate Bearer tokens by
 *   computing SHA-256(rawKey) via `crypto.subtle.digest('SHA-256', ...)` (Web Crypto)
 *   and comparing against `api_keys.hashed_key`. Node's `createHash('sha256')` produces
 *   byte-identical output for the same UTF-8 input. This has been verified in
 *   `route.test.ts` (VALID_KEY_HASH = createHash('sha256').update(VALID_KEY).digest('hex')).
 *
 * Connection:
 *   Uses `createAdminClient()` from `@estalara/db`, which reads:
 *     1. DATABASE_URL_ADMIN   (preferred — service role, bypasses RLS)
 *     2. DATABASE_URL_DIRECT  (fallback — direct connection)
 *
 * Usage:
 *   DATABASE_URL_ADMIN=<your-service-role-url> pnpm seed:local-tenant
 *
 * Outputs:
 *   - The fixed tenant UUID
 *   - The raw API key (copy it as PUBLIC_ESTALARA_API_KEY)
 *   - The exact .env lines to paste into Estalara-app's web-master/.env
 */

import { createHash } from 'node:crypto';
import { createAdminClient, tenants, apiKeys, tenantSiteSchemas } from '@estalara/db';
import { sql } from 'drizzle-orm';

// ─── Fixed identifiers (stable across re-runs) ────────────────────────────────

/**
 * Fixed tenant UUID for the local E2E fixture.
 * Must be a valid UUID v4 — NOT a sentinel string (Rule RETRO-005 FOLLOW-047).
 */
const LOCAL_TENANT_ID = '00000000-0000-0000-0000-0000000000e2';

/**
 * Fixed API key UUID (row PK). Stable so ON CONFLICT targets correctly.
 */
const LOCAL_API_KEY_ID = '00000000-0000-0000-0000-00000000a001';

/**
 * Raw public API key. This value is printed at the end of the script and
 * should be pasted into Estalara-app's `.env` as `PUBLIC_ESTALARA_API_KEY`.
 *
 * Characters are URL-safe, prefix follows the `est_pk_` convention.
 * Length > 32 chars so entropy is sufficient for a local dev secret.
 */
const RAW_API_KEY = 'est_pk_local_e2e_00000000000000e2';

/**
 * SHA-256 of RAW_API_KEY, hex-encoded.
 *
 * This is the value stored in `api_keys.hashed_key`. It matches the output of
 *   `crypto.subtle.digest('SHA-256', new TextEncoder().encode(RAW_API_KEY))`
 * which is what `/api/quiz/public-config` and `/api/intent/config` compute at
 * request time to authenticate the Bearer token.
 *
 * Node's `createHash('sha256').update(input, 'utf8').digest('hex')` is byte-identical
 * to the Web Crypto path (same SHA-256 algorithm, same UTF-8 encoding).
 */
const HASHED_API_KEY = createHash('sha256').update(RAW_API_KEY, 'utf8').digest('hex');

/** Last 4 characters of the raw key — stored for UI display. */
const LAST_4 = RAW_API_KEY.slice(-4);

/**
 * Domain recorded on the `tenant_site_schemas` row. Not read by any lookup
 * predicate (`lookupSchemaFromDb()` selects the latest row for `tenant_id`
 * regardless of `domain`) — purely denormalised/descriptive, so any value
 * naming this substrate is correct.
 */
const LOCAL_TENANT_DOMAIN = 'localhost';

/**
 * Full `TenantSiteSchema` JSON blob (see `@estalara/shared`'s
 * `tenant-site-schema.ts`) for the local E2E tenant. Selectors are grounded
 * in `tests/e2e/follow-819/fixture-listing.html`'s REAL markup, read
 * directly rather than guessed (FOLLOW-1072):
 *
 *   <div data-estalara-listing data-estalara-listing-id="839ecbd1-…">
 *
 * The fixture is a single-listing DETAIL page, not an index/grid page, so
 * there is no distinct "card" element separate from the listing wrapper —
 * the same `div` carries both the boolean `data-estalara-listing` marker
 * (used as `container_selector`) and the `data-estalara-listing-id`
 * attribute (used as `listing_card_selector` / `item_selector`). Both
 * selectors therefore match a real element on the fixture; neither is
 * fabricated.
 *
 * Only `index_schema.{reorder_capable,container_selector,listing_card_selector}`
 * are read by `lookupSchemaFromDb()` (`apps/control-plane/src/lib/tenant-schema.ts`).
 * The rest of the blob is filled out to the full `TenantSiteSchema` shape
 * (rather than a partial hack) so this row is indistinguishable from one the
 * real Auto-Detection Engine would have produced.
 */
const LOCAL_SITE_SCHEMA = {
  tenant_id: LOCAL_TENANT_ID,
  domain: LOCAL_TENANT_DOMAIN,
  detected_at: new Date().toISOString(),
  detection_source: 'manual',
  detection_confidence: 1,
  index_schema: {
    url_patterns: ['/'],
    listing_card_selector: '[data-estalara-listing-id]',
    container_selector: '[data-estalara-listing]',
    card_field_mappings: {},
    data_extractors_per_card: {},
    reorder_capable: true,
  },
  detail_schema: {
    url_patterns: ['/'],
    slot_selectors: {
      headline: {
        primary: '[data-estalara-slot="headline"]',
        fallbacks: [],
        type: 'text',
      },
      description: {
        primary: '[data-estalara-slot="description"]',
        fallbacks: [],
        type: 'text',
      },
    },
    data_extractors: {},
  },
  archetype_hints: [],
};

// ─── Seed functions ───────────────────────────────────────────────────────────

async function seedTenant(db: ReturnType<typeof createAdminClient>): Promise<void> {
  // INSERT … ON CONFLICT (id) DO NOTHING — fully idempotent.
  await db.execute(sql`
    INSERT INTO tenants (
      id,
      name,
      slug,
      status,
      plan,
      allowed_origins,
      brand_config,
      quiz_config,
      consent_required,
      pilot_frozen,
      quiz_enabled,
      profile_mode_enabled,
      created_at,
      updated_at
    ) VALUES (
      ${LOCAL_TENANT_ID}::uuid,
      'Local E2E Tenant',
      'local-e2e',
      'active',
      'augment',
      ARRAY['http://localhost:5173', 'http://localhost:3000']::text[],
      '{}'::jsonb,
      '{}'::jsonb,
      false,
      false,
      true,
      false,
      now(),
      now()
    )
    ON CONFLICT (id) DO NOTHING
  `);
}

async function seedApiKey(db: ReturnType<typeof createAdminClient>): Promise<void> {
  // INSERT … ON CONFLICT (id) DO NOTHING — fully idempotent.
  // The unique constraint on hashed_key is also covered implicitly.
  await db.execute(sql`
    INSERT INTO api_keys (
      id,
      tenant_id,
      type,
      prefix,
      hashed_key,
      last_4,
      scopes,
      allowed_origins,
      created_at
    ) VALUES (
      ${LOCAL_API_KEY_ID}::uuid,
      ${LOCAL_TENANT_ID}::uuid,
      'public',
      'est_pk_',
      ${HASHED_API_KEY},
      ${LAST_4},
      ARRAY['read:events', 'write:events']::text[],
      ARRAY['http://localhost:5173', 'http://localhost:3000']::text[],
      now()
    )
    ON CONFLICT (id) DO NOTHING
  `);
}

/**
 * FOLLOW-1072: seed the `tenant_site_schemas` row this tenant needs for
 * `getTenantSchema()` to return non-null and the adapt route's reorder
 * block to be reachable at all. See the module docstring and
 * `LOCAL_SITE_SCHEMA` for why this row is load-bearing, not cosmetic.
 *
 * ON CONFLICT targets the table's real unique constraint
 * (`tenant_id`, `domain`) — idempotent, matching the other seed functions
 * in this file.
 */
async function seedTenantSiteSchema(db: ReturnType<typeof createAdminClient>): Promise<void> {
  await db.execute(sql`
    INSERT INTO tenant_site_schemas (
      tenant_id,
      domain,
      schema,
      detection_source,
      detection_confidence,
      created_at,
      updated_at
    ) VALUES (
      ${LOCAL_TENANT_ID}::uuid,
      ${LOCAL_TENANT_DOMAIN},
      ${JSON.stringify(LOCAL_SITE_SCHEMA)}::jsonb,
      'manual',
      1,
      now(),
      now()
    )
    ON CONFLICT (tenant_id, domain) DO NOTHING
  `);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const adminUrl = process.env.DATABASE_URL_ADMIN ?? process.env.DATABASE_URL_DIRECT;
  if (!adminUrl) {
    console.error(
      '[seed-local-tenant] ERROR: Neither DATABASE_URL_ADMIN nor DATABASE_URL_DIRECT is set.\n' +
        'Set one before running this script:\n' +
        '  DATABASE_URL_ADMIN=<service-role-url> pnpm seed:local-tenant',
    );
    process.exit(1);
  }

  const db = createAdminClient();

  console.log('[seed-local-tenant] Seeding local E2E tenant…');
  await seedTenant(db);
  console.log('[seed-local-tenant] Tenant row OK (inserted or already existed).');

  console.log('[seed-local-tenant] Seeding local E2E API key…');
  await seedApiKey(db);
  console.log('[seed-local-tenant] API key row OK (inserted or already existed).');

  console.log('[seed-local-tenant] Seeding local E2E tenant_site_schemas row (FOLLOW-1072)…');
  await seedTenantSiteSchema(db);
  console.log('[seed-local-tenant] tenant_site_schemas row OK (inserted or already existed).');

  // ─── Print the env-var block the developer should paste ─────────────────────
  console.log('');
  console.log('────────────────────────────────────────────────────────────────');
  console.log(' Local E2E seed complete. Paste these lines into');
  console.log(' Estalara-app/web-master/.env (or .env.local):');
  console.log('────────────────────────────────────────────────────────────────');
  console.log('');
  console.log(`PUBLIC_ESTALARA_TENANT_ID=${LOCAL_TENANT_ID}`);
  console.log(`PUBLIC_ESTALARA_API_KEY=${RAW_API_KEY}`);
  console.log('');
  console.log('────────────────────────────────────────────────────────────────');
  console.log(` Hashing: SHA-256("${RAW_API_KEY}") = ${HASHED_API_KEY}`);
  console.log(' Verify path: /api/quiz/public-config + /api/intent/config');
  console.log('   → resolveApiKey() calls sha256Hex(bearerToken) via Web Crypto');
  console.log('   → compares (constant-time) against api_keys.hashed_key');
  console.log('   → Node createHash("sha256") is byte-identical to Web Crypto digest');
  console.log('────────────────────────────────────────────────────────────────');

  // Close the pool, or the seed never exits: the driver holds an idle socket and the event loop
  // never drains. Same one-line omission as migrate.ts and feedback-canary.mts — invisible against
  // Supabase (its pooler drops the idle connection), a hung terminal against a local container.
  // FOLLOW-818.
  await db.$client.end({ timeout: 5 });
}

// ─── Entrypoint guard ─────────────────────────────────────────────────────────

const isMain =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith('seed-local-tenant.mts') ||
    process.argv[1].endsWith('seed-local-tenant.ts') ||
    process.argv[1].endsWith('seed-local-tenant.js'));

if (isMain) {
  main().catch((err: unknown) => {
    console.error(
      '[seed-local-tenant] Fatal error:',
      err instanceof Error ? (err.stack ?? err.message) : err,
    );
    process.exit(1);
  });
}

export { main as seedLocalTenant, LOCAL_TENANT_ID, RAW_API_KEY, HASHED_API_KEY };
