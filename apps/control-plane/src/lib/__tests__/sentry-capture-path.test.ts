/**
 * FOLLOW-811 — buyer-text sentinel over the REAL Sentry capture path.
 *
 * ## What this test is, and why it asserts that a sentinel SURVIVES
 *
 * FOLLOW-811 decided NOT to add a `beforeSend` redaction hook to
 * `apps/control-plane` and to record the residual risk instead
 * (`docs/compliance/dpia.md` §2.7.1). A test that asserts a scrubbed outcome
 * would therefore be asserting a control this app does not have. This test
 * asserts the opposite — the accepted state, executably:
 *
 *   1. an exception message reaches Sentry verbatim (no redaction in the
 *      transport), and
 *   2. a `console.error(...)` string reaches the SAME Sentry event as a
 *      `category: 'console'` breadcrumb.
 *
 * (2) is the finding this ticket added to the record: in `apps/control-plane`
 * the platform log sink and the Sentry sink are NOT independent.
 * `consoleIntegration()` is a DEFAULT integration of the Node SDK
 * (`@sentry/node-core@10.50.0`, `build/cjs/sdk/index.js:41`), so the ~115
 * `console.error` call sites in this app are also Sentry inputs — and ROPA
 * §"Sentry redaction" records that breadcrumbs are never modified on any path
 * in any app. Any future change that logs buyer-authored text therefore leaks
 * to two sub-processors, not one.
 *
 * If this test starts FAILING, that is not a regression to silence: it means a
 * redaction control was added, or the SDK stopped carrying console output into
 * events. Either way `docs/compliance/dpia.md` §2.7.1 is out of date and must be
 * amended in the same PR.
 *
 * Structure mirrors the half of `apps/intent-engine/src/test_observability.py`
 * `test_buyer_text_escapes_both_sinks` that RETRO-247 §5a identified as worth
 * mirroring: drive the real capture path (no hand-built event object) and
 * assert over the whole serialised structure. There is no TS analogue of
 * pytest's `capsys`, so the console leg is observed where it actually lands —
 * inside the outgoing envelope — rather than by intercepting stdout.
 *
 * ## Why session tracking is left ON (first CI red on PR #679)
 *
 * The first revision indexed `captured[0]`. The SDK's defaults also emit a
 * `type: "session"` envelope, and flush order between the two is not
 * deterministic — the CI runner produced the session first where this machine
 * produced the event first, so 3 of 4 assertions failed in CI and none failed
 * locally. The fix is to search every captured envelope for the `event` item
 * (`findEventPayload`) and to scan the whole set for the sentinel.
 *
 * The alternative fix — `autoSessionTracking: false` to make the event the only
 * envelope — was rejected: it removes one known source of extra envelopes while
 * leaving the "the envelope I want is the first one" assumption in place for
 * every other source (a transaction envelope once tracing is on, a client
 * report, a future default integration). That assumption is the defect, not the
 * session envelope, and it is the same shape as the one FOLLOW-832 exists to
 * fix. It is also a deviation from production defaults, and this test exists
 * precisely to observe what the SDK does with its defaults. Searching the set
 * is order-independent by construction and needs no such deviation.
 *
 * @module apps/control-plane/src/lib/__tests__/sentry-capture-path
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as Sentry from '@sentry/nextjs';

/** Stand-in for buyer-authored chat text. Must be unique enough to grep for. */
const BUYER_SENTINEL = 'FOLLOW811_BUYER_SENTINEL_wanna_buy_near_szkola_dla_Zosi';

/**
 * Every envelope the transport was handed, in the order it was handed them.
 * Held as `unknown` and narrowed in `findEventPayload()`: `@sentry/nextjs` does
 * not re-export the `Envelope` type, and declaring a local alias for it would be
 * a second, drift-prone copy of a vendor type. The assertions below read the
 * serialised structure, not the type.
 *
 * NOTE (fixed after the first CI red on PR #679): this is a LIST for a reason
 * and nothing here may index it positionally. A `Sentry.init()` with default
 * integrations also emits a `type: "session"` envelope, and which of the two is
 * flushed first is not deterministic — the CI runner produced the session first
 * where this machine produced the event first. Any assertion keyed on
 * `captured[0]` is a property of incidental ordering, not of the thing under
 * test: exactly the defect class FOLLOW-832 is open against. Search the set.
 */
