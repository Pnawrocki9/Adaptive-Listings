// @vitest-environment jsdom
/**
 * Producer-side unit test for detect-bundle.ts (FOLLOW-335 / RETRO-082 TG-1).
 *
 * Verifies that importing detect-bundle.ts assigns `globalThis.__EStalaraDetect`
 * with callable `detectSiteSchema` and `extractArchetypeHints` functions.
 *
 * This covers the PRODUCER side of the global:
 *   - detect-bundle.ts sets the global on module evaluation (IIFE assignment).
 *   - The CONSUMER side (SDK init()) reads the global opportunistically in index.ts.
 *
 * A regression (empty object, wrong global name, missing function) would silently
 * break cold-start archetype hints for all tenants, which is why this test exists.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Mirrors the type declared in detect-bundle.ts and consumed in index.ts. */
interface DetectGlobal {
  detectSiteSchema: (...args: unknown[]) => unknown;
  extractArchetypeHints: (...args: unknown[]) => unknown;
}

describe('detect-bundle.ts — globalThis.__EStalaraDetect producer', () => {
  beforeEach(() => {
    // Reset the global so the IIFE assignment is always observable in isolation.
    // Use `delete` rather than `= undefined` because exactOptionalPropertyTypes
    // disallows assigning undefined to an optional property.
    delete (globalThis as { __EStalaraDetect?: DetectGlobal }).__EStalaraDetect;

    // Reset module registry so the module re-evaluates and the IIFE runs again.
    vi.resetModules();
  });

  it('AC1: sets globalThis.__EStalaraDetect on module evaluation', async () => {
    // Dynamic import triggers the IIFE assignment in detect-bundle.ts.
    await import('../detect-bundle.js');

    const detect = (globalThis as { __EStalaraDetect?: DetectGlobal }).__EStalaraDetect;

    expect(detect).toBeDefined();
  });

  it('AC1: exposes detectSiteSchema as a callable function', async () => {
    await import('../detect-bundle.js');

    const detect = (globalThis as { __EStalaraDetect?: DetectGlobal }).__EStalaraDetect;

    expect(typeof detect?.detectSiteSchema).toBe('function');
  });

  it('AC1: exposes extractArchetypeHints as a callable function', async () => {
    await import('../detect-bundle.js');

    const detect = (globalThis as { __EStalaraDetect?: DetectGlobal }).__EStalaraDetect;

    expect(typeof detect?.extractArchetypeHints).toBe('function');
  });

  it('AC1: global is absent before module is imported', () => {
    // Confirms beforeEach cleanup works — the global should be undefined until
    // detect-bundle.ts is imported. This guards against a stale global masking a
    // regression where the module no longer assigns the global at all.
    const detect = (globalThis as { __EStalaraDetect?: DetectGlobal }).__EStalaraDetect;

    expect(detect).toBeUndefined();
  });
});
