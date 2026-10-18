// @vitest-environment node
/**
 * FOLLOW-1343 (plan instrument N2, CI half) — /admin navigation reachability.
 *
 * Builds the backoffice navigation graph FROM SOURCE at test time and asserts:
 *   (a) every `app/admin/**\/page.tsx` is reachable within MAX_HOPS clicks of `/admin`
 *       (hop 0 = `/admin` and the page its landing `redirect()` resolves to), or is listed in
 *       HIDDEN_BY_DESIGN with a one-line reason;
 *   (b) every `/admin` nav href points at a page that exists in the inventory;
 *   (c) no nav href still carries the legacy pilot tenant (`cbc51cfa…` / `PILOT_TENANT_ID`).
 *
 * Nothing here is hand-authored: the page inventory is a filesystem walk, and the edges are the
 * `href` / `redirect()` literals of the real source files. Edges:
 *   - a `layout.tsx` contributes its hrefs (the sidebar manifests TRACER_NAV_LINKS,
 *     TENANTS_NAV_LINKS, PLATFORM_NAV_LINKS) as one click from EVERY page beneath it;
 *   - a page contributes the hrefs of the non-test files in its own directory (the page and its
 *     co-located components) as one click from that page;
 *   - a `redirect()` literal is a ZERO-click edge (the landing is not a click).
 * Hrefs in components outside `app/admin` are not followed, so the graph can only under-count
 * reachability, never invent it. A page added without nav and without a HIDDEN_BY_DESIGN row fails
 * (a); a HIDDEN_BY_DESIGN row whose page becomes reachable within MAX_HOPS, or disappears, fails
 * too — the map is a ratchet, not a parking lot.
 *
 * Layout manifests are parsed, not imported: a Next layout may only export its framework names.
 *
 * @module apps/control-plane/src/app/admin/__tests__/admin-nav-reachability.test
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const ADMIN_DIR = join(__dirname, '..');
const MAX_HOPS = 2;
const MAX_HOPS_LABEL = String(MAX_HOPS);

/** Pages deliberately more than MAX_HOPS clicks from /admin today, each with its reason. */
const HIDDEN_BY_DESIGN: Readonly<Record<string, string>> = {};

const LEGACY_PILOT = /cbc51cfa|PILOT_TENANT_ID/;

