/**
 * @vitest-environment node
 *
 * The `node` override is required from FOLLOW-942 on, because this file now DRIVES the middleware
 * instead of only reading it: `NextResponse.next({ request })` does `req.headers instanceof
 * Headers`, which jsdom's shim fails (Next.js E119) — the same reason `middleware.test.ts` carries
 * it.
 *
 * FOLLOW-936 AC(4) — every browser-side `fetch()` into the control plane must have a CORS producer.
 *
 * **This test exists because fixing the instance is worth less than closing the class.**
 * FOLLOW-929 fixed `consent-text.json`; its AC(5) asked for an enumeration of every OTHER
 * cross-origin fetch and that sweep was never run. RETRO-265 ran it and found a second, older
 * break — `POST /api/quiz/completion`, with no producer at all. Two instances of one shape, found
 * a round apart, is the definition of a class that needs a gate rather than another patch.
 *
 * The failure mode is what makes a gate necessary: a missing CORS producer is **invisible from the
 * server side**. The browser refuses the request before it is sent, so there is no 4xx, no log
 * line, and no Sentry event — only a `console.warn` in someone else's browser.
 *
 * HOW IT WORKS. The consumer list is DERIVED from the SDK source on every run, never hand-listed:
 * every `fetch(` in `packages/sdk/src` must appear in `REGISTRY` below, and every `REGISTRY` entry
 * must name a producer that still exists. Adding a ninth fetch site therefore fails this test until
 * its CORS answer is stated — which is the property FOLLOW-929's skipped AC would have needed.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import { describe, it, expect, vi, afterEach } from 'vitest';

import { middleware } from './middleware.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

const REPO_ROOT = join(__dirname, '../../..');
const SDK_SRC = join(REPO_ROOT, 'packages/sdk/src');
const MIDDLEWARE = join(REPO_ROOT, 'apps/control-plane/src/middleware.ts');
const NEXT_CONFIG = join(REPO_ROOT, 'apps/control-plane/next.config.mjs');

/**
 * How a path's CORS headers are produced. The estate deliberately has three answers, and which
 * one is correct turns on ONE axis: whether the response is tenant-identified.
 *
 *  - `middleware`   the listed-origin answer via `SDK_CORS_PREFIXES` — for tenant-identified routes.
 *  - `inline`       the route handler sets `Access-Control-Allow-Origin` itself.
 *  - `next-config`  a static `public/` asset, headers from `next.config.mjs`.
 *  - `not-control-plane`  a different origin entirely, with its own gate; out of scope here, but
 *    registered so the enumeration stays complete.
 */
type Producer = 'middleware' | 'inline' | 'next-config' | 'not-control-plane';

interface Site {
  /** Path relative to `packages/sdk/src`. */
  file: string;
  /** Verbatim start of the call — stable across line drift, unique per file. */
  expr: string;
  /** The control-plane path the call resolves to. */
  path: string;
  producer: Producer;
  /** For `inline`: the route file that must set the header. */
  routeFile?: string;
  /**
   * Where the origin decision (`resolveOriginDecision`) is enforced with a 403, relative to the
   * repo root. [FOLLOW-941; one constant list since FOLLOW-1333] The test below verifies the
   * claim against source.
   *
   * `null` = admits every origin by construction (a wildcard producer), so no origin enforcement
   * applies or could.
   */
  enforcedIn: string | null;
  /**
   * What the ACTUAL (non-preflight) response answers in `Access-Control-Allow-Origin`.
   * [FOLLOW-942, re-cut by FOLLOW-1333]
   *
   *  - `listed`        the middleware echoes the caller's origin ONLY when it is on the constant
   *                    list (`lib/origin-policy.ts`); any other origin gets no header. Until
   *                    FOLLOW-1333 this axis distinguished `reflects` (any origin echoed, on the
   *                    fully origin-gated routes) from `platform-only`; one constant list for one
   *                    tenant (ESC-085) collapsed both into this value.
   *  - `n/a`           the middleware layer does not produce this route's headers.
   *  - `wildcard-gated` the ROUTE answers `Access-Control-Allow-Origin: *` inline on a
   *                    TENANT-IDENTIFIED body, which is safe ONLY while its own origin gate
   *                    runs. [FOLLOW-950 AC(3)] Distinct from `n/a`, which means "no
   *                    enforcement applies or could" — the opposite claim.
   */
  actualResponse: 'listed' | 'wildcard-gated' | 'n/a';
  /**
   * HTTP methods this route exposes, for the rows the middleware produces. [FOLLOW-950 AC(1)]
   *
   * Reflection is granted per `(path, method)`, not per path: auth shape varies by method, and a
   * path-only allow-list cannot express "the POST is gated, the GET is not". The response
   * assertion drives each row with ITS OWN method — driving everything with `GET` (as it did
   * before) tests a request some of these routes do not even serve.
   */
  methods?: readonly string[];
  /** Why, when the answer is not the default. */
  note?: string;
}

