/**
 * FOLLOW-639 + FOLLOW-1362 C1 — tests for the staff quiz-definition API:
 *   GET + PUT `/api/admin/tenants/quiz-definition`, GET `…/versions`, PUT `…/activate`,
 *   PUT `…/deactivate`.
 *
 * Auth is delegated to `resolveTenantAccess` (its own wiring is covered elsewhere); these
 * tests PARTIALLY MOCK `@/lib/session-auth` — only `resolveTenantAccess` is a spy. A stateful
 * fake `@estalara/db` + `drizzle-orm` drives the routes' REAL query shape, including the
 * per-tenant advisory lock: the fake transaction takes its READ COMMITTED snapshot only after
 * `pg_advisory_xact_lock` is granted (or at its first statement when no lock is taken), and
 * every statement yields a macrotask, so two un-locked transactions DO interleave and race.
 *
 * Coverage:
 *   - GET: active definition + warnings + `lint` + `can_write`; `invalid_active` + `raw`.
 *   - PUT: new active version + atomic audit (version pair + sha256, never the blob, `source`);
 *     authoring errors → 400 with lint codes, no tx; HARD errors → 400; readonly → 403;
 *     audit failure → rollback; tenant fence; `base_version` → 409; lock is the FIRST
 *     statement; two concurrent PUTs → distinct versions.
 *   - versions: newest 50 summaries with sha256; single fetch; cross-tenant 404; bad param 400.
 *   - activate: copy-forward + atomic `quiz_definition.restore` audit; serve-schema only (an
 *     authoring-invalid legacy row restores, lint returned); rollback on audit failure;
 *     readonly 403; cross-tenant 404; 409 conflict / already active; 422 invalid source.
 *   - deactivate: active row → inactive + `quiz_definition.revert_to_default` audit; 409 when
 *     none active; readonly 403; rollback on audit failure; 409 conflict.
 *
 * @module apps/control-plane/src/app/api/admin/tenants/quiz-definition/route.test
 */

import { NextRequest } from 'next/server';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type * as SessionAuthModule from '@/lib/session-auth';
import {
  DEFAULT_QUIZ_DEFINITION_V2,
  QuizDefinitionSchema,
  computeQuizDefinitionHash,
} from '@estalara/shared';
import type { QuizDefinitionState } from './route';
import type { QuizDefinitionVersionDetail, QuizDefinitionVersionsResponse } from './versions/route';
import type { QuizDefinitionRestoreResponse } from './activate/route';
import type { QuizDefinitionRevertResponse } from './deactivate/route';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@estalara/db', () => ({
  createAdminClient: vi.fn(),
  quizDefinitions: {
    __table: 'quiz_definitions',
    tenantId: 'qd.tenant_id',
    isActive: 'qd.is_active',
    version: 'qd.version',
    definition: 'qd.definition',
    createdAt: 'qd.created_at',
    createdBy: 'qd.created_by',
  },
  staffAuditLog: { __table: 'staff_audit_log' },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col: unknown, val: unknown) => ({ kind: 'eq', col, val })),
  and: vi.fn((...conds: unknown[]) => ({ kind: 'and', conds })),
  desc: vi.fn((col: unknown) => ({ kind: 'desc', col })),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    kind: 'sql',
    text: strings.join('?'),
    values,
  })),
}));

vi.mock('@/lib/session-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof SessionAuthModule>();
  return { ...actual, resolveTenantAccess: vi.fn() };
});

vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }));

import { createAdminClient, quizDefinitions, staffAuditLog } from '@estalara/db';
import { resolveTenantAccess, type TenantAccess } from '@/lib/session-auth';
import { GET, PUT } from './route';
import { GET as GET_VERSIONS } from './versions/route';
import { PUT as PUT_ACTIVATE } from './activate/route';
import { PUT as PUT_DEACTIVATE } from './deactivate/route';

const mockResolve = vi.mocked(resolveTenantAccess);

const TENANT_A = '550e8400-e29b-41d4-a716-446655440042';
const TENANT_B = '660e8400-e29b-41d4-a716-446655440099';

/**
 * A LEGACY (pre-Q1) definition: passes the SERVE schema, fails the AUTHORING schema (English
 * only, no `confirm`). Reaches yield_hunter + flip_investor; everything else is unreachable.
 */
