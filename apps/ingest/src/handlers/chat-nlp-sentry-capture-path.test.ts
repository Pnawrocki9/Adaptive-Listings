/**
 * FOLLOW-838 — buyer-text sentinel over the REAL `@sentry/cloudflare` capture
 * path, driven through the REAL `dispatchChatNlp`.
 *
 * ## Why this file exists separately from `chat-nlp-dispatch.test.ts`
 *
 * That file does `vi.mock('@sentry/cloudflare')`, so it can only ever observe
 * the ARGUMENTS this module hands to `captureException`. The finding this
 * ticket fixes is not about those arguments alone: `console.error` is ALSO a
 * Sentry input, because `consoleIntegration()` is a DEFAULT integration of
 * `@sentry/cloudflare@10.50.0` (`build/cjs/sdk.js:29`, last entry of
 * `getDefaultIntegrations`) and `apps/ingest/src/observability.ts:76-81` passes
 * no `integrations` key, so the defaults apply in production. A mocked SDK
 * cannot see that second sink at all. This file builds a real
 * `CloudflareClient` with the real default integration list and a memory
 * transport, and asserts over the ENTIRE serialised envelope set.
 *
 * ## The three claims, and why each is asserted in the direction it is
 *
 *   1. **Positive control (`console.error` reaches the wire).** Asserted first
 *      and deliberately: a test whose only assertion is "the sentinel is
 *      absent" passes just as happily when the harness captures nothing at all.
 *      This block proves the harness observes BOTH sinks — an exception value
 *      and a `category: 'console'` breadcrumb — so claim 2's absence assertion
 *      is non-vacuous by construction rather than by a reviewer's faith.
 *      (FOLLOW-832: the prior Python version of this test asserted against a
 *      payload the test itself built, so it could not fail. The defence against
 *      that class is a control that FAILS if the plumbing is dead.)
 *   2. **The fix (upstream response body never reaches either sink).** Drives
 *      `dispatchChatNlp` with a stubbed non-ok `fetch` whose body is the exact
 *      shape `chat_nlp_endpoint` was observed to return on a pydantic
 *      validation failure — `detail[].input` echoing the parsed request body,
 *      whose `message.content` is what the buyer typed (driven against
 *      `apps/intent-engine/src/local_dev.py`; transcript in the FOLLOW-838 PR
 *      body). Asserts the sentinel is in NONE of the envelopes, and — in the
 *      other direction, so the fix cannot degrade into "log nothing" — that the
 *      event still carries the status and the classified kind an operator acts
 *      on.
 *   3. **The accepted boundary (`.catch()` arm still carries `err.message`).**
 *      Asserted as SURVIVING, the same way
 *      `apps/control-plane/src/lib/__tests__/sentry-capture-path.test.ts`
 *      records FOLLOW-811's accepted residual risk executably. That arm fires
 *      on a transport-layer rejection whose message the Workers runtime
 *      generates and no leg of which is derived from the request body, so it
 *      was assessed and left intact rather than redacted by reflex. If that
 *      assessment is ever revisited, this test is where the change surfaces —
 *      and `docs/compliance/dpia.md` §2.7.2 must be amended in the same PR.
 *
 * @module apps/ingest/src/handlers/chat-nlp-sentry-capture-path
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as Sentry from '@sentry/cloudflare';

import { dispatchChatNlp } from './chat-nlp-dispatch.js';

/**
 * The three sentinels below deliberately contain SPACES and stay short.
 * `gitleaks`' default `cloudflare-api-token` rule matches any 40-character run
 * of `[A-Za-z0-9_-]` above a Shannon-entropy floor, and the first cut of this
 * file used long underscore-joined names (a `FOLLOW838_`-prefixed screaming-
 * snake-case phrase, and two siblings of the same build) which tripped it three
 * times on PR #681 at entropy 4.44 / 4.19 / 4.23. The offending names are NOT
 * quoted here — doing so re-triggers the same rule on the very comment that
 * explains it, which is how the second CI red happened.
 * Same trap FOLLOW-832 hit; same resolution (rename, not a `.gitleaksignore`
 * fingerprint, so the scanner keeps full strength). A space is outside that
 * character class, so it breaks the run regardless of length — and a sentinel
 * with spaces in it is a better stand-in for typed chat anyway.
 */

