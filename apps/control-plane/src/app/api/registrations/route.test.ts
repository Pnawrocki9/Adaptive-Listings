import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@estalara/db', () => ({
  createAdminClient: vi.fn(),
  tenantRegistrations: {
    id: 'id',
    contactEmail: 'contact_email',
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col: unknown, val: unknown) => ({ col, val })),
}));

import { createAdminClient } from '@estalara/db';

import { POST } from './route';

async function parseBody<T>(res: Response): Promise<T> {
  const raw: unknown = await res.json();
  return raw as T;
}

const VALID_BODY = {
  agency_name: 'Acme Realty',
  website_url: 'https://acmerealty.com',
  contact_name: 'Jane Smith',
  contact_email: 'jane@acmerealty.com',
  country: 'Spain',
};

function makeDbMock(existingRows: unknown[] = []) {
  const insertReturning = vi.fn().mockResolvedValue([{ id: 'reg-uuid-001' }]);
  const insertValues = vi.fn().mockReturnValue({ returning: insertReturning });
  const insertCall = vi.fn().mockReturnValue({ values: insertValues });

  const selectLimitMock = vi.fn().mockResolvedValue(existingRows);
  const selectWhereMock = vi.fn().mockReturnValue({ limit: selectLimitMock });
  const selectFromMock = vi.fn().mockReturnValue({ where: selectWhereMock });
  const selectCall = vi.fn().mockReturnValue({ from: selectFromMock });

  return { select: selectCall, insert: insertCall };
}

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/registrations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/registrations', () => {
  it('returns 201 with registration_id on valid body', async () => {
    vi.mocked(createAdminClient).mockReturnValue(
      makeDbMock([]) as unknown as ReturnType<typeof createAdminClient>,
    );

    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(201);

    const body = await parseBody<{ registration_id: string; status: string; message: string }>(res);
    expect(body.registration_id).toBe('reg-uuid-001');
    expect(body.status).toBe('pending');
    expect(body.message).toContain('2 business days');
  });

  it('returns 409 when email already registered', async () => {
    vi.mocked(createAdminClient).mockReturnValue(
      makeDbMock([{ id: 'existing' }]) as unknown as ReturnType<typeof createAdminClient>,
    );

    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(409);

    const body = await parseBody<{ error: string }>(res);
    expect(body.error).toContain('already exists');
  });

  it('returns 400 when required fields are missing', async () => {
    const res = await POST(makeRequest({ agency_name: 'Acme' }));
    expect(res.status).toBe(400);

    const body = await parseBody<{ error: string }>(res);
    expect(body.error).toBe('Validation failed');
  });

  it('returns 400 for invalid email format', async () => {
    const res = await POST(makeRequest({ ...VALID_BODY, contact_email: 'not-an-email' }));
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid website_url', async () => {
    const res = await POST(makeRequest({ ...VALID_BODY, website_url: 'not-a-url' }));
    expect(res.status).toBe(400);
  });
});