const LEGACY_DEF = {
  schema_version: 1 as const,
  root: 'q_gate',
  languages: ['en'] as const,
  questions: [
    {
      id: 'q_gate',
      prompt_i18n: { en: 'What are you after?' },
      answers: [
        { id: 'a_yield', label_i18n: { en: 'Yield' }, weights: { yield_hunter: 1 }, next: null },
        { id: 'a_flip', label_i18n: { en: 'Flip' }, weights: { flip_investor: 1 }, next: null },
      ],
    },
  ],
};

/** An AUTHORING-valid definition (EN + PL, confirm block): the built-in v2 default. */
const VALID_DEF = DEFAULT_QUIZ_DEFINITION_V2;

/** A stored blob the serve schema rejects (unknown archetype id). */
const BROKEN_DEF = {
  schema_version: 1,
  root: 'q_gate',
  languages: ['en'],
  questions: [
    {
      id: 'q_gate',
      prompt_i18n: { en: 'x' },
      answers: [
        { id: 'a', label_i18n: { en: 'a' }, weights: { not_real: 1 }, next: null },
        { id: 'b', label_i18n: { en: 'b' }, weights: {}, next: null },
      ],
    },
  ],
};

async function hashOf(def: unknown): Promise<string> {
  return computeQuizDefinitionHash(QuizDefinitionSchema.parse(def));
}

// ─── Access fixtures ──────────────────────────────────────────────────────────

function staffAccess(
  tenantId: string,
  role: 'estalara:superadmin' | 'estalara:ops' | 'estalara:readonly' = 'estalara:ops',
): TenantAccess {
  const rank = { 'estalara:superadmin': 3, 'estalara:ops': 2, 'estalara:readonly': 1 }[role];
  return {
    via: 'staff',
    tenantId,
    staff: {
      sub: 'staff-uuid-777',
      email: 'staff@estalara.com',
      tenant_id: null,
      estalara_staff: true,
      estalara_role: role,
      mfa_verified: true,
    },
    role,
    canWrite: rank >= 2,
    isSuperadmin: rank >= 3,
  };
}

// ─── Stateful fake DB ───────────────────────────────────────────────────────

interface DefRow {
  tenantId: string;
  version: number;
  definition: unknown;
  isActive: boolean;
  createdBy: string | null;
  createdAt: Date;
}

interface Cond {
  kind: string;
  col?: unknown;
  val?: unknown;
  conds?: Cond[];
}

/** Collect the `eq(col, val)` leaves of a where condition tree. */
function eqLeaves(w: Cond): Map<unknown, unknown> {
  const out = new Map<unknown, unknown>();
  const walk = (c: Cond): void => {
    if (c.kind === 'eq') out.set(c.col, c.val);
    if (c.kind === 'and') c.conds?.forEach(walk);
  };
  walk(w);
  return out;
}

function matches(r: DefRow, w: Cond): boolean {
  const leaves = eqLeaves(w);
  if (r.tenantId !== leaves.get(quizDefinitions.tenantId)) return false;
  if (leaves.has(quizDefinitions.isActive) && r.isActive !== leaves.get(quizDefinitions.isActive))
    return false;
  if (leaves.has(quizDefinitions.version) && r.version !== leaves.get(quizDefinitions.version))
    return false;
  return true;
}

/** Yield a macrotask so concurrent fake transactions interleave like real round trips. */
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function seedRow(
  tenantId: string,
  version: number,
  definition: unknown,
  isActive: boolean,
): DefRow {
  return {
    tenantId,
    version,
    definition,
    isActive,
    createdBy: null,
    createdAt: new Date(Date.UTC(2026, 9, 1, 0, version)),
  };
}