/** Stands in for buyer-authored chat text echoed back by the upstream body. */
const BUYER_SENTINEL = 'F838 buyer szukam domu dla Zosi';
/** Stands in for any string written to `console.error` (positive control). */
const CONTROL_SENTINEL = 'F838 control harness is live';
/** Stands in for a runtime-generated transport rejection message. */
const TRANSPORT_SENTINEL = 'F838 transport connection lost';

/**
 * The exact response shape observed from `chat_nlp_endpoint` on a pydantic
 * body-validation failure: `detail[].input` carries the parsed request body,
 * including `message.content`. Written out in full rather than abbreviated,
 * because the point of the assertion is that this WHOLE thing is never read.
 */
const ECHOING_422_BODY = JSON.stringify({
  detail: [
    {
      type: 'missing',
      loc: ['body', 'session_id'],
      msg: 'Field required',
      input: {
        tenant_id: 'tenant-abc',
        message: { role: 'user', content: BUYER_SENTINEL },
      },
    },
  ],
});

const ARGS = {
  tenant_id: 'tenant-abc',
  session_id: 's'.repeat(32),
  message_text: BUYER_SENTINEL,
  profiling_opt_out: false,
};

const ENV = {
  MODAL_CHAT_NLP_URL: 'https://modal.example/chat_nlp_endpoint',
  INTERNAL_API_SECRET: 'secret',
};

/**
 * Every envelope the transport was handed. Never indexed positionally — the SDK
 * emits envelopes this test did not ask for (sessions, client reports), and
 * which arrives first is not deterministic across machines (the defect that
 * turned PR #679's first revision red in CI only). Search the set.
 */
const captured: unknown[] = [];

/** Minimal breadcrumb shape read out of the serialised event. */
interface CapturedBreadcrumb {
  category?: string;
  message?: string;
}

/** Minimal event shape read out of the envelope. */
interface CapturedEvent {
  exception?: { values?: { value?: string }[] };
  breadcrumbs?: CapturedBreadcrumb[];
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
}

/** Search ALL envelopes for the first `type: 'event'` item. Order-independent. */
function findEventPayload(envelopes: readonly unknown[]): CapturedEvent | undefined {
  for (const envelope of envelopes) {
    const [, items] = envelope as [unknown, [{ type?: string }, unknown][]];
    const eventItem = items.find((item) => item[0].type === 'event');
    if (eventItem) return eventItem[1] as CapturedEvent;
  }
  return undefined;
}

/** Envelope item types actually captured, for a failure message worth reading. */
function describeCaptured(envelopes: readonly unknown[]): string {
  const kinds = envelopes.map((envelope) => {
    const [, items] = envelope as [unknown, [{ type?: string }, unknown][]];
    return items.map((item) => item[0].type ?? '<no type>').join('+');
  });
  return `captured ${String(envelopes.length)} envelope(s): [${kinds.join(', ')}]`;
}

/**
 * Run `act` with an empty breadcrumb buffer and return every envelope it
 * produced.
 *
 * The explicit `clearBreadcrumbs()` is load-bearing. Without it, each
 * scenario's console lines pile onto the NEXT scenario's event — observed while
 * writing this file. That does not make a green run wrong (the sentinels
 * differ), but it makes a red run's failure message point at another block's
 * output, which is exactly the kind of misdirection that gets a real regression
 * misread. `withIsolationScope` alone does not fix it here: the Workers runtime
 * installs an AsyncLocalStorage context strategy per request and vitest/node
 * does not, so the forked scope is not the one holding the breadcrumbs.
 */
async function captureDuring(act: () => Promise<void>): Promise<unknown[]> {
  captured.length = 0;
  Sentry.getIsolationScope().clearBreadcrumbs();
  await Sentry.withIsolationScope(async () => {
    await act();
  });
  await Sentry.flush(2000);
  return [...captured];
}

beforeAll(() => {
  // `@sentry/cloudflare` does not export `init` (only `withSentry`, which needs
  // a Workers `ExportedHandler` + `env`), so the client is built directly from
  // the SAME `getDefaultIntegrations` list `init` would use. Deliberately NOT
  // hand-picking integrations: the claim under test is what the DEFAULTS do,
  // which is what `observability.ts` runs in production.
  const base = {
    dsn: 'https://publickey@o0.ingest.sentry.io/0',
    environment: 'test',
    // The stack parser is irrelevant here (no frames are asserted) and the real
    // one is not exported; an empty parser keeps the client constructible.
    stackParser: () => [],
    transport: () => ({
      send: (envelope: unknown) => {
        captured.push(envelope);
        return Promise.resolve({});
      },
      flush: () => Promise.resolve(true),
    }),
  };
  const client = new Sentry.CloudflareClient({
    ...base,
    integrations: Sentry.getDefaultIntegrations(base),
  });
  Sentry.setCurrentClient(client);
  client.init();
});

