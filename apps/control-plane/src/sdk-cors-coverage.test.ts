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
 *  - `middleware`   reflected allow-list via `SDK_CORS_PREFIXES` — for tenant-identified routes.
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
   * Where the PER-TENANT origin decision is enforced, relative to the repo root. [FOLLOW-941]
   *
   * A producer that exists is not the same as a producer that can admit an external brand: the
   * control plane had a working CORS producer for `/api/adapt` all along and still refused every
   * client on its own domain, because the allow-list was two hardcoded Estalara origins. This
   * field is the difference, and the test below verifies the claim against source.
   *
   * `null` = admits every origin by construction (a wildcard producer), so no per-tenant
   * enforcement applies or could.
   */
  enforcedIn: string | null;
  /**
   * What the ACTUAL (non-preflight) response answers in `Access-Control-Allow-Origin` for an origin
   * that is NOT one of the two hardcoded Estalara platform origins. [FOLLOW-942]
   *
   * `enforcedIn` says WHERE the per-tenant decision is made. This says whether that decision
   * survives to the layer the browser actually reads, and the gap between the two is the whole of
   * FOLLOW-942: #714 wired the gate and left this half on `CORS_PROD_ORIGINS`, so an external brand
   * cleared the preflight, passed the 403 gate, had its row written, and still could not read the
   * response. The `enforcedIn` assertion below stayed green the entire time the defect was live in
   * production, because it only asks whether `resolveOriginDecision(` appears in a named file
   * (Rule AU) — a claim about source shape can never falsify a claim about a response.
   *
   *  - `reflects`      the middleware echoes the caller's own origin. Only correct where EVERY
   *                    browser-reachable auth path on the route is origin-gated.
   *  - `platform-only` deliberately still restricted to `CORS_PROD_ORIGINS`; `note` must say why.
   *  - `n/a`           the middleware layer does not produce this route's headers.
   *  - `wildcard-gated` the ROUTE answers `Access-Control-Allow-Origin: *` inline on a
   *                    TENANT-IDENTIFIED body, which is safe ONLY while its own per-tenant gate
   *                    runs. [FOLLOW-950 AC(3)] Distinct from `n/a`, which means "no per-tenant
   *                    enforcement applies or could" — the opposite claim. These rows previously
   *                    carried `enforcedIn: null` + `n/a`, which read as "wildcard, nothing to
   *                    enforce" while they were in fact the only two routes where the 403
   *                    `forbidden_origin` is observable at all. A future edit trusting that would
   *                    turn a wildcard on a tenant's config into a real leak.
   */
  actualResponse: 'reflects' | 'platform-only' | 'wildcard-gated' | 'n/a';
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
    actualResponse: 'platform-only',
    methods: ['POST'],
    note: "FOLLOW-942 — the one honest exclusion, and it is POST-only [FOLLOW-949]. This registry row is driven by the SDK's actual fetch site, which is a POST (`core/adapt.ts:1191`); POST /api/adapt has a THIRD auth path that is browser-reachable and NOT origin-gated: a valid demo JWT short-circuits before `resolveApiKey` runs, so a non-permitted origin can genuinely get a 2xx here and reflecting would hand any page a readable adapt response. Becomes 'reflects' only if that branch ever becomes origin-gated. **FOLLOW-943 is CLOSED and did NOT gate it** — it discharged the question by documenting the exemption in place with a falsification condition, which is the pattern this repo asks for. Gating it today would be unsafe, not merely redundant: a demo JWT's `tenant_id` is OPTIONAL (`demo-jwt-verify.ts:22`), and an external tenant with an empty `allowed_origins` resolves to `origin_policy_unconfigured`, i.e. a DENY (`origin-policy.ts:210-216`) — so gating would either have no tenant to judge or lock demo sessions out. The trigger to revisit is the documented condition (a demo JWT issued for, or usable from, a tenant's own domain), not a ticket. GET /api/adapt is a DIFFERENT safety class (no SDK fetch site, so no row of its own here) — every browser-reachable GET auth path goes through `resolveAdaptGetAuth`, which IS origin-gated, and `isFullyOriginGated` in middleware.ts reflects it accordingly; see `middleware.test.ts` FOLLOW-949 cases.",
  },
  {
    file: 'core/adapt.ts',
    expr: 'fetch(feedbackUrl',
    path: '/api/adapt/feedback',
    producer: 'middleware',
    enforcedIn: 'apps/control-plane/src/lib/api-key-auth.ts',
    actualResponse: 'reflects',
    methods: ['POST'],
  },
  {
    file: 'core/adapt.ts',
    expr: 'fetch(completionUrl',
    path: '/api/quiz/completion',
    producer: 'middleware',
    // This route authenticates inline, so its gate lives in the route, not the shared helper.
    enforcedIn: 'apps/control-plane/src/app/api/quiz/completion/route.ts',
    actualResponse: 'reflects',
    methods: ['POST'],
    note: 'FOLLOW-936 — the second instance. Reflected allow-list, not wildcard: HMAC-signed, writes tenant-scoped rows.',
  },
  {
    file: 'core/adapt-description.ts',
    expr: 'fetch(url',
    path: '/api/adapt/description',
    producer: 'middleware',
    enforcedIn: 'apps/control-plane/src/lib/api-key-auth.ts',
    actualResponse: 'reflects',
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
    // Enforcement lives in the shared helper this route calls, exactly as the `reflects`
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
    // Enforcement lives in the shared helper this route calls, exactly as the `reflects`
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

  it('no route can admit only Estalara: every producer is external-brand capable', () => {
    // FOLLOW-941. The distinction this asserts, which FOLLOW-936 could not: `/api/adapt` HAD a
    // working CORS producer and still refused every external brand, because the allow-list was
    // two hardcoded Estalara origins. A producer that exists is not a producer that admits the
    // caller — so `enforcedIn` is verified against source rather than believed.
    const middlewareSrc = readFileSync(MIDDLEWARE, 'utf8');
    const preflight = /function sdkCorsPreflightResponse[\s\S]*?\n}/.exec(middlewareSrc)?.[0] ?? '';
    expect(preflight, 'could not locate the preflight builder').not.toBe('');

    // Domain independence: the preflight must REFLECT, because it cannot know the tenant. A
    // preflight that consults a static allow-list is the FOLLOW-941 defect by construction.
    expect(
      /Access-Control-Allow-Origin['"],\s*requestOrigin/.test(preflight),
      'the preflight does not reflect the requested origin — an external brand on its own domain ' +
        'cannot clear it, and no per-tenant decision downstream can rescue that',
    ).toBe(true);

    const unenforced = REGISTRY.filter((site) => {
      if (site.enforcedIn === null) return false;
      const src = readFileSync(join(REPO_ROOT, site.enforcedIn), 'utf8');
      // The per-tenant decision must actually be CALLED there, not merely imported.
      return !/resolveOriginDecision\(|resolveOriginPolicy\(/.test(src);
    });

    expect(
      unenforced.map((s) => `${s.path} → ${s.enforcedIn ?? '(wildcard)'}`),
      'a route claims per-tenant origin enforcement that its named file does not perform',
    ).toEqual([]);
  });

  it('FOLLOW-942: the per-tenant decision survives to the response the browser reads', async () => {
    // AC(4). The assertion above asks whether `resolveOriginDecision(` appears in a named file.
    // That claim was TRUE for every one of these routes throughout the window in which no external
    // brand could read a single adapt response — source shape cannot falsify a response. This one
    // drives the middleware and reads the header the browser actually consults, and it is the
    // assertion that would have gone red at #714.
    //
    // Driven with `site.method ?? 'GET'`, not a hardcoded `GET`. [FOLLOW-949] Before this ticket
    // the origin decision was method-blind, so hardcoding `GET` here happened to test the right
    // branch for every row even though three of five SDK call sites are POSTs. `/api/adapt` is now
    // method-sensitive (`POST` platform-only, `GET` reflects) — driving its row with the wrong
    // method would silently assert the GET branch for a registry entry that represents a POST call.
    const EXTERNAL = 'https://homes.clientbrand.com';
    vi.stubEnv('NODE_ENV', 'production');

    const wrong: string[] = [];
    for (const site of REGISTRY) {
      // `wildcard-gated` rows are produced INLINE by the route, not by the middleware, so driving
      // the middleware says nothing about them (FOLLOW-950 AC(3)).
      if (site.actualResponse === 'n/a' || site.actualResponse === 'wildcard-gated') continue;
      // FOLLOW-950 AC(1): drive each row with ITS OWN method. Reflection is granted per
      // (path, method), and this loop used to send GET to every route — including two that only
      // serve POST, so it was asserting the CORS answer for a request they do not handle.
      for (const method of site.methods ?? ['GET']) {
        const res = await middleware(
          new NextRequest(`http://localhost:3000${site.path}`, {
            method,
            headers: { Origin: EXTERNAL },
          }),
        );
        const actual = res.headers.get('Access-Control-Allow-Origin');
        const expected = site.actualResponse === 'reflects' ? EXTERNAL : null;
        if (actual !== expected) {
          wrong.push(
            `${site.path} [${method}] — registry says '${site.actualResponse}', response says ${actual ?? 'no header'}`,
          );
        }
      }
    }

    expect(
      wrong,
      'the actual response contradicts the registry: a caller the per-tenant gate ADMITS must also ' +
        'be able to read what it was given, or the refusal has merely moved one hop downstream',
    ).toEqual([]);
  });

  // ── FOLLOW-950 AC(2) — assert the GATING PROPERTY, not prose ───────────────────────────
  //
  // The `!s.note` check below survives, deliberately and per AC(2) ("keep the note check as well
  // as, never instead of"). It is kept because the thing it stands in for is NOT mechanisable
  // from source text: "every browser-reachable auth path reaches the origin gate" is a data-flow
  // property over branches, and these three routes authenticate three different ways (a shared
  // helper, an inline HMAC check, a GET-specific resolver). A regex that claimed to prove it
  // would be a stronger lie than the note.
  //
  // What IS mechanisable is the hole the note check could never see: the stub's own example of
  // `/api/adapt/foo` registered `reflects` and passing every assertion. These two close it.

  it('FOLLOW-950 AC(5): ADAPT_API_KEY is never exposed under a NEXT_PUBLIC_ name', () => {
    // The reflection decision rests on a STATED falsification condition, quoted from
    // `middleware.ts`: "ADAPT_API_KEY is a server-side Doppler secret that is never shipped to a
    // browser, so no page can present it. If that key is ever put into browser-delivered code,
    // this reflection becomes a hole and must be closed with it."
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
        'bundle. That is the exact condition middleware.ts names as making origin reflection a ' +
        'hole — close the reflection in the same change, or rename the variable back.',
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
    const ENFORCES = /resolveApiKey\(|resolveOriginDecision\(|resolveOriginPolicy\(/;
    const misregistered = REGISTRY.filter((site) => {
      if (!site.routeFile || site.enforcedIn !== null) return false;
      return ENFORCES.test(readFileSync(join(REPO_ROOT, site.routeFile), 'utf8'));
    });

    expect(
      misregistered.map((s) => `${s.path} → ${s.routeFile ?? '(no routeFile)'}`),
      'this route performs a per-tenant origin check but is registered `enforcedIn: null`, which ' +
        'the field docblock defines as "no per-tenant enforcement applies or could". If it also ' +
        'answers a wildcard, that wildcard is safe only because of the gate this row denies.',
    ).toEqual([]);
  });

  it('FOLLOW-950: the middleware allow-list and the registry agree EXACTLY on what reflects', () => {
    // The registry is derived from SDK `fetch(` sites, so a route no SDK file calls never appears
    // in it — which is precisely how a new reflecting route could be added with no entry and no
    // test. Reading the allow-list from the middleware SOURCE and requiring set equality means
    // neither side can move alone: a middleware row with no registry row fails here, and a
    // registry `reflects` row with no middleware row fails here too.
    const mw = readFileSync(join(REPO_ROOT, 'apps/control-plane/src/middleware.ts'), 'utf8');
    const block = /const ORIGIN_REFLECTING_ROUTES[^=]*=\s*new Map\(\[([\s\S]*?)\]\);/.exec(mw);
    expect(
      block,
      'ORIGIN_REFLECTING_ROUTES not found — the opt-in allow-list this gate reads is gone',
    ).not.toBeNull();

    const inMiddleware = new Set<string>();
    for (const m of block![1]!.matchAll(/\['([^']+)',\s*\[([^\]]*)\]/g)) {
      for (const meth of m[2]!.matchAll(/'([A-Z]+)'/g)) inMiddleware.add(`${m[1]!} ${meth[1]!}`);
    }

    const inRegistry = new Set<string>();
    for (const site of REGISTRY) {
      if (site.actualResponse !== 'reflects') continue;
      for (const method of site.methods ?? ['GET']) inRegistry.add(`${site.path} ${method}`);
    }

    expect(
      [...inMiddleware].sort(),
      'the middleware reflects a (path, method) the registry does not record as `reflects` — or ' +
        'the registry claims one the middleware will not grant. Reflection is a security decision; ' +
        'it must be stated in both places or in neither.',
    ).toEqual([...inRegistry].sort());
  });

  it('FOLLOW-950: a route under a reflecting PREFIX does not reflect unless it opted in', async () => {
    // The inversion, asserted behaviourally. Before FOLLOW-950 reflection was granted by PREFIX,
    // so this fabricated path — which no allow-list, registry or test mentions — would have
    // echoed the caller's origin purely because it starts with `/api/adapt/`.
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
      'a NEW route under an existing SDK CORS prefix reflected an external origin without being ' +
        'opted in. The safe setting must be the default; the dangerous one must be chosen.',
    ).not.toBe(EXTERNAL);
  });

  it('FOLLOW-942: a route held back from reflection cannot be held back silently', () => {
    const undocumented = REGISTRY.filter((s) => s.actualResponse === 'platform-only' && !s.note);
    expect(
      undocumented.map((s) => s.path),
      'a middleware route still restricted to the two Estalara origins must name in `note` the ' +
        'auth path that is not origin-gated — an unexplained exclusion is indistinguishable from ' +
        'this defect, which is how it survived review',
    ).toEqual([]);
  });

  it('the registry has no stale entries pointing at deleted call sites', () => {
    const actual = new Set(actualFetchSites().map(key));
    const stale = REGISTRY.map(key).filter((k) => !actual.has(k));
    expect(stale, 'REGISTRY names a fetch() site that no longer exists — delete it').toEqual([]);
  });
});
