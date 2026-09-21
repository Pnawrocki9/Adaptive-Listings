// @vitest-environment jsdom
/**
 * FOLLOW-1242 — a failed ingest flush must not lose the batch.
 *
 * FOLLOW-819 lost `cta.clicked` (the conversion event) because `flush()` had already
 * `splice(0)`-d the queue when `dispatchEvents()` awaited a `fetch` that failed (a CORS-less
 * edge 503, which the browser surfaces as a rejected fetch), and the failure was swallowed.
 *
 * Rule Q: drives the real `init()` body through `_initForTest()` and forces the REAL flush path
 * (`beforeunload` -> `handleSessionEnd()` -> `flush()`), inspecting the REAL `fetch` calls to the
 * ingest endpoint. A retried batch must carry the SAME `event_id`s and the SAME `Idempotency-Key`
 * header, so ingest's idempotency middleware (apps/ingest/src/middleware/idempotency.ts) replays
 * the cached 2xx instead of writing duplicate rows when the first attempt had in fact landed.
 *
 * @module packages/sdk/src/__tests__/follow-1242
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { _initForTest } from '../index.js';

const SESSION_ID = 'f'.repeat(64);
const INGEST_URL = 'https://ingest.estalara.com/v1/events';

function okJson(body: unknown): { ok: true; status: 200; json: () => Promise<unknown> } {
  return { ok: true, status: 200, json: () => Promise.resolve(body) };
}

function adaptResponse(): unknown {
  return {
    adapt_decision_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    session_id: SESSION_ID,
    archetype: 'yield_hunter',
    confidence: 0.85,
    similarity: 0.9,
    tier: 1,
    source: 'playbook',
    generated_at: '2026-09-21T00:00:00.000Z',
    directives: [],
    ttl_seconds: 300,
    variant: 'control',
  };
}

function setUpPage(): void {
  const listingEl = document.createElement('div');
  listingEl.setAttribute('data-estalara-listing', '');
  listingEl.setAttribute('data-estalara-listing-id', 'L-1242');
  document.body.appendChild(listingEl);

  sessionStorage.setItem(
    '__estalara_session__',
    JSON.stringify({ sessionId: SESSION_ID, startedAt: Date.now(), pageCount: 1 }),
  );
  localStorage.setItem('estalara_consent', 'granted');

  const script = document.createElement('script');
  script.dataset.apiKey = 'test-follow1242-key';
  script.dataset.decisionUrl = 'https://decision.estalara.com/api';
  script.dataset.tenantId = 'follow1242-tenant-id';
  document.head.appendChild(script);
}

function clearAll(): void {
  sessionStorage.clear();
  localStorage.clear();
  document.querySelectorAll('script[data-api-key]').forEach((el) => {
    el.remove();
  });
  document.querySelectorAll('[data-estalara-host], [data-estalara-listing]').forEach((el) => {
    el.remove();
  });
}

class MockIntersectionObserver {
  observe(): void {
    /* no-op */
  }
  unobserve(): void {
    /* no-op */
  }
  disconnect(): void {
    /* no-op */
  }
}

interface IngestCall {
  body: string;
  idempotencyKey: string | undefined;
  eventIds: string[];
}

/**
 * Stubs fetch: /adapt answers normally; the ingest endpoint answers with `ingestOutcomes[n]` for
 * its n-th call (a `Response`-like object, or `'reject'` for a rejected fetch), then 200.
 */
function stubFetch(ingestOutcomes: ('reject' | { ok: boolean; status: number })[]): {
  calls: IngestCall[];
} {
  const calls: IngestCall[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === INGEST_URL) {
        const body = (init?.body ?? '') as string;
        const headers = (init?.headers ?? {}) as Record<string, string>;
        calls.push({
          body,
          idempotencyKey: headers['Idempotency-Key'],
          eventIds: (JSON.parse(body) as { events: { event_id: string }[] }).events.map(
            (e) => e.event_id,
          ),
        });
        const outcome = ingestOutcomes[calls.length - 1];
        if (outcome === 'reject') {
          // What the browser reports for a CORS-less 503 / network blip.
          return Promise.reject(new TypeError('Failed to fetch'));
        }
        return Promise.resolve(outcome ?? okJson({ accepted: 1 }));
      }
      if (url.includes('/adapt') && !url.includes('/adapt/description')) {
        return Promise.resolve(okJson(adaptResponse()));
      }
      return Promise.resolve(okJson({}));
    }),
  );
  return { calls };
}

/** Fire the production session-end flush and let its fetch chain settle. */
async function sessionEndFlush(): Promise<void> {
  window.dispatchEvent(new Event('beforeunload'));
  await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  clearAll();
  vi.restoreAllMocks();
  vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
});

afterEach(() => {
  const teardown = (window as Window & { __estalaraTeardown?: () => void }).__estalaraTeardown;
  if (teardown) {
    teardown();
    delete (window as Window & { __estalaraTeardown?: () => void }).__estalaraTeardown;
  }
  clearAll();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('FOLLOW-1242 — a failed ingest flush re-queues the batch (real init path)', () => {
  it.each([
    ['the ingest fetch REJECTS (CORS-less 503 / network error)', 'reject' as const],
    ['ingest answers 503', { ok: false, status: 503 }],
    ['ingest answers 429', { ok: false, status: 429 }],
  ])(
    'when %s, the next flush re-sends the SAME batch with the same event_ids and Idempotency-Key',
    async (_label, firstOutcome) => {
      setUpPage();
      const { calls } = stubFetch([firstOutcome]);
      await _initForTest();

      await sessionEndFlush();
      expect(calls).toHaveLength(1);
      const failed = calls[0];
      const firstId = failed?.eventIds[0];
      expect(firstId).toBeDefined();

      await sessionEndFlush();
      // Before FOLLOW-1242 this is undefined: the batch was spliced off the queue and lost.
      const resent = calls.slice(1).find((c) => c.eventIds.includes(firstId ?? ''));
      expect(resent).toBeDefined();
      expect(resent?.eventIds).toEqual(failed?.eventIds);
      expect(resent?.body).toBe(failed?.body);
      // The key must satisfy ingest's 32–128 printable-ASCII rule or ingest answers 400.
      expect(failed?.idempotencyKey).toMatch(/^[\x20-\x7e]{32,128}$/);
      expect(resent?.idempotencyKey).toBe(failed?.idempotencyKey);

      // Delivered now: a third flush must not send it again.
      await sessionEndFlush();
      expect(calls.filter((c) => c.idempotencyKey === failed?.idempotencyKey)).toHaveLength(2);
    },
  );

  it('does NOT retry a batch ingest rejected with a non-retryable 4xx (400 validation)', async () => {
    setUpPage();
    const { calls } = stubFetch([{ ok: false, status: 400 }]);
    await _initForTest();

    await sessionEndFlush();
    const rejectedIds = calls[0]?.eventIds ?? [];
    expect(rejectedIds.length).toBeGreaterThan(0);

    await sessionEndFlush();
    const later = calls.slice(1).flatMap((c) => c.eventIds);
    expect(later.some((id) => rejectedIds.includes(id))).toBe(false);
  });
});
