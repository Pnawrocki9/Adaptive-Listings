// @vitest-environment node
/**
 * The method × caller permission matrix over EVERY mutating control-plane route (FOLLOW-1307,
 * Codex F-10; plan Phase 6 S1, checkpoint K6).
 *
 * WHAT IS UNDER TEST. The real route handlers, through the real auth chain: `@estalara/auth`
 * (HS256 verification with exp/nbf/alg/iss/aud), `lib/tracer-auth.ts`, `lib/session-auth.ts`
 * (`resolveTenantAccess`, `tenantExists`), `lib/staff-rank.ts` and every route-local gate. Only
 * the stores are controlled: `@estalara/db` client factories return a recording fake (every
 * select answers one row for the seeded tenant; insert/update/delete/execute/transaction are
 * recorded as writes), `fetch` is stubbed and recorded (ClickHouse HTTP, Upstash REST, Modal,
 * OpenAI all go through it), and `@supabase/ssr` answers the SSR session the column asks for.
 *
 * HOW A NEW ROUTE IS FORCED IN. The route set is generated from the N2 route inventory
 * (`scripts/baselines/single-tenant-routes.allowlist`, which `scripts/check-single-tenant.sh
 * --ratchet` keeps equal to the route files on disk) and cross-checked against the disk here.
 * Every exported POST/PUT/PATCH/DELETE in those files must have a MATRIX entry, and every
 * MATRIX entry must name an exported method that exists: a new mutating route, or a new
 * method on an old one, fails the first test until someone decides who may call it.
 *
 * THE RULE PER CELL.
 *   - A denied cell answers 401 or 403 and leaves NO write: no recorded DB write, no
 *     transaction, no outbound fetch.
 *   - An allowed cell is not refused by auth (status is neither 401 nor 403). The bodies are
 *     empty, so most allowed cells end at validation (400/422) — the matrix proves the gate,
 *     the per-route suites prove the write.
 *   - `staff` entries allow exactly the identified staff ranks at or above `min` (verified
 *     staff JWT or SSR session). Readonly never writes; the headless ADMIN_API_SECRET,
 *     INTERNAL_API_SECRET and CRON_SECRET never reach a staff write; an expired or forged
 *     staff token is nobody.
 *   - `machine` entries are authenticated by something no staff credential carries (a tenant
 *     API key + HMAC, a webhook signature, a DSR token). No column is allowed except the ones
 *     listed (`INTERNAL_API_SECRET` for the two embedding routes); a denied machine cell must
 *     not WRITE, and must not answer 2xx, but may refuse with 400 (a signature/key check that
 *     runs after body parsing).
 *   - `sink` entries are the DEMO_MODE no-op event sink: it answers 200 to anyone and must not
 *     write anything.
 *
 * Single tenant (ESC-085): "agency A cannot act on agency B" has no subject any more (one tenant,
 * no agency roles since FOLLOW-1335). What remains of it is pinned at the bottom: a staff write
 * names an explicit tenant that must exist (`tenantExists`), so an unknown tenant id is 404 with
 * no write even for a superadmin.
 *
 * @module apps/control-plane/src/app/api/__tests__/mutation-permission-matrix.test
 */

import { createHmac, randomBytes } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Controlled stores ────────────────────────────────────────────────────────

const rec = vi.hoisted(() => {
  const TENANT_ID = '00000000-0000-0000-0000-0000000000e2';
  const state = {
    writes: [] as string[],
    fetches: [] as string[],
    /** When false every select answers no rows (the unknown-tenant cells). */
    rowsFound: true,
    ssrUser: null as null | { id: string; email: string; app_metadata: Record<string, unknown> },
  };
  const WRITE_OPS = new Set(['insert', 'update', 'delete', 'execute']);
  // A chainable, awaitable stand-in for a drizzle client: every call returns another chain,
  // awaiting any chain yields the select rows, and write builders are recorded on first touch.
  const chain = (): unknown =>
    new Proxy(
      function fakeDb() {
        return undefined; // a callable Proxy target; every call is answered by `apply`
      },
      {
        get(_target, prop) {
          if (prop === 'then') {
            const rows = state.rowsFound ? [{ id: TENANT_ID, tenantId: TENANT_ID }] : [];
            return (onOk: (v: unknown) => unknown, onErr: (e: unknown) => unknown) =>
              Promise.resolve(rows).then(onOk, onErr);
          }
          if (typeof prop === 'string' && WRITE_OPS.has(prop)) {
            return () => {
              state.writes.push(prop);
              return chain();
            };
          }
          if (prop === 'transaction') {
            return async (cb: (tx: unknown) => Promise<unknown>) => {
              state.writes.push('transaction');
              return cb(chain());
            };
          }
          return () => chain();
        },
        apply: () => chain(),
      },
    );
  return { TENANT_ID, state, chain };
});