function makeDb(seed: DefRow[]) {
  let rows: DefRow[] = seed.map((r) => ({ ...r }));
  const auditRows: Record<string, unknown>[] = [];
  const control = { failAudit: false };
  /** Every `execute()` statement, in order, with the transaction it ran in. */
  const statements: { txId: number; text: string; values: unknown[] }[] = [];
  /** Per-transaction statement log (first statement must be the lock). */
  const txFirstStatement = new Map<number, string>();
  const locks = new Map<string, Promise<void>>();

  const selectFrom = (read: () => DefRow[]) =>
    vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn((w: Cond) => {
          const result = async (n: number): Promise<DefRow[]> => {
            await tick();
            return read()
              .filter((r) => matches(r, w))
              .sort((a, b) => b.version - a.version)
              .slice(0, n)
              .map((r) => ({ ...r }));
          };
          return {
            limit: vi.fn((n: number) => result(n)),
            orderBy: vi.fn(() => ({ limit: vi.fn((n: number) => result(n)) })),
          };
        }),
      })),
    }));

  let nextTxId = 0;
  const db = {
    get _rows(): DefRow[] {
      return rows;
    },
    _auditRows: auditRows,
    _control: control,
    _statements: statements,
    _txFirstStatement: txFirstStatement,
    select: selectFrom(() => rows),
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const txId = ++nextTxId;
      const txState: { staged: DefRow[] | null; release: (() => void) | null } = {
        staged: null,
        release: null,
      };
      const stagedAudit: Record<string, unknown>[] = [];
      // READ COMMITTED approximation: the snapshot is taken at the first statement after the
      // lock (or at the very first statement when the transaction takes no lock).
      const view = (): DefRow[] => {
        txState.staged ??= rows.map((r) => ({ ...r }));
        return txState.staged;
      };
      const note = (text: string): void => {
        if (!txFirstStatement.has(txId)) txFirstStatement.set(txId, text);
      };
      const tx = {
        execute: vi.fn(async (q: { text: string; values: unknown[] }) => {
          note(q.text);
          statements.push({ txId, text: q.text, values: q.values });
          if (q.text.includes('pg_advisory_xact_lock')) {
            const key = JSON.stringify(q.values);
            const prior = locks.get(key) ?? Promise.resolve();
            const held = new Promise<void>((resolve) => {
              txState.release = resolve;
            });
            locks.set(
              key,
              prior.then(() => held),
            );
            await prior;
          }
          await tick();
          return [];
        }),
        select: vi.fn(() => {
          note('select');
          return selectFrom(view)();
        }),
        update: vi.fn(() => {
          note('update');
          return {
            set: vi.fn((values: Partial<DefRow>) => ({
              where: vi.fn(async (w: Cond) => {
                await tick();
                for (const r of view()) if (matches(r, w)) Object.assign(r, values);
              }),
            })),
          };
        }),
        insert: vi.fn((table: unknown) => {
          note('insert');
          if (table === staffAuditLog) {
            return {
              values: vi.fn(async (v: Record<string, unknown>) => {
                await tick();
                if (control.failAudit) throw new Error('audit sink down');
                stagedAudit.push(v);
              }),
            };
          }
          if (table === quizDefinitions) {
            return {
              values: vi.fn(async (v: Partial<DefRow>) => {
                await tick();
                view().push({
                  tenantId: v.tenantId ?? '',
                  version: v.version ?? 1,
                  definition: v.definition,
                  isActive: v.isActive ?? true,
                  createdBy: v.createdBy ?? null,
                  createdAt: new Date(),
                });
              }),
            };
          }
          throw new Error('unexpected insert() target in test fake');
        }),
      };
      try {
        const result = await fn(tx);
        if (txState.staged) rows = txState.staged; // commit
        auditRows.push(...stagedAudit);
        return result;
      } finally {
        txState.release?.();
      }
    }),
  };
  vi.mocked(createAdminClient).mockReturnValue(
    db as unknown as ReturnType<typeof createAdminClient>,
  );
  return db;
}

