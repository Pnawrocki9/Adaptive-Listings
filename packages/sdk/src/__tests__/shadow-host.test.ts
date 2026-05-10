import { describe, expect, it, vi, afterEach } from 'vitest';

import { createShadowHost, SHADOW_BASE_CSS } from '../ui/shadow-host.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createShadowHost', () => {
  it('returns null when document is undefined', () => {
    vi.stubGlobal('document', undefined);
    const host = createShadowHost();
    expect(host).toBeNull();
  });

  it('creates a container with an open shadow root when document exists', () => {
    const appended: Element[] = [];
    const mockShadowRoot = {
      appendChild: vi.fn(),
    } as unknown as ShadowRoot;
    const attachShadowSpy = vi.fn(() => mockShadowRoot);
    const mockContainer = {
      setAttribute: vi.fn(),
      attachShadow: attachShadowSpy,
    } as unknown as HTMLElement;
    const mockStyle = { textContent: '' } as unknown as HTMLStyleElement;
    const mockInner = { className: '' } as unknown as HTMLDivElement;

    vi.stubGlobal('document', {
      createElement: vi.fn((tag: string) => {
        if (tag === 'div') return appended.length === 0 ? mockContainer : mockInner;
        if (tag === 'style') return mockStyle;
        return mockInner;
      }),
      body: {
        appendChild: vi.fn((el: Element) => {
          appended.push(el);
        }),
      },
    });

    const host = createShadowHost();
    expect(host).not.toBeNull();
    expect(host?.root).toBe(mockShadowRoot);
    expect(attachShadowSpy).toHaveBeenCalledWith({ mode: 'open' });
  });

  it('returns null when attachShadow throws', () => {
    const mockContainer = {
      setAttribute: vi.fn(),
      attachShadow: vi.fn(() => {
        throw new Error('not supported');
      }),
    } as unknown as HTMLElement;

    vi.stubGlobal('document', {
      createElement: vi.fn(() => mockContainer),
      body: { appendChild: vi.fn() },
    });

    const host = createShadowHost();
    expect(host).toBeNull();
  });
});

describe('SHADOW_BASE_CSS', () => {
  it('contains box-sizing reset', () => {
    expect(SHADOW_BASE_CSS).toContain('box-sizing: border-box');
  });

  it('contains estalara-root class with fixed positioning', () => {
    expect(SHADOW_BASE_CSS).toContain('.estalara-root');
    expect(SHADOW_BASE_CSS).toContain('position: fixed');
  });

  it('contains estalara-widget pointer-events rule', () => {
    expect(SHADOW_BASE_CSS).toContain('.estalara-widget');
    expect(SHADOW_BASE_CSS).toContain('pointer-events: auto');
  });

  it('contains z-index 2147483647', () => {
    expect(SHADOW_BASE_CSS).toContain('2147483647');
  });
});