/** `href="/admin…"`, `href={`/admin…`}`, `href: '/admin…'` — the quoted literal is group 2. */
const HREF_RE = /href\s*[:=]\s*\{?\s*(['"`])(\/admin[^'"`]*)\1/g;
/** `redirect('/admin…')` / `permanentRedirect(`/admin…`)`. */
const REDIRECT_RE = /\b(?:permanentRedirect|redirect)\(\s*(['"`])(\/admin[^'"`]*)\1/g;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

/** Directory (relative to app/admin) → `/admin/...` route, dynamic segments as `[id]`. */
function dirToRoute(dir: string): string {
  const rel = relative(ADMIN_DIR, dir).split(sep).filter(Boolean);
  const segs = rel
    .filter((s) => !/^\(.*\)$/.test(s)) // route groups do not appear in the URL
    .map((s) => (/^\[.+\]$/.test(s) ? '[id]' : s));
  return ['/admin', ...segs].join('/');
}

/** Raw literal → route: `${…}` path segments become `[id]`, query string dropped. */
function normaliseHref(raw: string): string {
  const path = raw.split('?')[0] ?? raw;
  return path.replace(/\$\{[^}]*\}/g, '[id]').replace(/\/+$/, '') || '/admin';
}

function extract(re: RegExp, src: string): string[] {
  return [...src.matchAll(re)].map((m) => m[2] ?? '');
}

const isTestFile = (f: string) => /\.test\.tsx?$/.test(f) || f.split(sep).includes('__tests__');
const sourceFiles = walk(ADMIN_DIR).filter((f) => /\.tsx?$/.test(f) && !isTestFile(f));
const pageFiles = sourceFiles.filter((f) => f.endsWith(`${sep}page.tsx`));
const layoutFiles = sourceFiles.filter((f) => f.endsWith(`${sep}layout.tsx`));
const read = (f: string) => readFileSync(f, 'utf8');

const inventory = new Set(pageFiles.map((f) => dirToRoute(dirname(f))));

/** Raw href literals per source file (for the legacy-tenant check). */
const rawHrefsByFile = new Map(
  sourceFiles.map((f) => [f, [...extract(HREF_RE, read(f)), ...extract(REDIRECT_RE, read(f))]]),
);

/** Layout dir → its hrefs; applied to every page at or beneath that dir. */
const layoutEdges = layoutFiles.map((f) => ({
  dir: dirname(f),
  hrefs: extract(HREF_RE, read(f)).map(normaliseHref),
}));

/** Route → { clicks, redirects } built from the files in the page's own directory. */
const pageEdges = new Map<string, { clicks: string[]; redirects: string[] }>();
for (const page of pageFiles) {
  const dir = dirname(page);
  const own = sourceFiles.filter((f) => dirname(f) === dir && !f.endsWith(`${sep}layout.tsx`));
  const clicks = own.flatMap((f) => extract(HREF_RE, read(f))).map(normaliseHref);
  const redirects = extract(REDIRECT_RE, read(page)).map(normaliseHref);
  const inherited = layoutEdges
    .filter((l) => dir === l.dir || dir.startsWith(l.dir + sep))
    .flatMap((l) => l.hrefs);
  pageEdges.set(dirToRoute(dir), { clicks: [...clicks, ...inherited], redirects });
}

/** 0-1 BFS from /admin: redirect edges cost 0, href edges cost 1. */
function computeHops(): Map<string, { hops: number; via: string }> {
  const best = new Map<string, { hops: number; via: string }>([
    ['/admin', { hops: 0, via: 'start' }],
  ]);
  const deque: string[] = ['/admin'];
  while (deque.length > 0) {
    const node = deque.shift()!;
    const { hops } = best.get(node) as { hops: number };
    const edges = pageEdges.get(node);
    if (!edges) continue;
    const relax = (to: string, cost: 0 | 1) => {
      const cur = best.get(to);
      if (cur === undefined || hops + cost < cur.hops) {
        best.set(to, { hops: hops + cost, via: node });
        if (cost === 0) deque.unshift(to);
        else deque.push(to);
      }
    };
    for (const to of edges.redirects) relax(to, 0);
    for (const to of edges.clicks) relax(to, 1);
  }
  return best;
}

const hops = computeHops();

describe('FOLLOW-1343 N2 — /admin navigation reachability (built from source)', () => {
  it('parser sanity: the sidebar manifests and the landing redirect are found', () => {
    const root = layoutEdges.find((l) => l.dir === ADMIN_DIR);
    // layout.tsx: 3 tracer + 1 tenants + 1 platform (Registrations removed by FOLLOW-1325,
    // Demo Sessions by FOLLOW-1326, Cross-Brand Analytics by FOLLOW-1330). A parser that silently
    // finds nothing would make every assertion below vacuous.
    expect(root?.hrefs).toHaveLength(5);
    expect(pageEdges.get('/admin')?.redirects).toEqual(['/admin/tenants/[id]/tracer']);
    expect(hops.get('/admin/tenants/[id]/tracer')?.hops).toBe(0);
    // Floor lowered 20 → 15 on 2026-10-18: Phase 2 removals (FOLLOW-1325/1326/1329/1330) shrank the
    // admin inventory to 18 by design; the floor only has to catch a parser that finds nothing.
    expect(inventory.size).toBeGreaterThanOrEqual(15);
  });

  it(`(a) every admin page is within ${MAX_HOPS_LABEL} clicks of /admin or HIDDEN_BY_DESIGN`, () => {
    const offenders = [...inventory]
      .filter((route) => !(route in HIDDEN_BY_DESIGN))
      .filter((route) => (hops.get(route)?.hops ?? Infinity) > MAX_HOPS)
      .map((route) => `${route} (hops: ${String(hops.get(route)?.hops ?? 'unreachable')})`);
    expect(offenders).toEqual([]);
  });

  it('(a) HIDDEN_BY_DESIGN is a ratchet: every row exists and is still beyond the limit', () => {
    for (const [route, reason] of Object.entries(HIDDEN_BY_DESIGN)) {
      expect(inventory.has(route), `${route}: stale row, page no longer exists`).toBe(true);
      expect(
        hops.get(route)?.hops ?? Infinity,
        `${route}: now within ${MAX_HOPS_LABEL} clicks — delete its HIDDEN_BY_DESIGN row`,
      ).toBeGreaterThan(MAX_HOPS);
      expect(reason.trim().length).toBeGreaterThan(0);
    }
  });

  it('(b) every /admin nav href and redirect points at an existing page', () => {
    const dangling = [...pageEdges.entries()].flatMap(([from, e]) =>
      [...e.clicks, ...e.redirects]
        .filter((to) => !inventory.has(to))
        .map((to) => `${from} -> ${to}`),
    );
    expect(dangling).toEqual([]);
  });

  it('(c) no nav href or redirect carries the legacy pilot tenant id', () => {
    const legacy = [...rawHrefsByFile.entries()].flatMap(([file, hrefs]) =>
      hrefs.filter((h) => LEGACY_PILOT.test(h)).map((h) => `${relative(ADMIN_DIR, file)}: ${h}`),
    );
    expect(legacy).toEqual([]);
    for (const f of [...layoutFiles, join(ADMIN_DIR, 'page.tsx')]) {
      expect(read(f), relative(ADMIN_DIR, f)).not.toMatch(LEGACY_PILOT);
    }
  });

  it('(c) tenant-scoped sidebar links are pinned to ESTALARA_TENANT_ID', () => {
    const raw = extract(HREF_RE, read(join(ADMIN_DIR, 'layout.tsx')));
    const scoped = raw.filter((h) => h.startsWith('/admin/tenants/$'));
    expect(scoped.length).toBeGreaterThan(0);
    for (const h of scoped) expect(h).toMatch(/^\/admin\/tenants\/\$\{ESTALARA_TENANT_ID\}(\/|$)/);
  });
});
