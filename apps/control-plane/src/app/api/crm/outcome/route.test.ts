/**
 * Unit tests for POST /api/crm/outcome — FOLLOW-172 CRM deep-outcome ingest.
 *
 * Coverage:
 *
 * Auth gate (compliance condition 5):
 *   - Missing Authorization header → 401 AUTH_REQUIRED
 *   - Empty Bearer token → 401 AUTH_REQUIRED
 *   - ADAPT_API_KEY + matching Bearer + ADAPT_TENANT_ID set → 200 (ops fallback)
 *   - ADAPT_API_KEY set but ADAPT_TENANT_ID missing → 401 FORBIDDEN
 *   - Wrong Bearer when ADAPT_API_KEY set → 401 FORBIDDEN
 *   - ADAPT_API_KEY unset + missing X-Estalara-Signature → 401 FORBIDDEN
 *   - ADAPT_API_KEY unset + malformed signature (not 64 hex) → 401 FORBIDDEN
 *   - ADAPT_API_KEY unset + wrong HMAC → 401 FORBIDDEN
 *   - Valid HMAC + DB lookup resolves tenant → 200
 *
 * .strict() deny-list (compliance condition 1):
 *   - Unknown field → 400 VALIDATION_ERROR
 *   - `email` field → 400 VALIDATION_ERROR
 *   - `name` field → 400 VALIDATION_ERROR
 *   - `phone` field → 400 VALIDATION_ERROR
 *   - `crm_contact_id` field → 400 VALIDATION_ERROR
 *   - `notes` field → 400 VALIDATION_ERROR
 *   - `hubspot_contact_id` field → 400 VALIDATION_ERROR
 *   - `salesforce_lead_id` field → 400 VALIDATION_ERROR
 *
 * Shallow-class rejection (taxonomy boundary §T.4):
 *   - outcome_class='viewing_booked' → 400 VALIDATION_ERROR
 *   - outcome_class='no_response' → 400 VALIDATION_ERROR
 *
 * Deep-class acceptance:
 *   - offer_made → 200, upsertConversionLabel called with correct args
 *   - contract_signed → 200
 *   - purchased → 200
 *   - lost → 200
 *
 * Field requirements (compliance conditions 3, 4):
 *   - Missing prediction_id → 400 (NOT NULL, condition 3)
 *   - Empty prediction_id → 400 (min length 1, condition 3)
 *   - Missing lead_id → 400 (required, condition 3)
 *   - Empty lead_id → 400 (min length 1, condition 3)
 *   - tenant_id from auth context NOT body (condition 4)
 *
 * Successful upsert (compliance conditions 2, 6):
 *   - upsertConversionLabel called with label_source='system', confidence=1.0 default
 *   - outcome_raw from parsed.data, not rawBody (condition 2)
 *   - SET LOCAL app.current_tenant_id called before upsert (condition 6)
 *
 * Error handling:
 *   - DB write failure → 500 INTERNAL_ERROR (fail-loud, not fail-open, Rule K.2)
 *   - Invalid JSON body → 400 VALIDATION_ERROR
 *
 * @module apps/control-plane/src/app/api/crm/outcome/route.test
 */

import { NextRequest } from 'next/server';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const {
  mockApiKeysSelect,
  mockUpsertConversionLabel,
  mockTransaction,
  mockExecute,
  mockCreateAdminClient,
} = vi.hoisted(() => {
  const mockExecute = vi.fn().mockResolvedValue([]);

  // transaction() receives a callback; we call it with a fake tx that has .execute()
  // and proxies upsertConversionLabel calls back to the mock.
  const mockTransaction = vi.fn().mockImplementation(async (fn: (tx: unknown) => Promise<void>) => {
    const tx = {
      execute: mockExecute,
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
        }),
      }),
    };
    await fn(tx);
  });

  // DB chain for api_keys SELECT: select().from().where().limit() → rows[]
  const mockApiKeysLimit = vi.fn().mockResolvedValue([]);
  const mockApiKeysWhere = vi.fn().mockReturnValue({ limit: mockApiKeysLimit });
  const mockApiKeysFrom = vi.fn().mockReturnValue({ where: mockApiKeysWhere });
  const mockApiKeysSelect = vi.fn().mockReturnValue({ from: mockApiKeysFrom });

  const mockCreateAdminClient = vi.fn(() => ({
    select: mockApiKeysSelect,
    transaction: mockTransaction,
  }));

  const mockUpsertConversionLabel = vi.fn().mockResolvedValue(undefined);

  return {
    mockApiKeysSelect,
    mockApiKeysLimit,
    mockUpsertConversionLabel,
    mockTransaction,
    mockExecute,
    mockCreateAdminClient,
  };
});

