/**
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
import { describe, it, expect } from 'vitest';

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
  /** Why, when the answer is not the default. */
  note?: string;
}

const REGISTRY: Site[] = [
  {
    file: 'core/consent-text.ts',
    expr: 'fetch(CONSENT_TEXT_URL',
    path: '/consent-text.json',
    producer: 'next-config',
    note: 'FOLLOW-929. Wildcard is REQUIRED here, not tolerated: ADR-0021 §D3 forbids the response varying by tenant, and the request carries no credentials.',
  },
  {
    file: 'core/adapt.ts',
    expr: 'fetch(buildEndpoint(',
    path: '/api/adapt',
    producer: 'middleware',
  },
  {
    file: 'core/adapt.ts',
    expr: 'fetch(feedbackUrl',
    path: '/api/adapt/feedback',
    producer: 'middleware',
  },
  {
    file: 'core/adapt.ts',
    expr: 'fetch(completionUrl',
    path: '/api/quiz/completion',
    producer: 'middleware',
    note: 'FOLLOW-936 — the second instance. Reflected allow-list, not wildcard: HMAC-signed, writes tenant-scoped rows.',
  },
  {
    file: 'core/adapt-description.ts',
    expr: 'fetch(url',
    path: '/api/adapt/description',
    producer: 'middleware',
  },
  {
    file: 'core/intent-weights.ts',
    expr: 'fetch(url',
    path: '/api/intent/config',
    producer: 'inline',
    routeFile: 'apps/control-plane/src/app/api/intent/config/route.ts',
  },
  {
    file: 'core/quiz-config.ts',
    expr: 'fetch(url',
    path: '/api/quiz/public-config',
    producer: 'inline',
    routeFile: 'apps/control-plane/src/app/api/quiz/public-config/route.ts',
  },
  {
    file: 'core/events.ts',
    expr: 'fetch(config.ingestUrl',
    path: '(ingest Worker origin)',
    producer: 'not-control-plane',
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

  it('the registry has no stale entries pointing at deleted call sites', () => {
    const actual = new Set(actualFetchSites().map(key));
    const stale = REGISTRY.map(key).filter((k) => !actual.has(k));
    expect(stale, 'REGISTRY names a fetch() site that no longer exists — delete it').toEqual([]);
  });
});
