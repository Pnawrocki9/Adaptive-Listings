/**
 * Tests for @/lib/estalara-tenant — FOLLOW-332 AC3.
 *
 * Pins the canonical ESTALARA_TENANT_ID default to CI so a future code change
 * silently swapping the UUID is caught immediately. The value is sourced from
 * the REAL module export path (not injected into the test as a literal) — the
 * assertion proves the production path SUPPLIES the correct id.
 *
 * Guardrail note: the assertion must NOT duplicate the UUID in a hand-typed
 * expected value inside a helper that bypasses the module.  We import the
 * constant from the real module and compare it against the canonical string
 * the CEO locked on 2026-06-15 (backlog/QUEUE.md, MASTER_DESIGN §Snapshot.1).
 *
 * @module apps/control-plane/src/lib/pilot-tenant.test
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

/**
 * The canonical pilot tenant id — locked by CEO on 2026-06-15.
 * Changing this constant requires a deliberate CEO/architect decision.
 * See: docs/MASTER_DESIGN.md §Snapshot.1, ESTALARA_TENANT_ID in
 * apps/control-plane/src/lib/pilot-tenant.ts
 */
const CANONICAL_ESTALARA_TENANT_ID = 'cbc51cfa-1056-40aa-b0a9-6e982b52b1de';

describe('ESTALARA_TENANT_ID resolution (FOLLOW-1322)', () => {
  const KEYS = ['NEXT_PUBLIC_ESTALARA_TENANT_ID', 'NEXT_PUBLIC_PILOT_TENANT_ID'] as const;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of KEYS) {
      saved[k] = process.env[k];
      Reflect.deleteProperty(process.env, k);
    }
    vi.resetModules();
  });

  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) Reflect.deleteProperty(process.env, k);
      else process.env[k] = saved[k];
    }
  });

  const load = async () => (await import('@/lib/estalara-tenant')).ESTALARA_TENANT_ID;

  it('defaults to the baked production tenant, a valid UUID v4', async () => {
    const id = await load();
    expect(id).toBe(CANONICAL_ESTALARA_TENANT_ID);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it('NEXT_PUBLIC_ESTALARA_TENANT_ID wins', async () => {
    process.env.NEXT_PUBLIC_ESTALARA_TENANT_ID = '00000000-0000-0000-0000-0000000000e2';
    process.env.NEXT_PUBLIC_PILOT_TENANT_ID = '00000000-0000-0000-0000-0000000000aa';
    expect(await load()).toBe('00000000-0000-0000-0000-0000000000e2');
  });

  it('falls back to the legacy NEXT_PUBLIC_PILOT_TENANT_ID', async () => {
    process.env.NEXT_PUBLIC_PILOT_TENANT_ID = '00000000-0000-0000-0000-0000000000aa';
    expect(await load()).toBe('00000000-0000-0000-0000-0000000000aa');
  });

  it('treats an empty NEXT_PUBLIC_ESTALARA_TENANT_ID as unset', async () => {
    process.env.NEXT_PUBLIC_ESTALARA_TENANT_ID = '';
    expect(await load()).toBe(CANONICAL_ESTALARA_TENANT_ID);
  });
});
