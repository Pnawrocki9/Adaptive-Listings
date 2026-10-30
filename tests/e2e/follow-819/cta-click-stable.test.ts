// @vitest-environment node
/**
 * FOLLOW-1398 — AC(5)'s CTA click re-resolves the CTA and retries (bounded) when the SDK re-renders
 * it after adaptation ("element is not stable", README §5.39 run 33; "waiting for element to be
 * visible", §5.43 run 123). The fake page below stands in for Playwright only; the code under test
 * is the harness's real `clickCtaWhenReady()`. Time is virtual.
 */
import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';

interface Result {
  clicked: boolean;
  attempts: number;
  error: string | null;
  errors: string[];
}
let clickCtaWhenReady: (page: unknown, opts?: Record<string, unknown>) => Promise<Result>;
let harnessSrc = '';

beforeAll(async () => {
  (globalThis as Record<string, unknown>).FOLLOW1186_IMPORT_ONLY = true;
  const mod = (await import('./differentiator-e2e.mjs')) as Record<string, unknown>;
  clickCtaWhenReady = mod.clickCtaWhenReady as typeof clickCtaWhenReady;
  harnessSrc = await readFile(new URL('./differentiator-e2e.mjs', import.meta.url), 'utf8');
});

/** A page whose Nth locator resolution fails with the given errors, then succeeds. */
function fakePage(failures: string[]) {
  const calls = { locator: [] as string[], click: 0, scroll: 0 };
  let n = 0;
  return {
    calls,
    page: {
      locator(sel: string) {
        calls.locator.push(sel);
        const failure = failures[n++];
        const loc = {
          first: () => loc,
          waitFor: () =>
            failure?.includes('visible') ? Promise.reject(new Error(failure)) : Promise.resolve(),
          scrollIntoViewIfNeeded: () => {
            calls.scroll += 1;
            return Promise.resolve();
          },
          click: (o: Record<string, unknown>) => {
            expect(o.force).toBeUndefined();
            if (failure && !failure.includes('visible')) return Promise.reject(new Error(failure));
            calls.click += 1;
            return Promise.resolve();
          },
        };
        return loc;
      },
    },
  };
}

function clock() {
  let t = 0;
  return { now: () => t, sleepFn: (ms: number) => Promise.resolve(void (t += ms)) };
}

describe('FOLLOW-1398 — clickCtaWhenReady', () => {
  it('clicks first time when the CTA is stable (1 attempt)', async () => {
    const { page, calls } = fakePage([]);
    const r = await clickCtaWhenReady(page, clock());
    expect(r).toMatchObject({ clicked: true, attempts: 1, error: null });
    expect(calls.scroll).toBe(1);
  });

  it.each([
    ['not stable', 'locator.click: Timeout 3000ms exceeded. element is not stable'],
    ['not visible', 'locator.waitFor: Timeout 2000ms exceeded. waiting for element to be visible'],
  ])('recovers from a transient "%s" by re-resolving the locator', async (_n, msg) => {
    const { page, calls } = fakePage([msg, msg]);
    const r = await clickCtaWhenReady(page, clock());
    expect(r.clicked).toBe(true);
    expect(r.attempts).toBe(3);
    expect(r.errors).toHaveLength(2);
    expect(calls.locator).toHaveLength(3); // re-resolved every attempt
    expect(calls.locator.every((s) => s.includes(':visible'))).toBe(true);
  });

  it('a CTA that never becomes clickable stays RED: bounded attempts, last error kept', async () => {
    const msg = 'waiting for element to be visible';
    const { page, calls } = fakePage(Array(100).fill(msg));
    const c = clock();
    const r = await clickCtaWhenReady(page, { ...c, budgetMs: 1000 });
    expect(r.clicked).toBe(false);
    expect(r.error).toContain(msg);
    expect(r.attempts).toBeGreaterThan(1);
    expect(r.attempts).toBeLessThanOrEqual(5);
    expect(calls.click).toBe(0);
  });

  it('AC(5) call site uses the helper, records attempts, and never force-clicks', () => {
    expect(harnessSrc).toContain('await clickCtaWhenReady(page);');
    expect(harnessSrc).toContain('ctaClickAttempts: adaptedCtaClickAttempts,');
    const fn = harnessSrc.slice(
      harnessSrc.indexOf('export async function clickCtaWhenReady'),
      harnessSrc.indexOf('// ─── FOLLOW-1361: AC(10), the quiz confirmation path'),
    );
    expect(fn).not.toMatch(/force:\s*true/);
  });
});