vi.mock('@estalara/db', () => ({
  createAdminClient: mockCreateAdminClient,
  apiKeys: {
    hashedKey: 'hashed_key',
    tenantId: 'tenant_id',
    revokedAt: 'revoked_at',
    expiresAt: 'expires_at',
  },
  upsertConversionLabel: mockUpsertConversionLabel,
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col: unknown, val: unknown) => ({ kind: 'eq', col, val })),
  and: vi.fn((...preds: unknown[]) => ({ kind: 'and', preds })),
  isNull: vi.fn((col: unknown) => ({ kind: 'isNull', col })),
  or: vi.fn((...args: unknown[]) => ({ kind: 'or', args })),
  gt: vi.fn((col: unknown, val: unknown) => ({ kind: 'gt', col, val })),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    _sql: strings.join('?'),
    values,
  })),
}));

import { POST } from './route';

// ─── HMAC helper ──────────────────────────────────────────────────────────────

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

// ─── Request builders ─────────────────────────────────────────────────────────

function makeRequest(
  body: unknown,
  opts: {
    authHeader?: string | null;
    signatureHeader?: string | null;
  } = {},
): NextRequest {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const { authHeader = 'Bearer test_key', signatureHeader = null } = opts;
  if (authHeader !== null) headers.Authorization = authHeader;
  if (signatureHeader !== null) headers['X-Estalara-Signature'] = signatureHeader;
  return new NextRequest('http://localhost/api/crm/outcome', {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

async function makeSignedRequest(body: unknown, apiKey = 'test_key'): Promise<NextRequest> {
  const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
  const sig = await computeHmac(apiKey, bodyStr);
  return new NextRequest('http://localhost/api/crm/outcome', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'X-Estalara-Signature': sig,
    },
    body: bodyStr,
  });
}

const VALID_BODY = {
  prediction_id: 'decision-uuid-001',
  lead_id: 'lead-opaque-token-001',
  outcome_class: 'offer_made' as const,
};

// ─── Test setup ───────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  // Default: api_keys lookup returns a matching tenant row.
  mockApiKeysSelect.mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue([{ tenantId: 'tenant-uuid-from-db' }]),
      }),
    }),
  });
  mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<void>) => {
    const tx = { execute: mockExecute };
    await fn(tx);
  });
  mockUpsertConversionLabel.mockResolvedValue(undefined);
  mockExecute.mockResolvedValue([]);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ─── Auth gate ────────────────────────────────────────────────────────────────