const captured: unknown[] = [];

/** Minimal breadcrumb shape this test reads out of the serialised event. */
interface CapturedBreadcrumb {
  category?: string;
  message?: string;
}

/** Minimal event shape this test reads out of the envelope. */
interface CapturedEvent {
  exception?: { values?: { value?: string }[] };
  breadcrumbs?: CapturedBreadcrumb[];
}

/**
 * Search ALL captured envelopes for the first item whose header is
 * `type: 'event'` and return its payload. Order-independent by construction —
 * see the note on `captured`.
 */
function findEventPayload(): CapturedEvent | undefined {
  for (const envelope of captured) {
    const [, items] = envelope as [unknown, [{ type?: string }, unknown][]];
    const eventItem = items.find((item) => item[0].type === 'event');
    if (eventItem) return eventItem[1] as CapturedEvent;
  }
  return undefined;
}

/** Envelope item types actually captured, for a failure message worth reading. */
function describeCaptured(): string {
  const kinds = captured.map((envelope) => {
    const [, items] = envelope as [unknown, [{ type?: string }, unknown][]];
    return items.map((item) => item[0].type ?? '<no type>').join('+');
  });
  return `captured ${String(captured.length)} envelope(s): [${kinds.join(', ')}]`;
}

/** `findEventPayload()` with the "it must exist at all" assertion attached. */
function eventPayload(): CapturedEvent {
  const event = findEventPayload();
  expect(event, `no envelope carried a type:'event' item — ${describeCaptured()}`).toBeDefined();
  return event!;
}

beforeAll(async () => {
  Sentry.init({
    // Structurally valid but unroutable — the transport below never dials out.
    dsn: 'https://publickey@o0.ingest.sentry.io/0',
    environment: 'test',
    // Deliberately NOT passing `integrations` — the point of this test is what
    // the SDK does with its DEFAULTS, which is what production runs.
    transport: () => ({
      send: (envelope: unknown) => {
        captured.push(envelope);
        return Promise.resolve({});
      },
      flush: () => Promise.resolve(true),
    }),
  });

  // Sink 1 — a diagnostic log line, the shape used ~115 times in this app.
  console.error(`[some-route] upstream failed: ${BUYER_SENTINEL}`);
  // Sink 2 — an explicit capture, the shape used ~105 times in this app.
  Sentry.captureException(new Error(`upstream rejected: ${BUYER_SENTINEL}`));

  await Sentry.flush(5000);
});

afterAll(async () => {
  await Sentry.close(2000);
});

describe('FOLLOW-811 — control-plane Sentry applies no redaction (accepted residual risk)', () => {
  it('puts the captured exception on the wire as an event envelope', () => {
    expect(
      findEventPayload(),
      `no envelope carried a type:'event' item — ${describeCaptured()}`,
    ).toBeDefined();
  });

  it('carries the exception message to the wire unmodified — no beforeSend', () => {
    const event = eventPayload();
    expect(event.exception?.values?.[0]?.value).toBe(`upstream rejected: ${BUYER_SENTINEL}`);
  });

  it('also carries the console.error line into the same event as a breadcrumb', () => {
    const event = eventPayload();
    const consoleCrumbs = (event.breadcrumbs ?? []).filter((b) => b.category === 'console');
    expect(consoleCrumbs.length).toBeGreaterThan(0);
    expect(consoleCrumbs.some((b) => (b.message ?? '').includes(BUYER_SENTINEL))).toBe(true);
  });

  it('leaves the sentinel present somewhere in the whole serialised capture set', () => {
    // Whole-structure assertion over EVERY envelope, not a chosen field and not
    // a chosen envelope: this is the claim dpia.md §2.7.1 records as accepted.
    expect(JSON.stringify(captured)).toContain(BUYER_SENTINEL);
  });
});