const REGISTRY: Site[] = [
  {
    file: 'core/consent-text.ts',
    expr: 'fetch(CONSENT_TEXT_URL',
    path: '/consent-text.json',
    producer: 'next-config',
    enforcedIn: null,
    actualResponse: 'n/a',
    note: 'FOLLOW-929. Wildcard is REQUIRED here, not tolerated: ADR-0021 §D3 forbids the response varying by tenant, and the request carries no credentials.',
  },
  {
    file: 'core/adapt.ts',
    expr: 'fetch(buildEndpoint(',
    path: '/api/adapt',
    producer: 'middleware',
    enforcedIn: 'apps/control-plane/src/lib/api-key-auth.ts',
    actualResponse: 'listed',
    methods: ['POST'],
    note: 'POST /api/adapt has a THIRD auth path that is browser-reachable and NOT origin-gated: a valid demo JWT short-circuits before `resolveApiKey` runs (FOLLOW-943, documented in `lib/demo/adapt-demo-context.ts` with its falsification condition). That is why it was the one `platform-only` row before FOLLOW-1333; since FOLLOW-1333 every SDK route answers the same constant list, so it no longer differs from its neighbours. GET /api/adapt has no row: it has no SDK fetch site, and FOLLOW-1287 retired the handler (Next.js answers 405).',
  },
  // FOLLOW-1286 (D3): the SDK's `fetch(feedbackUrl` site (POST /api/adapt/feedback) was removed
  // with the bandit freeze; the route still exists behind BANDIT_ENABLED but has no SDK caller.
  {
    file: 'core/adapt.ts',
    expr: 'fetch(completionUrl',
    path: '/api/quiz/completion',
    producer: 'middleware',
    // This route authenticates inline, so its gate lives in the route, not the shared helper.
    enforcedIn: 'apps/control-plane/src/app/api/quiz/completion/route.ts',
    actualResponse: 'listed',
    methods: ['POST'],
    note: 'FOLLOW-936 — the second instance. Listed origins, not wildcard: HMAC-signed, writes tenant-scoped rows.',
  },
  {
    file: 'core/adapt.ts',
    expr: 'fetch(runUrl',
    path: '/api/quiz/run',
    producer: 'middleware',
    // Authenticates inline like quiz/completion, so its origin gate lives in the route.
    enforcedIn: 'apps/control-plane/src/app/api/quiz/run/route.ts',
    actualResponse: 'listed',
    methods: ['POST'],
    note: 'FOLLOW-1357 (sender) / FOLLOW-1358 (route + middleware prefix). Listed origins, not wildcard: HMAC-signed, writes tenant-scoped quiz_runs rows.',
  },
  {
    file: 'core/adapt-description.ts',
    expr: 'fetch(url',
    path: '/api/adapt/description',
    producer: 'middleware',
    enforcedIn: 'apps/control-plane/src/lib/api-key-auth.ts',
    actualResponse: 'listed',
    methods: ['GET'],
  },
  {
    file: 'core/intent-weights.ts',
    expr: 'fetch(url',
    path: '/api/intent/config',
    producer: 'inline',
    routeFile: 'apps/control-plane/src/app/api/intent/config/route.ts',
    // CORRECTED 2026-08-13 (FOLLOW-950 AC(3)). Was `enforcedIn: null, actualResponse: 'n/a'`,
    // whose docblock means "no per-tenant enforcement applies or could". Both halves were wrong:
    // this route calls `resolveApiKey` (`route.ts:100`) and answers `'*'` (`route.ts:55`) on a
    // TENANT-IDENTIFIED body. The wildcard is safe only BECAUSE that gate runs — a dependency
    // nothing recorded.
    // Enforcement lives in the shared helper this route calls, exactly as the `listed`
    // rows above express it; `routeFile` already names where the wildcard is set.
    enforcedIn: 'apps/control-plane/src/lib/api-key-auth.ts',
    actualResponse: 'wildcard-gated',
    note: 'FOLLOW-950 — `*` on a tenant-identified body, safe only while `resolveApiKey` gates it. Since #714 this is one of only TWO routes where the 403 `forbidden_origin` is observable at all.',
  },
  {
    file: 'core/quiz-config.ts',
    expr: 'fetch(url',
    path: '/api/quiz/public-config',
    producer: 'inline',
    routeFile: 'apps/control-plane/src/app/api/quiz/public-config/route.ts',
    // CORRECTED 2026-08-13 (FOLLOW-950 AC(3)) — same defect as `/api/intent/config` above:
    // `resolveApiKey` at `route.ts:215`, `'*'` at `route.ts:97`.
    // Enforcement lives in the shared helper this route calls, exactly as the `listed`
    // rows above express it; `routeFile` already names where the wildcard is set.
    enforcedIn: 'apps/control-plane/src/lib/api-key-auth.ts',
    actualResponse: 'wildcard-gated',
    note: 'FOLLOW-950 — `*` on a tenant-identified body, safe only while `resolveApiKey` gates it. The second of the two routes where the 403 is observable.',
  },
  {
    file: 'core/events.ts',
    expr: 'fetch(config.ingestUrl',
    path: '(ingest Worker origin)',
    producer: 'not-control-plane',
    enforcedIn: 'apps/ingest/src/handlers/events.ts',
    actualResponse: 'n/a',
    note: 'Cloudflare Worker, not Vercel. Its own origin gate answers CORS (FOLLOW-642/658).',
  },
];