function makeRequest(opts?: {
  method?: string;
  body?: unknown;
  query?: Record<string, string>;
}): NextRequest {
  const url = new URL('http://localhost/api/admin/tenants/quiz-definition');
  if (opts?.query) for (const [k, v] of Object.entries(opts.query)) url.searchParams.set(k, v);
  return new NextRequest(url.toString(), {
    method: opts?.method ?? 'GET',
    headers: {
      Authorization: 'Bearer mock-token',
      'user-agent': 'vitest-agent',
      'x-forwarded-for': '203.0.113.7',
      ...(opts?.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(opts?.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
}

function put(body: unknown, tenantId = TENANT_A): NextRequest {
  return makeRequest({ method: 'PUT', query: { tenant_id: tenantId }, body });
}

interface AuditRow {
  action: string;
  adminUserId: string;
  targetTenantId: string;
  payload: Record<string, unknown> & {
    before: { version: number | null; sha256: string | null };
    after: Record<string, unknown>;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ═══════════════════════════════════════════════════════════════════════════
// GET
// ═══════════════════════════════════════════════════════════════════════════

describe('GET /api/admin/tenants/quiz-definition', () => {
  it('staff → 200 with the active definition + unreachable-archetype warning', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A));
    makeDb([seedRow(TENANT_A, 3, LEGACY_DEF, true)]);

    const res = await GET(makeRequest({ query: { tenant_id: TENANT_A } }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as QuizDefinitionState;
    expect(body.version).toBe(3);
    expect(body.definition?.root).toBe('q_gate');
    // Non-blocking warning present: only yield_hunter + flip_investor are reachable.
    expect(body.warnings.unreachable_archetypes).toContain('student_parent');
    expect(body.warnings.unreachable_archetypes).not.toContain('yield_hunter');
    // FOLLOW-1362: rank verdict + lint of the active definition (legacy → authoring errors).
    expect(body.can_write).toBe(true);
    expect(body.invalid_active).toBe(false);
    expect(body.raw).toBeNull();
    expect(body.lint?.errors.map((e) => e.code)).toContain('missing_translation');
  });

  it('staff, no saved definition → 200 with version null + empty warning', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A));
    makeDb([]);
    const res = await GET(makeRequest({ query: { tenant_id: TENANT_A } }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as QuizDefinitionState;
    expect(body.version).toBeNull();
    expect(body.definition).toBeNull();
    expect(body.warnings.unreachable_archetypes).toEqual([]);
    expect(body.invalid_active).toBe(false);
    expect(body.lint).toBeNull();
  });

  it('readonly staff → can_write false (the editor renders read-only)', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A, 'estalara:readonly'));
    makeDb([seedRow(TENANT_A, 1, VALID_DEF, true)]);
    const body = (await (
      await GET(makeRequest({ query: { tenant_id: TENANT_A } }))
    ).json()) as QuizDefinitionState;
    expect(body.can_write).toBe(false);
    expect(body.lint?.errors).toEqual([]);
  });

  it('active row failing the serve schema → invalid_active + raw JSON, not a silent null', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A));
    makeDb([seedRow(TENANT_A, 4, BROKEN_DEF, true)]);
    const res = await GET(makeRequest({ query: { tenant_id: TENANT_A } }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as QuizDefinitionState;
    expect(body.version).toBe(4);
    expect(body.definition).toBeNull();
    expect(body.invalid_active).toBe(true);
    expect(body.raw).toEqual(BROKEN_DEF);
    expect(body.lint).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PUT
// ═══════════════════════════════════════════════════════════════════════════

describe('PUT /api/admin/tenants/quiz-definition', () => {
  it('staff ops → saves a new active version + atomic staff_audit_log row', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A));
    const db = makeDb([seedRow(TENANT_A, 1, LEGACY_DEF, true)]);

    const res = await PUT(put({ definition: VALID_DEF }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as QuizDefinitionState;
    expect(body.version).toBe(2);
    expect(body.lint?.errors).toEqual([]);

    // Exactly one active row now, at version 2; the prior version deactivated.
    const active = db._rows.filter((r) => r.tenantId === TENANT_A && r.isActive);
    expect(active).toHaveLength(1);
    expect(active[0]!.version).toBe(2);
    expect(db._rows.some((r) => r.version === 1 && !r.isActive)).toBe(true);

    // Audit row: correct action + attribution + version pair + sha256, never the blob.
    expect(db._auditRows).toHaveLength(1);
    const audit = db._auditRows[0] as unknown as AuditRow;
    expect(audit.action).toBe('quiz_definition.update');
    expect(audit.adminUserId).toBe('staff-uuid-777');
    expect(audit.targetTenantId).toBe(TENANT_A);
    expect(audit.payload.before).toEqual({ version: 1, sha256: await hashOf(LEGACY_DEF) });
    expect(audit.payload.after).toEqual({
      version: 2,
      root: VALID_DEF.root,
      sha256: await hashOf(VALID_DEF),
      questions: VALID_DEF.questions.length,
      answers: VALID_DEF.questions.reduce((n, q) => n + q.answers.length, 0),
    });
    expect(audit.payload.source).toBe('editor');
    expect(JSON.stringify(audit.payload)).not.toContain('prompt_i18n');
    expect(db.transaction).toHaveBeenCalledTimes(1);
  });

  it('takes the per-tenant advisory lock as the FIRST statement of the transaction', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A));
    const db = makeDb([]);
    await PUT(put({ definition: VALID_DEF }));
    expect(db._statements).toHaveLength(1);
    expect(db._statements[0]!.text).toContain('pg_advisory_xact_lock');
    expect(db._statements[0]!.values).toEqual([TENANT_A]);
    expect([...db._txFirstStatement.values()][0]).toContain('pg_advisory_xact_lock');
  });

  it('first save (no prior) → version 1, before {version: null, sha256: null}', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A));
    const db = makeDb([]);
    const res = await PUT(put({ definition: VALID_DEF, base_version: null, source: 'import' }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as QuizDefinitionState;
    expect(body.version).toBe(1);
    expect(db._rows).toHaveLength(1);
    const audit = db._auditRows[0] as unknown as AuditRow;
    expect(audit.payload.before).toEqual({ version: null, sha256: null });
    expect(audit.payload.source).toBe('import');
  });

  it('a version after a revert continues from max(version), not from the active row', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A));
    const db = makeDb([seedRow(TENANT_A, 5, LEGACY_DEF, false)]);
    const res = await PUT(put({ definition: VALID_DEF, base_version: null }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as QuizDefinitionState).version).toBe(6);
    expect(db._rows.filter((r) => r.isActive).map((r) => r.version)).toEqual([6]);
  });

  it('HARD validation (unknown archetype id) → 400, no mutation / no audit', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A));
    const db = makeDb([]);
    const res = await PUT(put({ definition: BROKEN_DEF }));
    expect(res.status).toBe(400);
    expect(db._rows).toHaveLength(0);
    expect(db._auditRows).toHaveLength(0);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('AUTHORING error (English-only, no confirm) → 400 with lint codes, no tx / no audit', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A));
    const db = makeDb([seedRow(TENANT_A, 1, VALID_DEF, true)]);
    const res = await PUT(put({ definition: LEGACY_DEF }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      error: { code: string; issues: { code: string; path: unknown[] }[] };
    };
    expect(body.error.code).toBe('validation_failed');
    const codes = body.error.issues.map((i) => i.code);
    expect(codes).toContain('missing_translation');
    expect(codes).toContain('confirm_missing');
    expect(db.transaction).not.toHaveBeenCalled();
    expect(db._rows).toHaveLength(1);
    expect(db._rows[0]!.version).toBe(1);
    expect(db._auditRows).toHaveLength(0);
  });

  it('bad source value → 400, no tx', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A));
    const db = makeDb([]);
    const res = await PUT(put({ definition: VALID_DEF, source: 'api' }));
    expect(res.status).toBe(400);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('below-ops staff (readonly) → 403 and NO mutation / audit row', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A, 'estalara:readonly'));
    const db = makeDb([]);
    const res = await PUT(put({ definition: VALID_DEF }));
    expect(res.status).toBe(403);
    expect(db._rows).toHaveLength(0);
    expect(db._auditRows).toHaveLength(0);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('audit insert fails → whole tx rolls back → 500, nothing persisted (Rule K.2)', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A));
    const db = makeDb([seedRow(TENANT_A, 1, LEGACY_DEF, true)]);
    db._control.failAudit = true;

    const res = await PUT(put({ definition: VALID_DEF }));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('audit_write_failed');
    // Rollback: prior version still the only active row, no new version, no audit.
    const active = db._rows.filter((r) => r.tenantId === TENANT_A && r.isActive);
    expect(active).toHaveLength(1);
    expect(active[0]!.version).toBe(1);
    expect(db._rows).toHaveLength(1);
    expect(db._auditRows).toHaveLength(0);
  });

  it('tenant fence (invariant 5): the save is attributed to ONLY the resolved tenant', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A));
    const db = makeDb([seedRow(TENANT_B, 9, VALID_DEF, true)]);

    await PUT(put({ definition: VALID_DEF }));
    // The new active row belongs to TENANT_A at version 1 (B's max is not A's); B untouched.
    const newRow = db._rows.find((r) => r.tenantId === TENANT_A);
    expect(newRow?.isActive).toBe(true);
    expect(newRow?.version).toBe(1);
    const tenantBRow = db._rows.find((r) => r.tenantId === TENANT_B);
    expect(tenantBRow?.isActive).toBe(true);
    expect(tenantBRow?.version).toBe(9);
    const audit = db._auditRows[0] as { targetTenantId: string };
    expect(audit.targetTenantId).toBe(TENANT_A);
  });

  it('base_version matches the active version → 200', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A));
    makeDb([seedRow(TENANT_A, 3, LEGACY_DEF, true)]);
    const res = await PUT(put({ definition: VALID_DEF, base_version: 3 }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as QuizDefinitionState).version).toBe(4);
  });

  it('stale base_version → 409 version_conflict, rolled back, no audit', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A));
    const db = makeDb([seedRow(TENANT_A, 3, LEGACY_DEF, true)]);
    const res = await PUT(put({ definition: VALID_DEF, base_version: 2 }));
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string; active_version: number } };
    expect(body.error.code).toBe('version_conflict');
    expect(body.error.active_version).toBe(3);
    expect(db._rows).toHaveLength(1);
    expect(db._rows[0]!.isActive).toBe(true);
    expect(db._auditRows).toHaveLength(0);
  });

  it('base_version null while a version is active → 409 version_conflict', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A));
    const db = makeDb([seedRow(TENANT_A, 1, LEGACY_DEF, true)]);
    const res = await PUT(put({ definition: VALID_DEF, base_version: null }));
    expect(res.status).toBe(409);
    expect(db._rows).toHaveLength(1);
  });

  it('two concurrent PUTs → distinct versions, exactly one active, two audit rows', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A));
    const db = makeDb([seedRow(TENANT_A, 1, LEGACY_DEF, true)]);

    const [r1, r2] = await Promise.all([
      PUT(put({ definition: VALID_DEF })),
      PUT(put({ definition: VALID_DEF, source: 'import' })),
    ]);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    const versions = [
      ((await r1.json()) as QuizDefinitionState).version,
      ((await r2.json()) as QuizDefinitionState).version,
    ].sort();
    expect(versions).toEqual([2, 3]);
    expect(db._rows.map((r) => r.version).sort()).toEqual([1, 2, 3]);
    expect(db._rows.filter((r) => r.isActive).map((r) => r.version)).toEqual([3]);
    const audits = db._auditRows as unknown as AuditRow[];
    expect(audits.map((a) => a.payload.after.version).sort()).toEqual([2, 3]);
    // The second writer's `before` is the first writer's commit, not the stale version 1.
    expect(audits.map((a) => a.payload.before.version).sort()).toEqual([1, 2]);
  });

  it('two concurrent PUTs with the same base_version → one 200, one 409', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A));
    const db = makeDb([seedRow(TENANT_A, 1, LEGACY_DEF, true)]);
    const statuses = (
      await Promise.all([
        PUT(put({ definition: VALID_DEF, base_version: 1 })),
        PUT(put({ definition: VALID_DEF, base_version: 1 })),
      ])
    )
      .map((r) => r.status)
      .sort();
    expect(statuses).toEqual([200, 409]);
    expect(db._rows).toHaveLength(2);
    expect(db._auditRows).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// GET …/versions