vi.mock('@estalara/db', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    createAdminClient: () => rec.chain(),
    createClient: () => rec.chain(),
    createTenantClient: () => rec.chain(),
  };
});

vi.mock('@supabase/ssr', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    createServerClient: () => ({
      auth: {
        getUser: () => Promise.resolve({ data: { user: rec.state.ssrUser }, error: null }),
      },
    }),
  };
});

// ─── Credentials (built at runtime; no token-shaped literal in the repo) ─────────

const SUPABASE_URL = 'https://matrix-test.supabase.example';
const JWT_SECRET = randomBytes(32).toString('hex');
const ADMIN_SECRET = randomBytes(24).toString('hex');
const INTERNAL_SECRET = randomBytes(24).toString('hex');
const CRON_SECRET = randomBytes(24).toString('hex');
const DEMO_JWT_SECRET = randomBytes(32).toString('hex');

type StaffRank = 'readonly' | 'ops' | 'superadmin';

function staffJwt(rank: StaffRank, opts: { expired?: boolean; key?: string } = {}): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const input = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({
    sub: '00000000-0000-0000-0000-00000000a001',
    email: `${rank}@estalara.example`,
    estalara_staff: true,
    estalara_role: `estalara:${rank}`,
    mfa_verified: true,
    iss: `${SUPABASE_URL}/auth/v1`,
    aud: 'authenticated',
    role: 'authenticated',
    iat: opts.expired ? now - 7200 : now,
    exp: opts.expired ? now - 3600 : now + 3600,
  })}`;
  const sig = createHmac('sha256', opts.key ?? JWT_SECRET)
    .update(input)
    .digest('base64url');
  return `${input}.${sig}`;
}

interface Column {
  name: string;
  headers: () => Record<string, string>;
  ssr?: StaffRank;
  /** The identified staff rank this column carries, if any (expired/forged carry none). */
  staffRank?: StaffRank;
}

const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

const COLUMNS: Column[] = [
  { name: 'anonymous', headers: () => ({}) },
  {
    name: 'ADMIN_API_SECRET (Bearer + x-admin-secret)',
    headers: () => ({ ...bearer(ADMIN_SECRET), 'x-admin-secret': ADMIN_SECRET }),
  },
  { name: 'CRON_SECRET bearer', headers: () => bearer(CRON_SECRET) },
  {
    // Both forms the service routes read: the header (`listings/embed`) and the Bearer
    // (`internal/listings/embed-seed`).
    name: 'INTERNAL_API_SECRET',
    headers: () => ({ 'x-internal-api-secret': INTERNAL_SECRET, ...bearer(INTERNAL_SECRET) }),
  },
  {
    name: 'expired superadmin JWT',
    headers: () => bearer(staffJwt('superadmin', { expired: true })),
  },
  {
    name: 'forged superadmin JWT (wrong key)',
    headers: () => bearer(staffJwt('superadmin', { key: randomBytes(32).toString('hex') })),
  },
  { name: 'readonly JWT', headers: () => bearer(staffJwt('readonly')), staffRank: 'readonly' },
  { name: 'ops JWT', headers: () => bearer(staffJwt('ops')), staffRank: 'ops' },
  {
    name: 'superadmin JWT',
    headers: () => bearer(staffJwt('superadmin')),
    staffRank: 'superadmin',
  },
  { name: 'readonly SSR session', headers: () => ({}), ssr: 'readonly', staffRank: 'readonly' },
  { name: 'ops SSR session', headers: () => ({}), ssr: 'ops', staffRank: 'ops' },
  {
    name: 'superadmin SSR session',
    headers: () => ({}),
    ssr: 'superadmin',
    staffRank: 'superadmin',
  },
];

// ─── The matrix ───────────────────────────────────────────────────────────────

type Entry =
  | { kind: 'staff'; min: 'ops' | 'superadmin' }
  | { kind: 'machine'; credential: string; allowed?: string[] }
  | { kind: 'sink'; why: string };

/** Key: `<route dir under src/app> <METHOD>`. Every mutating export must appear here. */
const MATRIX: Record<string, Entry> = {
  // ── Staff writes (ADR-0018: write = estalara:ops+, platform-global = superadmin) ──
  'api/admin/generation-model PUT': { kind: 'staff', min: 'superadmin' },
  'api/admin/intent-weights PUT': { kind: 'staff', min: 'ops' },
  'api/admin/intent/config POST': { kind: 'staff', min: 'ops' },
  'api/admin/intent/config/[id] PUT': { kind: 'staff', min: 'ops' },
  'api/admin/labels/[id] PATCH': { kind: 'staff', min: 'ops' },
  'api/admin/tenants/al-state PUT': { kind: 'staff', min: 'ops' },
  'api/admin/tenants/optout-widget PUT': { kind: 'staff', min: 'ops' },
  'api/admin/tenants/quiz-definition PUT': { kind: 'staff', min: 'ops' },
  'api/admin/tenants/quiz-definition/activate PUT': { kind: 'staff', min: 'ops' },
  'api/admin/tenants/quiz-definition/deactivate PUT': { kind: 'staff', min: 'ops' },
  'api/admin/tenants/quiz-definition/suggest-weights POST': { kind: 'staff', min: 'ops' },
  'api/admin/tenants/quiz-state PUT': { kind: 'staff', min: 'ops' },
  'api/config PATCH': { kind: 'staff', min: 'ops' },
  'api/demo/override PUT': { kind: 'staff', min: 'ops' },
  // FOLLOW-1308 (absorbs FOLLOW-1279): identified ops+ staff on the Estalara tenant, audited.
  'api/dsr/initiate POST': { kind: 'staff', min: 'ops' },
  'api/quiz/config POST': { kind: 'staff', min: 'ops' },
  'api/tenants/[id] PATCH': { kind: 'staff', min: 'ops' },
  'api/tenants/[id]/answers POST': { kind: 'staff', min: 'ops' },
  'api/tenants/[id]/answers/[answerId] PATCH': { kind: 'staff', min: 'ops' },
  'api/tenants/[id]/answers/[answerId] DELETE': { kind: 'staff', min: 'ops' },
  'api/tenants/[id]/bandit/weights/[archetype] PATCH': { kind: 'staff', min: 'superadmin' },
  'api/tenants/[id]/lia POST': { kind: 'staff', min: 'ops' },
  'api/tenants/[id]/lia/[recordId] DELETE': { kind: 'staff', min: 'ops' },

  // ── Machine callers: no staff credential is the right key ──
  'api/adapt POST': { kind: 'machine', credential: 'tenant API key (resolveApiKey)' },
  'api/adapt/feedback POST': { kind: 'machine', credential: 'tenant API key + HMAC signature' },
  'api/crm/outcome POST': { kind: 'machine', credential: 'CRM HMAC signature' },
  // FOLLOW-1308 (R32): the xid-carrying POST forms of the two disclosure routes.
  'api/dsr/access POST': { kind: 'machine', credential: 'DSR verification token' },
  'api/dsr/erase POST': { kind: 'machine', credential: 'DSR verification token' },
  'api/dsr/portability POST': { kind: 'machine', credential: 'DSR verification token' },
  'api/internal/listings/embed-seed POST': {
    kind: 'machine',
    credential: 'INTERNAL_API_SECRET',
    allowed: ['INTERNAL_API_SECRET'],
  },
  // Codex F-10: was HTTP 200 + a write for `agency:viewer` and for an expired signed JWT. The
  // JWT path is gone (FOLLOW-1335); only the approved service-to-service secret remains.
  'api/listings/embed POST': {
    kind: 'machine',
    credential: 'INTERNAL_API_SECRET',
    allowed: ['INTERNAL_API_SECRET'],
  },
  'api/profile/access POST': { kind: 'machine', credential: 'tenant API key + HMAC + xid' },
  'api/profile/erase POST': { kind: 'machine', credential: 'tenant API key + HMAC + xid' },
  'api/profile/portability POST': { kind: 'machine', credential: 'tenant API key + HMAC + xid' },
  'api/quiz/completion POST': { kind: 'machine', credential: 'tenant API key + HMAC signature' },
  'api/quiz/run POST': { kind: 'machine', credential: 'tenant API key + HMAC signature' },
  'api/v1/consent/platform-registration POST': {
    kind: 'machine',
    credential: 'platform HMAC signature',
  },
  'api/webhooks/listing-updated POST': {
    kind: 'machine',
    credential: 'LISTING_UPDATED_WEBHOOK_SECRET HMAC',
  },

  // ── No-write sinks ──
  'api/demo/ingest POST': {
    kind: 'sink',
    why: 'DEMO_MODE-only event counter: answers {received, count}, stores nothing',
  },
};

// ─── Route inventory (generated, never hand-listed) ───────────────────────────

const CP_ROOT = resolve(__dirname, '../../../..');
const REPO_ROOT = resolve(CP_ROOT, '../..');
const APP_DIR = join(CP_ROOT, 'src/app');
const ALLOWLIST = join(REPO_ROOT, 'scripts/baselines/single-tenant-routes.allowlist');
const MUTATING = ['POST', 'PUT', 'PATCH', 'DELETE'] as const;

function routeFilesOnDisk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return routeFilesOnDisk(full);
    return name === 'route.ts' ? [relative(REPO_ROOT, full).split(sep).join('/')] : [];
  });
}

/** The route.ts files of the N2 inventory. */
function inventoryRouteFiles(): string[] {
  return readFileSync(ALLOWLIST, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.endsWith('/route.ts'));
}

/** Exported HTTP methods of a route file (function, const and re-export forms). */
function exportedMethods(file: string): string[] {
  const src = readFileSync(join(REPO_ROOT, file), 'utf8');
  const found = new Set<string>();
  const re =
    /export\s+(?:async\s+)?(?:function|const|let)\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g;
  for (const m of src.matchAll(re)) if (m[1]) found.add(m[1]);
  for (const m of src.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of (m[1] ?? '').split(',')) {
      const name = part
        .trim()
        .split(/\s+as\s+/)
        .pop();
      if (name && /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(name)) found.add(name);
    }
  }
  return [...found];
}

const routeDir = (file: string) =>
  file.replace(/^apps\/control-plane\/src\/app\//, '').replace(/\/route\.ts$/, '');

function discoveredMutations(): string[] {
  return inventoryRouteFiles()
    .flatMap((file) =>
      exportedMethods(file)
        .filter((m) => (MUTATING as readonly string[]).includes(m))
        .map((m) => `${routeDir(file)} ${m}`),
    )
    .sort();
}

// ─── Running one cell ─────────────────────────────────────────────────────────

const SEGMENT_VALUES: Record<string, string> = {
  id: rec.TENANT_ID,
  recordId: '00000000-0000-0000-0000-00000000b001',
  answerId: '00000000-0000-0000-0000-00000000c001',
  archetype: 'yield_hunter',
  session_id: 'sess-matrix',
};

/** Load a route module (the real handler) by its directory under src/app. */
function loadRoute(dir: string): Promise<Record<string, Handler>> {
  return import(/* @vite-ignore */ join(APP_DIR, dir, 'route.ts')) as Promise<
    Record<string, Handler>
  >;
}

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => unknown;

async function runCell(
  key: string,
  column: Column,
  tenantId: string = rec.TENANT_ID,
): Promise<{ status: number; writes: string[]; fetches: string[] }> {
  const [dir = '', method = ''] = key.split(' ');
  const params: Record<string, string> = {};
  const path = dir.replace(/\[([^\]]+)\]/g, (_m, seg: string) => {
    const value = seg === 'id' ? tenantId : (SEGMENT_VALUES[seg] ?? 'x');
    params[seg] = value;
    return value;
  });
  rec.state.writes = [];
  rec.state.fetches = [];
  rec.state.ssrUser = column.ssr
    ? {
        id: '00000000-0000-0000-0000-00000000a002',
        email: `${column.ssr}-ssr@estalara.example`,
        app_metadata: { estalara_staff: true, estalara_role: `estalara:${column.ssr}` },
      }
    : null;

  const mod = await loadRoute(dir);
  const handler = mod[method];
  if (!handler) throw new Error(`${key}: no exported ${method}`);
  const req = new NextRequest(`http://localhost:3000/${path}?tenant_id=${tenantId}`, {
    method,
    headers: { 'content-type': 'application/json', ...column.headers() },
    body: '{}',
  });
  const res = (await handler(req, { params: Promise.resolve(params) })) as Response;
  return { status: res.status, writes: [...rec.state.writes], fetches: [...rec.state.fetches] };
}