describe('POST /api/crm/outcome — auth gate', () => {
  beforeEach(() => {
    vi.stubEnv('DATABASE_URL_ADMIN', 'postgresql://user:pass@localhost:5432/db');
    vi.stubEnv('ADAPT_API_KEY', '');
    vi.stubEnv('ADAPT_TENANT_ID', '');
  });

  it('missing Authorization header → 401 AUTH_REQUIRED', async () => {
    const res = await POST(makeRequest(VALID_BODY, { authHeader: null }));
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('AUTH_REQUIRED');
  });

  it('empty Bearer token → 401 AUTH_REQUIRED', async () => {
    const res = await POST(makeRequest(VALID_BODY, { authHeader: 'Bearer ' }));
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('AUTH_REQUIRED');
  });

  it('ADAPT_API_KEY match + ADAPT_TENANT_ID set → 200 ops fallback', async () => {
    vi.stubEnv('ADAPT_API_KEY', 'ops_key');
    vi.stubEnv('ADAPT_TENANT_ID', 'ops-tenant-uuid');
    const res = await POST(makeRequest(VALID_BODY, { authHeader: 'Bearer ops_key' }));
    expect(res.status).toBe(200);
  });

  it('ADAPT_API_KEY match but ADAPT_TENANT_ID missing → 401 FORBIDDEN', async () => {
    vi.stubEnv('ADAPT_API_KEY', 'ops_key');
    vi.stubEnv('ADAPT_TENANT_ID', '');
    const res = await POST(makeRequest(VALID_BODY, { authHeader: 'Bearer ops_key' }));
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('wrong Bearer when ADAPT_API_KEY set → falls through to HMAC path → 401', async () => {
    vi.stubEnv('ADAPT_API_KEY', 'ops_key');
    vi.stubEnv('ADAPT_TENANT_ID', 'ops-tenant-uuid');
    // Wrong Bearer → ops fallback skipped; no HMAC sig → FORBIDDEN
    const res = await POST(makeRequest(VALID_BODY, { authHeader: 'Bearer wrong_key' }));
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('no signature → 401 FORBIDDEN', async () => {
    const res = await POST(makeRequest(VALID_BODY, { authHeader: 'Bearer some_key' }));
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('malformed signature (not 64 hex chars) → 401 FORBIDDEN', async () => {
    const res = await POST(
      makeRequest(VALID_BODY, {
        authHeader: 'Bearer some_key',
        signatureHeader: 'not-a-valid-hmac',
      }),
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('wrong HMAC → 401 FORBIDDEN', async () => {
    const badSig = 'a'.repeat(64); // 64 hex chars but wrong value
    const res = await POST(
      makeRequest(VALID_BODY, {
        authHeader: 'Bearer some_key',
        signatureHeader: badSig,
      }),
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('valid HMAC + DB key lookup succeeds → 200', async () => {
    const req = await makeSignedRequest(VALID_BODY, 'tenant_api_key');
    const res = await POST(req);
    expect(res.status).toBe(200);
  });

  it('valid HMAC but api_keys row not found → 401 FORBIDDEN', async () => {
    // DB returns no rows for this key hash
    mockApiKeysSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    });
    const req = await makeSignedRequest(VALID_BODY, 'unknown_key');
    const res = await POST(req);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('FORBIDDEN');
  });
});

// ─── .strict() deny-list (compliance condition 1) ───────────────────────────

describe('POST /api/crm/outcome — .strict() deny-list', () => {
  beforeEach(() => {
    vi.stubEnv('DATABASE_URL_ADMIN', 'postgresql://user:pass@localhost:5432/db');
    vi.stubEnv('ADAPT_API_KEY', 'test_key');
    vi.stubEnv('ADAPT_TENANT_ID', 'tenant-abc');
  });

  const cases: [string, Record<string, unknown>][] = [
    ['unknown field', { extra_unknown_field: 'foo' }],
    ['email', { email: 'buyer@example.com' }],
    ['name', { name: 'John Smith' }],
    ['full_name', { full_name: 'John Smith' }],
    ['first_name', { first_name: 'John' }],
    ['last_name', { last_name: 'Smith' }],
    ['phone', { phone: '+48123456789' }],
    ['phone_number', { phone_number: '+48123456789' }],
    ['address', { address: '1 High Street' }],
    ['crm_contact_id', { crm_contact_id: 'crm-123' }],
    ['hubspot_contact_id', { hubspot_contact_id: 'hs-123' }],
    ['salesforce_lead_id', { salesforce_lead_id: 'sf-lead-123' }],
    ['notes', { notes: 'Very interested buyer' }],
    ['description', { description: 'Some description' }],
    ['comments', { comments: 'Comment text' }],
    ['message', { message: 'Message text' }],
  ];

  it.each(cases)('body with %s → 400 VALIDATION_ERROR', async (_, extraFields) => {
    const body = { ...VALID_BODY, ...extraFields };
    const res = await POST(makeRequest(body, { authHeader: 'Bearer test_key' }));
    expect(res.status).toBe(400);
    const resBody = (await res.json()) as { error: { code: string } };
    expect(resBody.error.code).toBe('VALIDATION_ERROR');
  });
});

// ─── Shallow-class rejection (taxonomy boundary §T.4) ───────────────────────

describe('POST /api/crm/outcome — shallow-class rejection', () => {
  beforeEach(() => {
    vi.stubEnv('DATABASE_URL_ADMIN', 'postgresql://user:pass@localhost:5432/db');
    vi.stubEnv('ADAPT_API_KEY', 'test_key');
    vi.stubEnv('ADAPT_TENANT_ID', 'tenant-abc');
  });

  it('outcome_class=viewing_booked → 400 (shallow class rejected)', async () => {
    const body = { ...VALID_BODY, outcome_class: 'viewing_booked' };
    const res = await POST(makeRequest(body, { authHeader: 'Bearer test_key' }));
    expect(res.status).toBe(400);
    const resBody = (await res.json()) as { error: { code: string } };
    expect(resBody.error.code).toBe('VALIDATION_ERROR');
  });

  it('outcome_class=no_response → 400 (shallow class rejected)', async () => {
    const body = { ...VALID_BODY, outcome_class: 'no_response' };
    const res = await POST(makeRequest(body, { authHeader: 'Bearer test_key' }));
    expect(res.status).toBe(400);
    const resBody = (await res.json()) as { error: { code: string } };
    expect(resBody.error.code).toBe('VALIDATION_ERROR');
  });

  it.each(['offer_made', 'contract_signed', 'purchased', 'lost'])(
    'outcome_class=%s → 200 (deep class accepted)',
    async (outcomeClass) => {
      const body = { ...VALID_BODY, outcome_class: outcomeClass };
      const res = await POST(makeRequest(body, { authHeader: 'Bearer test_key' }));
      expect(res.status).toBe(200);
    },
  );
});

// ─── Field requirements (compliance conditions 3, 4) ────────────────────────

describe('POST /api/crm/outcome — field requirements', () => {
  beforeEach(() => {
    vi.stubEnv('DATABASE_URL_ADMIN', 'postgresql://user:pass@localhost:5432/db');
    vi.stubEnv('ADAPT_API_KEY', 'test_key');
    vi.stubEnv('ADAPT_TENANT_ID', 'tenant-abc');
  });

  it('missing prediction_id → 400 (NOT NULL, condition 3)', async () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- omitting field to test validation
    const { prediction_id: _pid, ...body } = VALID_BODY;
    const res = await POST(makeRequest(body, { authHeader: 'Bearer test_key' }));
    expect(res.status).toBe(400);
  });

  it('empty prediction_id → 400 (min length 1, condition 3)', async () => {
    const body = { ...VALID_BODY, prediction_id: '' };
    const res = await POST(makeRequest(body, { authHeader: 'Bearer test_key' }));
    expect(res.status).toBe(400);
  });

  it('missing lead_id → 400 (required, condition 3)', async () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- omitting field to test validation
    const { lead_id: _lid, ...body } = VALID_BODY;
    const res = await POST(makeRequest(body, { authHeader: 'Bearer test_key' }));
    expect(res.status).toBe(400);
  });

  it('empty lead_id → 400 (min length 1 — no-durable-lead must not silently proceed)', async () => {
    const body = { ...VALID_BODY, lead_id: '' };
    const res = await POST(makeRequest(body, { authHeader: 'Bearer test_key' }));
    expect(res.status).toBe(400);
  });

  it('tenant_id from auth context NOT body (condition 4)', async () => {
    vi.stubEnv('ADAPT_TENANT_ID', 'correct-tenant-from-auth');
    // Body doesn't have tenant_id (it would be rejected by .strict() if it did)
    const body = { ...VALID_BODY };
    const res = await POST(makeRequest(body, { authHeader: 'Bearer test_key' }));
    expect(res.status).toBe(200);

    // Verify upsertConversionLabel was called with the auth-context tenant_id
    expect(mockUpsertConversionLabel).toHaveBeenCalledOnce();
    const [, input] = mockUpsertConversionLabel.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(input.tenantId).toBe('correct-tenant-from-auth');
  });

  it('tenant_id in body rejected by .strict() → 400', async () => {
    const body = { ...VALID_BODY, tenant_id: 'injected-tenant-id' };
    const res = await POST(makeRequest(body, { authHeader: 'Bearer test_key' }));
    expect(res.status).toBe(400);
    const resBody = (await res.json()) as { error: { code: string } };
    expect(resBody.error.code).toBe('VALIDATION_ERROR');
  });
});

// ─── Successful upsert (compliance conditions 2, 6) ────────────────────────

describe('POST /api/crm/outcome — upsert correctness', () => {
  beforeEach(() => {
    vi.stubEnv('DATABASE_URL_ADMIN', 'postgresql://user:pass@localhost:5432/db');
    vi.stubEnv('ADAPT_API_KEY', 'test_key');
    vi.stubEnv('ADAPT_TENANT_ID', 'tenant-uuid-abc');
  });

  it('upsertConversionLabel called with label_source=system, confidence=1.0 default', async () => {
    const res = await POST(makeRequest(VALID_BODY, { authHeader: 'Bearer test_key' }));
    expect(res.status).toBe(200);
    expect(mockUpsertConversionLabel).toHaveBeenCalledOnce();
    const [, input] = mockUpsertConversionLabel.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(input.labelSource).toBe('system');
    expect(input.confidence).toBe(1.0);
    expect(input.predictionId).toBe('decision-uuid-001');
    expect(input.leadId).toBe('lead-opaque-token-001');
    expect(input.outcomeClass).toBe('offer_made');
  });

  it('explicit confidence value is forwarded', async () => {
    const body = { ...VALID_BODY, confidence: 0.85 };
    const res = await POST(makeRequest(body, { authHeader: 'Bearer test_key' }));
    expect(res.status).toBe(200);
    const [, input] = mockUpsertConversionLabel.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(input.confidence).toBe(0.85);
  });

  it('outcome_raw populated from parsed.data, not rawBody (condition 2)', async () => {
    const body = {
      ...VALID_BODY,
      outcome_raw: { deal_stage: 'verbal_offer', property_price: 450000 },
    };
    const res = await POST(makeRequest(body, { authHeader: 'Bearer test_key' }));
    expect(res.status).toBe(200);
    const [, input] = mockUpsertConversionLabel.mock.calls[0] as [unknown, Record<string, unknown>];
    // outcome_raw must be the parsed object, not the raw string
    expect(input.outcomeRaw).toEqual({ deal_stage: 'verbal_offer', property_price: 450000 });
  });

  it('SET LOCAL app.current_tenant_id called inside transaction (condition 6)', async () => {
    const res = await POST(makeRequest(VALID_BODY, { authHeader: 'Bearer test_key' }));
    expect(res.status).toBe(200);
    // The transaction must have been entered
    expect(mockTransaction).toHaveBeenCalledOnce();
    // mockExecute should have been called for the SET LOCAL
    expect(mockExecute).toHaveBeenCalledOnce();
    const [sqlArg] = mockExecute.mock.calls[0] as [{ _sql?: string; values?: unknown[] }];
    // The sql template for set_config should reference the tenant_id value
    expect(sqlArg.values).toContain('tenant-uuid-abc');
  });

  it('labeled_at forwarded when provided', async () => {
    const body = { ...VALID_BODY, labeled_at: '2026-05-01T12:00:00Z' };
    const res = await POST(makeRequest(body, { authHeader: 'Bearer test_key' }));
    expect(res.status).toBe(200);
    const [, input] = mockUpsertConversionLabel.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(input.labeledAt).toBeInstanceOf(Date);
    expect((input.labeledAt as Date).toISOString()).toBe('2026-05-01T12:00:00.000Z');
  });
});

// ─── Error handling (Rule K.2 — fail-loud) ──────────────────────────────────

describe('POST /api/crm/outcome — error handling', () => {
  beforeEach(() => {
    vi.stubEnv('DATABASE_URL_ADMIN', 'postgresql://user:pass@localhost:5432/db');
    vi.stubEnv('ADAPT_API_KEY', 'test_key');
    vi.stubEnv('ADAPT_TENANT_ID', 'tenant-abc');
  });

  it('DB write failure → 500 INTERNAL_ERROR (fail-loud, Rule K.2)', async () => {
    mockUpsertConversionLabel.mockRejectedValueOnce(new Error('unique constraint violation'));
    const res = await POST(makeRequest(VALID_BODY, { authHeader: 'Bearer test_key' }));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('INTERNAL_ERROR');
  });

  it('invalid JSON body → 400 VALIDATION_ERROR', async () => {
    const req = new NextRequest('http://localhost/api/crm/outcome', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test_key',
      },
      body: 'not-valid-json{',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('upsertConversionLabel NOT called when auth fails (auth is strict, not fire-and-forget)', async () => {
    const res = await POST(makeRequest(VALID_BODY, { authHeader: null }));
    expect(res.status).toBe(401);
    expect(mockUpsertConversionLabel).not.toHaveBeenCalled();
  });
});