// ═══════════════════════════════════════════════════════════════════════════

describe('GET /api/admin/tenants/quiz-definition/versions', () => {
  it('lists the newest 50 versions with sha256 + counts, tenant-fenced, no blob', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A, 'estalara:readonly'));
    const seed: DefRow[] = [];
    for (let v = 1; v <= 55; v++) seed.push(seedRow(TENANT_A, v, VALID_DEF, v === 55));
    seed[0] = seedRow(TENANT_A, 1, LEGACY_DEF, false);
    seed.push(seedRow(TENANT_B, 99, VALID_DEF, true));
    seed[53] = { ...seedRow(TENANT_A, 54, VALID_DEF, false), createdBy: 'staff-uuid-1' };
    makeDb(seed);

    const res = await GET_VERSIONS(makeRequest({ query: { tenant_id: TENANT_A } }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as QuizDefinitionVersionsResponse;
    expect(body.tenant_id).toBe(TENANT_A);
    expect(body.versions).toHaveLength(50);
    expect(body.versions[0]!.version).toBe(55);
    expect(body.versions[49]!.version).toBe(6);
    expect(body.versions.some((v) => v.version === 99)).toBe(false);
    expect(body.versions[0]).toEqual({
      version: 55,
      is_active: true,
      created_at: new Date(Date.UTC(2026, 9, 1, 0, 55)).toISOString(),
      created_by: null,
      question_count: VALID_DEF.questions.length,
      answer_count: VALID_DEF.questions.reduce((n, q) => n + q.answers.length, 0),
      sha256: await hashOf(VALID_DEF),
      valid: true,
    });
    expect(body.versions[1]!.created_by).toBe('staff-uuid-1');
    expect(JSON.stringify(body)).not.toContain('prompt_i18n');
  });

  it('&version=N → that row with its full definition + lint', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A));
    makeDb([seedRow(TENANT_A, 1, LEGACY_DEF, false), seedRow(TENANT_A, 2, VALID_DEF, true)]);
    const res = await GET_VERSIONS(makeRequest({ query: { tenant_id: TENANT_A, version: '1' } }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as QuizDefinitionVersionDetail;
    expect(body.version).toBe(1);
    expect(body.is_active).toBe(false);
    expect(body.definition).toEqual(QuizDefinitionSchema.parse(LEGACY_DEF));
    expect(body.sha256).toBe(await hashOf(LEGACY_DEF));
    expect(body.raw).toBeNull();
    expect(body.lint?.errors.length).toBeGreaterThan(0);
  });

  it('&version=N of a row failing the serve schema → valid false + raw', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A));
    makeDb([seedRow(TENANT_A, 7, BROKEN_DEF, false)]);
    const res = await GET_VERSIONS(makeRequest({ query: { tenant_id: TENANT_A, version: '7' } }));
    const body = (await res.json()) as QuizDefinitionVersionDetail;
    expect(body.valid).toBe(false);
    expect(body.definition).toBeNull();
    expect(body.sha256).toBeNull();
    expect(body.raw).toEqual(BROKEN_DEF);
  });

  it("&version=N of ANOTHER tenant's row → 404", async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A));
    makeDb([seedRow(TENANT_B, 3, VALID_DEF, true)]);
    const res = await GET_VERSIONS(makeRequest({ query: { tenant_id: TENANT_A, version: '3' } }));
    expect(res.status).toBe(404);
  });

  it('&version=abc → 400', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A));
    makeDb([]);
    const res = await GET_VERSIONS(makeRequest({ query: { tenant_id: TENANT_A, version: 'abc' } }));
    expect(res.status).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PUT …/activate
