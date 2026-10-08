// Defect reproductions: passing means the observed defect exists, not that the product is safe.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { getAuthClaims } from '../../../../packages/auth/src/middleware';
import { checkSsrf } from '../../../../apps/control-plane/src/lib/ssrf';
import { EventSchema } from '../../../../packages/shared/src/schemas/events';
import { pushToClickHouse } from '../../../../apps/ingest/src/clickhouse-producer';
import { chunkRecordsForRetryQueue } from '../../../../apps/ingest/src/events-retry-queue';
import { deleteShadowChatIntent } from '../../../../apps/control-plane/src/lib/chat-intent-cache';
import {
  initIntentState,
  applyChatIntentPrior,
  applyBehavioralSignal,
  applyQuizLeaf,
} from '../../../../packages/sdk/src/core/intent';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
const event = {
  event_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  tenant_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  session_id: 's'.repeat(32),
  ts: Date.now(),
  region: 'eu',
  consent_state: 'consented',
  schema_version: 1,
  type: 'page.view',
  payload: { url: 'https://example.com/listing', device_class: 'desktop' },
};

describe('independent actual-helper reproductions', () => {
  it('F-09: correctly signed expired and future JWTs are both accepted', async () => {
    const secret = 'local-audit-fixture';
    vi.stubEnv('SUPABASE_JWT_SECRET', secret);
    for (const temporal of [{ exp: 1 }, { exp: 4102444800, nbf: 4102444700 }]) {
      const h = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
      const p = Buffer.from(
        JSON.stringify({
          sub: 'local-user',
          email: 'audit@example.test',
          tenant_id: event.tenant_id,
          agency_role: 'agency:viewer',
          ...temporal,
        }),
      ).toString('base64url');
      const s = createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url');
      expect(
        await getAuthClaims(
          new Request('http://localhost/test', {
            headers: { Authorization: `Bearer ${h}.${p}.${s}` },
          }),
        ),
      ).not.toBeNull();
    }
  });
  it('F-11: mapped loopback, link-local and unspecified pass the actual guard', () => {
    for (const url of ['http://[::ffff:127.0.0.1]', 'http://169.254.169.254', 'http://0.0.0.0'])
      expect(() => {
        checkSsrf(url);
      }).not.toThrow();
    expect(() => {
      checkSsrf('http://127.0.0.1');
    }).toThrow();
  });
  it('F-06: actual admission accepts a timestamp which aborts the entire producer before fetch', async () => {
    const invalid = { ...event, ts: 8640000000000001 };
    expect(EventSchema.safeParse(invalid).success).toBe(true);
    const transport = vi.fn();
    await expect(
      pushToClickHouse(
        [event, invalid],
        { CLICKHOUSE_URL: 'https://ch.example.test' },
        { fetchImpl: transport },
      ),
    ).rejects.toThrow('Invalid time value');
    expect(transport).not.toHaveBeenCalled();
  });
  it('F-15: schema and chunker accept a single record larger than queue transport limit', () => {
    const huge = { ...event, listing_id: 'x'.repeat(140000) };
    expect(EventSchema.safeParse(huge).success).toBe(true);
    const chunks = chunkRecordsForRetryQueue([huge], {
      tenant_id: event.tenant_id,
      batch_id: 'audit',
      first_failed_at: Date.now(),
      attempt: 0,
    });
    expect(Buffer.byteLength(JSON.stringify(chunks[0]))).toBeGreaterThan(131072);
  });
  it('F-05: behavior and quiz discard the prior stamp and exhausted dwell budget', () => {
    const marked = {
      ...applyChatIntentPrior(initIntentState(), { purchase_purpose: 'investment' }),
      chatPriorApplied: true,
      chatPriorAppliedAt: 'stamp-a',
      dwell_ticks_applied: 3,
    };
    for (const next of [
      applyBehavioralSignal(marked, 'scroll.depth', { depth_pct: 75 }),
      applyQuizLeaf(marked, 'yield_hunter'),
    ]) {
      expect(next.chatPriorAppliedAt).toBeUndefined();
      expect(next.dwell_ticks_applied).toBeUndefined();
    }
  });
  it('NEW: Redis erasure accepts HTTP errors and command-level errors as success', async () => {
    vi.stubEnv('UPSTASH_REDIS_URL', 'https://redis.example.test');
    const transport = vi
      .fn()
      .mockResolvedValueOnce(new Response('denied', { status: 403 }))
      .mockResolvedValueOnce(Response.json([{ error: 'ERR permission denied' }]));
    vi.stubGlobal('fetch', transport);
    await expect(
      deleteShadowChatIntent(event.tenant_id, event.session_id),
    ).resolves.toBeUndefined();
    await expect(
      deleteShadowChatIntent(event.tenant_id, event.session_id),
    ).resolves.toBeUndefined();
    expect(transport).toHaveBeenCalledTimes(2);
  });
});