function isAllowed(entry: Entry, column: Column): boolean {
  if (entry.kind === 'staff') {
    if (!column.staffRank) return false;
    const rank = { readonly: 1, ops: 2, superadmin: 3 } as const;
    return rank[column.staffRank] >= rank[entry.min];
  }
  if (entry.kind === 'machine') return (entry.allowed ?? []).includes(column.name);
  return true;
}

// ─── Environment ──────────────────────────────────────────────────────────────

beforeAll(() => {
  vi.stubEnv('SUPABASE_JWT_SECRET', JWT_SECRET);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', SUPABASE_URL);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'matrix-test-anon-key');
  vi.stubEnv('ADMIN_API_SECRET', ADMIN_SECRET);
  vi.stubEnv('INTERNAL_API_SECRET', INTERNAL_SECRET);
  vi.stubEnv('CRON_SECRET', CRON_SECRET);
  // The gated features are ON so their rank gates, not their feature flags, answer.
  vi.stubEnv('BANDIT_ENABLED', 'true');
  vi.stubEnv('DEMO_MODE', '1');
  // The demo-JWT path answers 500 (misconfigured) without its secret; with it, a Bearer that is
  // not a demo token is refused like any other bad credential.
  vi.stubEnv('DEMO_MODE_JWT_SECRET', DEMO_JWT_SECRET);
  vi.stubEnv('FEEDBACK_ENDPOINT_ENABLED', 'true');
  vi.stubGlobal(
    'fetch',
    vi.fn((input: unknown) => {
      rec.state.fetches.push(String(input instanceof Request ? input.url : input));
      return Promise.resolve(new Response('{}', { status: 503 }));
    }),
  );
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

// Load (transform) every matrix route once up front, so a cold module graph on a slow machine
// is not charged to the first cell's 5 s timeout.
beforeAll(async () => {
  for (const key of Object.keys(MATRIX)) {
    const dir = key.split(' ')[0] ?? '';
    await loadRoute(dir);
  }
}, 600_000);

afterAll(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

beforeEach(() => {
  rec.state.rowsFound = true;
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('route inventory → matrix coverage', () => {
  it('the N2 inventory lists exactly the route files on disk', () => {
    expect(inventoryRouteFiles().sort()).toEqual(routeFilesOnDisk(APP_DIR).sort());
  });

  it('every mutating export has a matrix entry, and every entry names a real export', () => {
    expect(Object.keys(MATRIX).sort()).toEqual(discoveredMutations());
  });

  it('control: the fake store is the one the real handlers write to (an allowed write is seen)', async () => {
    const ops = COLUMNS.find((c) => c.name === 'ops JWT');
    if (!ops) throw new Error('column missing');
    const out = await runCell('api/tenants/[id]/lia/[recordId] DELETE', ops);
    expect(out.status).toBe(200);
    expect(out.writes).toEqual(['transaction', 'update', 'insert']);
  });

  it('POST /api/tenants (tenant creation by x-admin-secret) is gone (ESC-085 one tenant)', () => {
    expect(inventoryRouteFiles()).not.toContain('apps/control-plane/src/app/api/tenants/route.ts');
  });
});

describe.each(Object.entries(MATRIX))('%s', (key, entry) => {
  it.each(COLUMNS.map((c) => [c.name, c] as const))('%s', async (_name, column) => {
    const out = await runCell(key, column);
    const allowed = isAllowed(entry, column);
    const ctx = `${key} as ${column.name}: ${JSON.stringify(out)}`;
    if (entry.kind === 'sink') {
      expect(out.writes, ctx).toEqual([]);
      expect(out.fetches, ctx).toEqual([]);
      return;
    }
    if (allowed) {
      expect([401, 403], ctx).not.toContain(out.status);
      return;
    }
    expect(out.writes, ctx).toEqual([]);
    expect(out.fetches, ctx).toEqual([]);
    if (entry.kind === 'staff') {
      expect([401, 403], ctx).toContain(out.status);
    } else {
      expect(out.status, ctx).toBeGreaterThanOrEqual(400);
      expect(out.status, ctx).toBeLessThan(500);
    }
  });
});

describe('the cross-scope check that survives one tenant', () => {
  const UNKNOWN_TENANT = '00000000-0000-0000-0000-00000000dead';
  const superadmin = COLUMNS.find((c) => c.name === 'superadmin JWT');

  it.each(
    Object.entries(MATRIX)
      .filter(([k, e]) => e.kind === 'staff' && k.startsWith('api/tenants/[id]'))
      .map(([k]) => [k] as const),
  )('%s on an unknown tenant id → 404, no write (tenantExists)', async (key) => {
    if (!superadmin) throw new Error('column missing');
    rec.state.rowsFound = false;
    const out = await runCell(key, superadmin, UNKNOWN_TENANT);
    expect(out.status, `${key}: ${JSON.stringify(out)}`).toBe(404);
    expect(out.writes).toEqual([]);
  });
});