/** Every `.ts` under a directory, excluding tests. */
function sourceFiles(dir: string, base = ''): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    const rel = base ? `${base}/${entry}` : entry;
    if (statSync(full).isDirectory()) {
      return entry === '__tests__' ? [] : sourceFiles(full, rel);
    }
    return entry.endsWith('.ts') && !entry.includes('.test.') ? [rel] : [];
  });
}

/** Every `fetch(<expr>` occurrence in the SDK source, as `{file, expr}`. */
function actualFetchSites(): { file: string; expr: string }[] {
  const found: { file: string; expr: string }[] = [];
  for (const rel of sourceFiles(SDK_SRC)) {
    const src = readFileSync(join(SDK_SRC, rel), 'utf8');
    for (const m of src.matchAll(/\bfetch\(\s*([A-Za-z_$][\w$.]*\(?|`)/g)) {
      const head = m[1];
      if (head === undefined) continue;
      found.push({ file: rel, expr: `fetch(${head}` });
    }
  }
  return found;
}

const key = (s: { file: string; expr: string }): string => `${s.file} :: ${s.expr}`;

describe('FOLLOW-936 AC(4) — SDK→control-plane CORS coverage', () => {
  it('every fetch() site in the SDK is registered with a CORS answer', () => {
    const registered = new Set(REGISTRY.map(key));
    const unregistered = [...new Set(actualFetchSites().map(key))].filter(
      (k) => !registered.has(k),
    );
    expect(
      unregistered,
      'A new browser-side fetch() exists with no recorded CORS producer. A missing producer is ' +
        'INVISIBLE server-side — the browser refuses the request before sending it, so there is no ' +
        '4xx and no Sentry event. Add it to REGISTRY and state its producer.',
    ).toEqual([]);
  });

  it('every registered site still resolves to a live producer', () => {
    const middlewareSrc = readFileSync(MIDDLEWARE, 'utf8');
    const prefixLiteral = /const SDK_CORS_PREFIXES = \[([^\]]*)\]/.exec(middlewareSrc)?.[1] ?? '';
    const prefixes = (prefixLiteral.match(/'([^']+)'/g) ?? []).map((q) => q.slice(1, -1));
    expect(prefixes.length, 'could not parse SDK_CORS_PREFIXES').toBeGreaterThan(0);

    const nextConfigSrc = readFileSync(NEXT_CONFIG, 'utf8');
    const broken: string[] = [];

    for (const site of REGISTRY) {
      if (site.producer === 'middleware') {
        const covered = prefixes.some((p) => site.path === p || site.path.startsWith(`${p}/`));
        if (!covered) broken.push(`${site.path} — not matched by SDK_CORS_PREFIXES`);
      } else if (site.producer === 'inline') {
        const routeFile = site.routeFile;
        if (routeFile === undefined) {
          // The registry checking itself: an `inline` entry with no route file names a producer
          // nobody can verify, which is the shape this whole test exists to reject.
          broken.push(`${site.path} — registry entry is 'inline' but names no routeFile`);
          continue;
        }
        const routeSrc = readFileSync(join(REPO_ROOT, routeFile), 'utf8');
        if (!routeSrc.includes('Access-Control-Allow-Origin')) {
          broken.push(`${site.path} — ${routeFile} sets no Access-Control-Allow-Origin`);
        }
        // A non-safelisted header or a non-simple method makes the preflight mandatory, so an
        // inline producer needs an OPTIONS handler too — the header alone is half an answer.
        if (!/export\s+(async\s+)?function\s+OPTIONS|export\s+const\s+OPTIONS/.test(routeSrc)) {
          broken.push(`${site.path} — ${routeFile} exports no OPTIONS preflight handler`);
        }
      } else if (site.producer === 'next-config') {
        if (!nextConfigSrc.includes(`source: '${site.path}'`)) {
          broken.push(`${site.path} — no headers() rule in next.config.mjs`);
        }
      }
    }

    expect(broken, 'a registered CORS producer has disappeared').toEqual([]);
  });

  it('FOLLOW-1333: the preflight answers listed origins only, on every middleware route', async () => {
    // Inverts the FOLLOW-941 assertion that stood here ("the preflight must REFLECT, because it
    // cannot know the tenant"). With one constant list there is no tenant to know, and a
    // preflight that reflects a hostile origin is a looser answer than the request will get.
    vi.stubEnv('NODE_ENV', 'production');
    const wrong: string[] = [];
    for (const site of REGISTRY.filter((r) => r.producer === 'middleware')) {
      for (const [origin, expected] of [
        ['https://homes.clientbrand.com', null],
        ['https://app.estalara.com', 'https://app.estalara.com'],
      ] as const) {
        const res = await middleware(
          new NextRequest(`http://localhost:3000${site.path}`, {
            method: 'OPTIONS',
            headers: { Origin: origin },
          }),
        );
        const actual = res.headers.get('Access-Control-Allow-Origin');
        if (actual !== expected) wrong.push(`${site.path} OPTIONS ${origin} → ${String(actual)}`);
      }
    }
    expect(wrong, 'a preflight answered an origin the constant list does not hold').toEqual([]);
  });

  it('every route that claims origin enforcement performs it in the named file', () => {
    const unenforced = REGISTRY.filter((site) => {
      if (site.enforcedIn === null) return false;
      const src = readFileSync(join(REPO_ROOT, site.enforcedIn), 'utf8');
      // The decision must actually be CALLED there, not merely imported: the control plane's
      // `resolveOriginDecision(`, or the ingest Worker's `isOriginAllowed(` (`origin-gate.ts`).
      return !/resolveOriginDecision\(|isOriginAllowed\(/.test(src);
    });

    expect(
      unenforced.map((s) => `${s.path} → ${s.enforcedIn ?? '(wildcard)'}`),
      'a route claims origin enforcement that its named file does not perform',
    ).toEqual([]);
  });

  it('FOLLOW-942: the origin decision survives to the response the browser reads', async () => {
    // AC(4). The assertion above asks whether `resolveOriginDecision(` appears in a named file.
    // That claim was TRUE for every one of these routes throughout the window in which no external
    // brand could read a single adapt response — source shape cannot falsify a response. This one
    // drives the middleware and reads the header the browser actually consults, and it is the
    // assertion that would have gone red at #714.
    //
    // Driven with each row's own method [FOLLOW-949/950]: the request the SDK actually sends.
    const EXTERNAL = 'https://homes.clientbrand.com';
    const LISTED = 'https://app.estalara.com';
    vi.stubEnv('NODE_ENV', 'production');

    const wrong: string[] = [];
    for (const site of REGISTRY) {
      // `wildcard-gated` rows are produced INLINE by the route, not by the middleware, so driving
      // the middleware says nothing about them (FOLLOW-950 AC(3)).
      if (site.actualResponse === 'n/a' || site.actualResponse === 'wildcard-gated') continue;
      for (const method of site.methods ?? ['GET']) {
        for (const [origin, expected] of [
          [EXTERNAL, null],
          [LISTED, LISTED],
        ] as const) {
          const res = await middleware(
            new NextRequest(`http://localhost:3000${site.path}`, {
              method,
              headers: { Origin: origin },
            }),
          );
          const actual = res.headers.get('Access-Control-Allow-Origin');
          if (actual !== expected) {
            wrong.push(
              `${site.path} [${method}] ${origin} — registry says '${site.actualResponse}', response says ${actual ?? 'no header'}`,
            );
          }
        }
      }
    }

    expect(
      wrong,
      'the actual response contradicts the registry: a listed origin must be able to read what it ' +
        'was given, and an unlisted one must not',
    ).toEqual([]);
  });

  // ── FOLLOW-950 — assert the GATING PROPERTY, not prose ─────────────────────────────────

  it('FOLLOW-950 AC(5): ADAPT_API_KEY is never exposed under a NEXT_PUBLIC_ name', () => {
    // The `ADAPT_API_KEY` ops bearer returns BEFORE any origin check (`quiz/completion/route.ts`
    // Step 1, `adapt-get-auth.ts` Step 1, `adapt/feedback/route.ts` Step 2). That is safe on one
    // condition: it is a server-side Doppler secret never shipped to a browser. (Until
    // FOLLOW-1333 it also decided whether origin REFLECTION was safe; nothing reflects now, but a
    // browser holding this bearer would still reach the write routes with no origin gate.)
    //
    // Today that holds by FRAMEWORK, not by prose — Next.js inlines only `NEXT_PUBLIC_*` into the
    // client bundle, and every read is server-side. But nothing would catch the single edit that
    // breaks it: a rename to `NEXT_PUBLIC_ADAPT_API_KEY`. `gitleaks-scan` (`ci.yml:307-319`) finds
    // committed SECRETS, not env-NAME changes, so it is blind to exactly this.
    //
    // AC(5) said "no work owed unless cheap". It is cheap — and a documented falsification
    // condition with no control is a producer-only alarm (Rule AJ), so it gets one.
    const SRC = join(REPO_ROOT, 'apps/control-plane/src');
    const offenders = sourceFiles(SRC).filter((rel) =>
      /NEXT_PUBLIC_[A-Z0-9_]*ADAPT_API_KEY/.test(readFileSync(join(SRC, rel), 'utf8')),
    );
    expect(
      offenders,
      'ADAPT_API_KEY appears under a NEXT_PUBLIC_ name, which Next.js inlines into the browser ' +
        'bundle. The ops bearer skips the origin gate, so any page could then write through it — ' +
        'rename the variable back.',
    ).toEqual([]);
  });

  it('FOLLOW-950: a route that DOES enforce cannot be registered as if it does not', () => {
    // The existing `unenforced` assertion checks one direction — if you CLAIM enforcement, the
    // named file must perform it. Nothing checked the inverse, which is the direction that was
    // actually wrong: `/api/intent/config` and `/api/quiz/public-config` both call `resolveApiKey`
    // and both carried `enforcedIn: null`, whose docblock means "no per-tenant enforcement applies
    // or could" — the opposite of the truth, on the only two routes where the 403 is observable.
    //
    // Registering enforcement that exists is not bookkeeping: these routes answer
    // `Access-Control-Allow-Origin: *` on a TENANT-IDENTIFIED body, which is safe ONLY while that
    // gate runs. A future edit trusting `null` would turn the wildcard into a real leak.
    const ENFORCES = /resolveApiKey\(|resolveOriginDecision\(|isOriginAllowed\(/;
    const misregistered = REGISTRY.filter((site) => {
      if (!site.routeFile || site.enforcedIn !== null) return false;
      return ENFORCES.test(readFileSync(join(REPO_ROOT, site.routeFile), 'utf8'));
    });

    expect(
      misregistered.map((s) => `${s.path} → ${s.routeFile ?? '(no routeFile)'}`),
      'this route performs an origin check but is registered `enforcedIn: null`, which ' +
        'the field docblock defines as "no origin enforcement applies or could". If it also ' +
        'answers a wildcard, that wildcard is safe only because of the gate this row denies.',
    ).toEqual([]);
  });

  it('FOLLOW-950: a route under an SDK PREFIX does not reflect an unlisted origin', async () => {
    // Before FOLLOW-950 reflection was granted by PREFIX, so this fabricated path — which no
    // registry or test mentions — would have echoed the caller's origin purely because it starts
    // with `/api/adapt/`. Since FOLLOW-1333 nothing reflects an unlisted origin at all.
    vi.stubEnv('NODE_ENV', 'production');
    const EXTERNAL = 'https://homes.clientbrand.com';
    const res = await middleware(
      new NextRequest('http://localhost:3000/api/adapt/some-future-route', {
        method: 'GET',
        headers: { Origin: EXTERNAL },
      }),
    );
    expect(
      res.headers.get('Access-Control-Allow-Origin'),
      'a route under an SDK CORS prefix reflected an origin that is not on the constant list',
    ).not.toBe(EXTERNAL);
  });

  it('the registry has no stale entries pointing at deleted call sites', () => {
    const actual = new Set(actualFetchSites().map(key));
    const stale = REGISTRY.map(key).filter((k) => !actual.has(k));
    expect(stale, 'REGISTRY names a fetch() site that no longer exists — delete it').toEqual([]);
  });
});