afterAll(async () => {
  await Sentry.close(2000);
});

describe('FOLLOW-838 — chat-NLP dispatch keeps buyer text out of every Sentry sink', () => {
  it('control: console.error AND captureException both reach the wire (harness is live)', async () => {
    const envelopes = await captureDuring(() => {
      console.error(`[control] ${CONTROL_SENTINEL}`);
      Sentry.captureException(new Error(`[control] ${CONTROL_SENTINEL}`));
      return Promise.resolve();
    });

    const event = findEventPayload(envelopes);
    expect(event, `no type:'event' item — ${describeCaptured(envelopes)}`).toBeDefined();
    // Sink A — the exception value.
    expect(event?.exception?.values?.[0]?.value).toContain(CONTROL_SENTINEL);
    // Sink B — the console line, carried by the DEFAULT `consoleIntegration()`.
    // This is the coupling FOLLOW-811 established for `@sentry/node-core` and
    // this ticket establishes for `@sentry/cloudflare`, proven rather than read
    // off the vendor's integration list.
    const consoleCrumbs = (event?.breadcrumbs ?? []).filter((b) => b.category === 'console');
    expect(consoleCrumbs.length).toBeGreaterThan(0);
    expect(consoleCrumbs.some((b) => (b.message ?? '').includes(CONTROL_SENTINEL))).toBe(true);
  });

  it('drops the upstream 422 body from every sink while keeping status + kind', async () => {
    // ONE drive, both directions asserted on the same captured set. Splitting
    // this in two was tried and is wrong: `dedupeIntegration()` is also a
    // default (`build/cjs/sdk.js:18`), so a second identical exception is
    // dropped by the client and the second test observed zero envelopes.
    const envelopes = await captureDuring(async () => {
      const fetchMock = () =>
        Promise.resolve(
          new Response(ECHOING_422_BODY, {
            status: 422,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      await dispatchChatNlp(ARGS, ENV, fetchMock);
    });

    // Whole-structure assertion over EVERY envelope: exception value, message,
    // breadcrumbs, `extra`, `tags` — anywhere a future edit could route it.
    expect(JSON.stringify(envelopes)).not.toContain(BUYER_SENTINEL);

    // Non-vacuous in the other direction: the fix must not degrade into
    // "capture nothing". Both sinks still carry what an operator triages on.
    const event = findEventPayload(envelopes);
    expect(event, `no type:'event' item — ${describeCaptured(envelopes)}`).toBeDefined();
    expect(event?.exception?.values?.[0]?.value).toBe(
      '[chat-nlp] Modal dispatch rejected: HTTP 422 (contract)',
    );
    expect(event?.tags?.kind).toBe('dispatch_failed');
    expect(event?.tags?.status_kind).toBe('contract');
    expect(event?.extra?.status).toBe(422);
    const consoleCrumbs = (event?.breadcrumbs ?? []).filter((b) => b.category === 'console');
    expect(consoleCrumbs.some((b) => (b.message ?? '').includes('HTTP 422 (contract)'))).toBe(true);
  });

  it('ACCEPTED BOUNDARY: the .catch() arm still carries the transport error message', async () => {
    // Asserted as SURVIVING on purpose — see claim 3 in the module docstring.
    // A transport rejection message is generated by the Workers runtime and is
    // not derived from the request body, so it was assessed and kept for
    // triage. If a future change redacts it, this test goes red and
    // `docs/compliance/dpia.md` §2.7.2 must be amended in the same PR.
    const envelopes = await captureDuring(async () => {
      const fetchMock = () => Promise.reject(new Error(TRANSPORT_SENTINEL));
      await dispatchChatNlp(ARGS, ENV, fetchMock);
    });

    const event = findEventPayload(envelopes);
    expect(event, `no type:'event' item — ${describeCaptured(envelopes)}`).toBeDefined();
    expect(event?.tags?.kind).toBe('network');
    expect(JSON.stringify(envelopes)).toContain(TRANSPORT_SENTINEL);
    // But the buyer's message text is NOT in this arm either: nothing on this
    // path interpolates the request body.
    expect(JSON.stringify(envelopes)).not.toContain(BUYER_SENTINEL);
  });
});
