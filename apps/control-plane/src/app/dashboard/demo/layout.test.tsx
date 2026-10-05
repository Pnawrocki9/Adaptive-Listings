/**
 * DemoLayout — FOLLOW-1288: `/dashboard/demo/*` exists only under `DEMO_MODE=1`.
 *
 * @module apps/control-plane/src/app/dashboard/demo/layout.test
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

const NOT_FOUND = new Error('NEXT_NOT_FOUND');
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw NOT_FOUND;
  }),
}));
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  connection: vi.fn().mockResolvedValue(undefined),
}));

import DemoLayout from './layout';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('DemoLayout — DEMO_MODE gate', () => {
  it('DEMO_MODE=1 → renders its children', async () => {
    vi.stubEnv('DEMO_MODE', '1');
    const child = <div>child</div>;
    const out = await DemoLayout({ children: child });
    expect(out.props.children).toBe(child);
  });

  it.each([[''], ['true'], ['0']])('DEMO_MODE=%j → notFound() (404)', async (value) => {
    vi.stubEnv('DEMO_MODE', value);
    await expect(DemoLayout({ children: <div>child</div> })).rejects.toBe(NOT_FOUND);
  });
});
