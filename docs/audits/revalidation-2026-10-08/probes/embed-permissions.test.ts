import { afterEach, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';

const observed = vi.hoisted(() => ({ writes: [] as unknown[], embed: vi.fn() }));
vi.mock('@/lib/openai-client', () => ({ embedTextWithDimensions: observed.embed }));
vi.mock('@estalara/db', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  createAdminClient: () => ({
    insert: () => ({
      values: (value: unknown) => {
        observed.writes.push(value);
        return { onConflictDoUpdate: () => Promise.resolve(undefined) };
      },
    }),
  }),
}));
import { POST } from '../../../../apps/control-plane/src/app/api/listings/embed/route';

afterEach(() => {
  vi.unstubAllEnvs();
  observed.writes.length = 0;
});

for (const expired of [false, true]) {
  it(`F-10 extension: real embed handler writes for agency:viewer; expired=${String(expired)}`, async () => {
    const tenant = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const secret = 'offline-audit-fixture';
    vi.stubEnv('SUPABASE_JWT_SECRET', secret);
    vi.stubEnv('OPENAI_API_KEY', 'offline-placeholder');
    observed.embed.mockResolvedValue(Array(1024).fill(0.01));
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(
      JSON.stringify({
        sub: 'fixture-user',
        email: 'fixture@example.invalid',
        tenant_id: tenant,
        agency_role: 'agency:viewer',
        exp: expired ? 1 : 4102444800,
      }),
    ).toString('base64url');
    const signature = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
    const response = await POST(
      new Request('http://localhost/api/listings/embed', {
        method: 'POST',
        headers: { Authorization: `Bearer ${header}.${body}.${signature}` },
        body: JSON.stringify({
          tenant_id: tenant,
          listing_id: 'fixture-listing',
          text_fields: { title: 'Seller title' },
        }),
      }) as never,
    );
    expect(response.status).toBe(200);
    expect(observed.writes).toHaveLength(1);
  });
}