// ═══════════════════════════════════════════════════════════════════════════

describe('PUT /api/admin/tenants/quiz-definition/activate', () => {
  it('copy-forward: restores v1 as v3 with an atomic quiz_definition.restore audit', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A));
    const db = makeDb([
      seedRow(TENANT_A, 1, LEGACY_DEF, false),
      seedRow(TENANT_A, 2, VALID_DEF, true),
    ]);

    const res = await PUT_ACTIVATE(put({ from_version: 1, base_version: 2 }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as QuizDefinitionRestoreResponse;
    expect(body.version).toBe(3);
    expect(body.restored_from).toBe(1);
    // Serve-schema only: the legacy row restores although it fails the authoring rules; the
    // lint is RETURNED, not enforced (restore is the panic button).
    expect(body.lint?.errors.map((e) => e.code)).toContain('missing_translation');

    // History append-only: v1 and v2 untouched (both inactive now), v3 is the copy.
    expect(db._rows.map((r) => [r.version, r.isActive])).toEqual([
      [1, false],
      [2, false],
      [3, true],
    ]);
    expect(db._rows[2]!.definition).toEqual(QuizDefinitionSchema.parse(LEGACY_DEF));
    expect(db._rows[2]!.createdBy).toBe('staff-uuid-777');

    expect(db._auditRows).toHaveLength(1);
    const audit = db._auditRows[0] as unknown as AuditRow;
    expect(audit.action).toBe('quiz_definition.restore');
    expect(audit.targetTenantId).toBe(TENANT_A);
    expect(audit.payload.restored_from).toBe(1);
    expect(audit.payload.before).toEqual({ version: 2, sha256: await hashOf(VALID_DEF) });
    expect(audit.payload.after).toEqual({
      version: 3,
      root: 'q_gate',
      sha256: await hashOf(LEGACY_DEF),
      questions: 1,
      answers: 2,
    });
    expect(db._statements[0]!.text).toContain('pg_advisory_xact_lock');
  });

  it('audit insert fails → rollback → 500, nothing changes', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A));
    const db = makeDb([
      seedRow(TENANT_A, 1, LEGACY_DEF, false),
      seedRow(TENANT_A, 2, VALID_DEF, true),
    ]);
    db._control.failAudit = true;
    const res = await PUT_ACTIVATE(put({ from_version: 1, base_version: 2 }));
    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      'audit_write_failed',
    );
    expect(db._rows.map((r) => [r.version, r.isActive])).toEqual([
      [1, false],
      [2, true],
    ]);
    expect(db._auditRows).toHaveLength(0);
  });

  it('readonly staff → 403, no tx', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A, 'estalara:readonly'));
    const db = makeDb([
      seedRow(TENANT_A, 1, LEGACY_DEF, false),
      seedRow(TENANT_A, 2, VALID_DEF, true),
    ]);
    const res = await PUT_ACTIVATE(put({ from_version: 1, base_version: 2 }));
    expect(res.status).toBe(403);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("another tenant's version → 404, nothing changes", async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A));
    const db = makeDb([
      seedRow(TENANT_A, 2, VALID_DEF, true),
      seedRow(TENANT_B, 7, LEGACY_DEF, false),
    ]);
    const res = await PUT_ACTIVATE(put({ from_version: 7, base_version: 2 }));
    expect(res.status).toBe(404);
    expect(db._rows).toHaveLength(2);
    expect(db._rows[0]!.isActive).toBe(true);
    expect(db._auditRows).toHaveLength(0);
  });

  it('stale base_version → 409 version_conflict', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A));
    const db = makeDb([
      seedRow(TENANT_A, 1, LEGACY_DEF, false),
      seedRow(TENANT_A, 2, VALID_DEF, true),
    ]);
    const res = await PUT_ACTIVATE(put({ from_version: 1, base_version: 1 }));
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('version_conflict');
    expect(db._rows).toHaveLength(2);
  });

  it('restoring the active version → 409 already_active', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A));
    const db = makeDb([seedRow(TENANT_A, 2, VALID_DEF, true)]);
    const res = await PUT_ACTIVATE(put({ from_version: 2, base_version: 2 }));
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('already_active');
    expect(db._rows).toHaveLength(1);
  });

  it('source row failing the serve schema → 422, nothing changes', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A));
    const db = makeDb([
      seedRow(TENANT_A, 1, BROKEN_DEF, false),
      seedRow(TENANT_A, 2, VALID_DEF, true),
    ]);
    const res = await PUT_ACTIVATE(put({ from_version: 1, base_version: 2 }));
    expect(res.status).toBe(422);
    expect(db._rows.map((r) => r.isActive)).toEqual([false, true]);
    expect(db._auditRows).toHaveLength(0);
  });

  it('missing base_version → 400', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A));
    const db = makeDb([]);
    const res = await PUT_ACTIVATE(put({ from_version: 1 }));
    expect(res.status).toBe(400);
    expect(db.transaction).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PUT …/deactivate
