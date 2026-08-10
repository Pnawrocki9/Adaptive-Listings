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
   */
  actualResponse: 'reflects' | 'platform-only' | 'n/a';
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
    note: "FOLLOW-942 — the one honest exclusion. This route has a THIRD auth path that is browser-reachable and NOT origin-gated: a valid demo JWT short-circuits before `resolveApiKey` runs, so a non-permitted origin can genuinely get a 2xx here and reflecting would hand any page a readable adapt response. Becomes 'reflects' when FOLLOW-943 gates that path.",
  },
  {
    file: 'core/adapt.ts',
    expr: 'fetch(feedbackUrl',
    path: '/api/adapt/feedback',
    producer: 'middleware',
    enforcedIn: 'apps/control-plane/src/lib/api-key-auth.ts',
    actualResponse: 'reflects',
  },
  {
    file: 'core/adapt.ts',
    expr: 'fetch(completionUrl',
    path: '/api/quiz/completion',
    producer: 'middleware',
    // This route authenticates inline, so its gate lives in the route, not the shared helper.
    enforcedIn: 'apps/control-plane/src/app/api/quiz/completion/route.ts',
    actualResponse: 'reflects',
    note: 'FOLLOW-936 — the second instance. Reflected allow-list, not wildcard: HMAC-signed, writes tenant-scoped rows.',
  },
  {
    file: 'core/adapt-description.ts',
    expr: 'fetch(url',
    path: '/api/adapt/description',
    producer: 'middleware',
    enforcedIn: 'apps/control-plane/src/lib/api-key-auth.ts',
    actualResponse: 'reflects',
  },
  {
    file: 'core/intent-weights.ts',
    expr: 'fetch(url',
    path: '/api/intent/config',
    producer: 'inline',
    routeFile: 'apps/control-plane/src/app/api/intent/config/route.ts',
    enforcedIn: null,
    actualResponse: 'n/a',
  },
  {
    file: 'core/quiz-config.ts',
    expr: 'fetch(url',
    path: '/api/quiz/public-config',
    producer: 'inline',
    routeFile: 'apps/control-plane/src/app/api/quiz/public-config/route.ts',
    enforcedIn: null,
    actualResponse: 'n/a',
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
    const EXTERNAL = 'https://homes.clientbrand.com';
    vi.stubEnv('NODE_ENV', 'production');

    const wrong: string[] = [];
    for (const site of REGISTRY) {
      if (site.actualResponse === 'n/a') continue;
      const res = await middleware(
        new NextRequest(`http://localhost:3000${site.path}`, {
          method: 'GET',
          headers: { Origin: EXTERNAL },
        }),
      );
      const actual = res.headers.get('Access-Control-Allow-Origin');
      const expected = site.actualResponse === 'reflects' ? EXTERNAL : null;
      if (actual !== expected) {
        wrong.push(
          `${site.path} — registry says '${site.actualResponse}', response says ${actual ?? 'no header'}`,
        );
      }
    }

    expect(
      wrong,
      'the actual response contradicts the registry: a caller the per-tenant gate ADMITS must also ' +
        'be able to read what it was given, or the refusal has merely moved one hop downstream',
    ).toEqual([]);
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