// ═══════════════════════════════════════════════════════════════════════════

describe('PUT /api/admin/tenants/quiz-definition/deactivate', () => {
  it('active row → inactive + atomic quiz_definition.revert_to_default audit', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A));
    const db = makeDb([
      seedRow(TENANT_A, 4, VALID_DEF, true),
      seedRow(TENANT_B, 2, VALID_DEF, true),
    ]);

    const res = await PUT_DEACTIVATE(
      makeRequest({ method: 'PUT', query: { tenant_id: TENANT_A } }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as QuizDefinitionRevertResponse;
    expect(body).toEqual({ tenant_id: TENANT_A, version: null, reverted_from: 4 });
    // No row deleted; A has no active row; B untouched.
    expect(db._rows.map((r) => [r.tenantId, r.version, r.isActive])).toEqual([
      [TENANT_A, 4, false],
      [TENANT_B, 2, true],
    ]);
    const audit = db._auditRows[0] as unknown as AuditRow;
    expect(audit.action).toBe('quiz_definition.revert_to_default');
    expect(audit.targetTenantId).toBe(TENANT_A);
    expect(audit.payload).toEqual({
      before: { version: 4, sha256: await hashOf(VALID_DEF) },
      after: { version: null },
    });
    expect(db._statements[0]!.text).toContain('pg_advisory_xact_lock');
  });

  it('nothing active → 409 no_active_definition, no audit', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A));
    const db = makeDb([seedRow(TENANT_A, 4, VALID_DEF, false)]);
    const res = await PUT_DEACTIVATE(
      makeRequest({ method: 'PUT', query: { tenant_id: TENANT_A } }),
    );
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      'no_active_definition',
    );
    expect(db._auditRows).toHaveLength(0);
  });

  it('readonly staff → 403, no tx', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A, 'estalara:readonly'));
    const db = makeDb([seedRow(TENANT_A, 4, VALID_DEF, true)]);
    const res = await PUT_DEACTIVATE(
      makeRequest({ method: 'PUT', query: { tenant_id: TENANT_A } }),
    );
    expect(res.status).toBe(403);
    expect(db.transaction).not.toHaveBeenCalled();
    expect(db._rows[0]!.isActive).toBe(true);
  });

  it('audit insert fails → rollback → 500, the row stays active', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A));
    const db = makeDb([seedRow(TENANT_A, 4, VALID_DEF, true)]);
    db._control.failAudit = true;
    const res = await PUT_DEACTIVATE(
      makeRequest({ method: 'PUT', query: { tenant_id: TENANT_A } }),
    );
    expect(res.status).toBe(500);
    expect(db._rows[0]!.isActive).toBe(true);
    expect(db._auditRows).toHaveLength(0);
  });

  it('stale base_version → 409 version_conflict, the row stays active', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A));
    const db = makeDb([seedRow(TENANT_A, 4, VALID_DEF, true)]);
    const res = await PUT_DEACTIVATE(put({ base_version: 3 }));
    expect(res.status).toBe(409);
    expect(db._rows[0]!.isActive).toBe(true);
  });
});
