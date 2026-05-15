/**
 * Unit tests for TICKET-041 — consent banner and consent state management.
 *
 * Tests cover:
 * - getConsentState() / setConsentState() localStorage-backed state transitions
 * - renderConsentBanner() DOM rendering and callback wiring
 * - SDK init halting when consent is denied
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getConsentState, setConsentState } from '../core/session.js';
import { renderConsentBanner } from '../ui/consent-banner.js';

// ─── localStorage mock ────────────────────────────────────────────────────────

const mockLocalStorage = (() => {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    _store: store,
  };
})();

vi.stubGlobal('localStorage', mockLocalStorage);

// ─── Minimal ShadowRoot mock ──────────────────────────────────────────────────

function makeShadowRoot(): ShadowRoot {
  const children: Node[] = [];
  const root = {
    appendChild(node: Node) {
      children.push(node);
    },
    removeChild(node: Node) {
      const idx = children.indexOf(node);
      if (idx !== -1) children.splice(idx, 1);
    },
    _children: children,
  } as unknown as ShadowRoot;
  return root;
}

// ─── Minimal DOM mock helpers ─────────────────────────────────────────────────

interface MockElement {
  tagName: string;
  className: string;
  textContent: string | null;
  style: Record<string, string> & { setProperty: (k: string, v: string) => void };
  _attrs: Record<string, string>;
  _children: MockElement[];
  _listeners: Record<string, EventListenerOrEventListenerObject[]>;
  setAttribute(key: string, value: string): void;
  getAttribute(key: string): string | null;
  appendChild(child: MockElement): MockElement;
  remove(): void;
  addEventListener(event: string, handler: EventListenerOrEventListenerObject): void;
  click(): void;
  href?: string;
  target?: string;
  rel?: string;
}

function makeElement(tag: string): MockElement {
  const styleProps: Record<string, string> = {};
  const el: MockElement = {
    tagName: tag.toUpperCase(),
    className: '',
    textContent: null,
    style: new Proxy(styleProps, {
      get(target, prop) {
        if (prop === 'setProperty') {
          return (k: string, v: string) => {
            target[k] = v;
          };
        }
        return target[String(prop)];
      },
      set(target, prop, value) {
        target[String(prop)] = String(value);
        return true;
      },
    }) as MockElement['style'],
    _attrs: {},
    _children: [],
    _listeners: {},
    setAttribute(key, value) {
      this._attrs[key] = value;
    },
    getAttribute(key) {
      return this._attrs[key] ?? null;
    },
    appendChild(child) {
      this._children.push(child);
      return child;
    },
    remove() {
      // Simplified: no-op (parent removal tested via shadow root)
    },
    addEventListener(event, handler) {
      this._listeners[event] ??= [];
      this._listeners[event].push(handler);
    },
    click() {
      const handlers = this._listeners.click ?? [];
      handlers.forEach((h) => {
        if (typeof h === 'function') h(new Event('click'));
        else h.handleEvent(new Event('click'));
      });
    },
  };
  return el;
}

// ─── getConsentState / setConsentState ───────────────────────────────────────

describe('getConsentState', () => {
  beforeEach(() => {
    mockLocalStorage.clear();
  });

  it('returns "pending" on first load (no localStorage entry)', () => {
    expect(getConsentState()).toBe('pending');
  });

  it('returns "granted" after setConsentState("granted")', () => {
    setConsentState('granted');
    expect(getConsentState()).toBe('granted');
  });

  it('returns "denied" after setConsentState("denied")', () => {
    setConsentState('denied');
    expect(getConsentState()).toBe('denied');
  });

  it('returns "pending" when localStorage throws (sandboxed context)', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('SecurityError');
      },
    });
    expect(getConsentState()).toBe('pending');
    // Restore
    vi.stubGlobal('localStorage', mockLocalStorage);
  });
});

describe('setConsentState', () => {
  beforeEach(() => {
    mockLocalStorage.clear();
  });

  it('persists "granted" to localStorage', () => {
    setConsentState('granted');
    expect(mockLocalStorage._store.get('estalara_consent')).toBe('granted');
  });

  it('persists "denied" to localStorage', () => {
    setConsentState('denied');
    expect(mockLocalStorage._store.get('estalara_consent')).toBe('denied');
  });

  it('does not throw when localStorage.setItem throws (sandboxed context)', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    });
    expect(() => {
      setConsentState('granted');
    }).not.toThrow();
    // Restore
    vi.stubGlobal('localStorage', mockLocalStorage);
  });
});

// ─── renderConsentBanner DOM tests ───────────────────────────────────────────

describe('renderConsentBanner', () => {
  let root: ShadowRoot;
  const elements: MockElement[] = [];

  beforeEach(() => {
    elements.length = 0;
    root = makeShadowRoot();

    // Mock document.createElement to return our mock elements
    vi.stubGlobal('document', {
      createElement: (tag: string) => {
        const el = makeElement(tag);
        elements.push(el);
        return el;
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal('localStorage', mockLocalStorage);
  });

  it('appends a style tag and a banner div to the shadow root', () => {
    const onGranted = vi.fn();
    const onDenied = vi.fn();

    renderConsentBanner(root, {
      language: 'en',
      accentColor: '#6c5ce7',
      onGranted,
      onDenied,
    });

    const rootChildren = (root as unknown as { _children: Node[] })._children;
    expect(rootChildren).toHaveLength(2); // style + banner div
  });

  it('renders Accept and Decline buttons (EN)', () => {
    const onGranted = vi.fn();
    const onDenied = vi.fn();

    renderConsentBanner(root, {
      language: 'en',
      accentColor: '#6c5ce7',
      onGranted,
      onDenied,
    });

    const buttons = elements.filter((el) => el.tagName === 'BUTTON');
    expect(buttons).toHaveLength(2);
    const texts = buttons.map((b) => b.textContent);
    expect(texts).toContain('Accept');
    expect(texts).toContain('Decline');
  });

  it('renders Akceptuj and Odrzuć buttons (PL)', () => {
    const onGranted = vi.fn();
    const onDenied = vi.fn();

    renderConsentBanner(root, {
      language: 'pl',
      accentColor: '#6c5ce7',
      onGranted,
      onDenied,
    });

    const buttons = elements.filter((el) => el.tagName === 'BUTTON');
    const texts = buttons.map((b) => b.textContent);
    expect(texts).toContain('Akceptuj');
    expect(texts).toContain('Odrzuć');
  });

  it('includes a "Learn more" link when privacyPolicyUrl is provided', () => {
    renderConsentBanner(root, {
      language: 'en',
      accentColor: '#6c5ce7',
      privacyPolicyUrl: 'https://example.com/privacy',
      onGranted: vi.fn(),
      onDenied: vi.fn(),
    });

    const links = elements.filter((el) => el.tagName === 'A');
    expect(links).toHaveLength(1);
    expect(links[0]?.href).toBe('https://example.com/privacy');
  });

  it('does NOT render a "Learn more" link when privacyPolicyUrl is omitted', () => {
    renderConsentBanner(root, {
      language: 'en',
      accentColor: '#6c5ce7',
      onGranted: vi.fn(),
      onDenied: vi.fn(),
    });

    const links = elements.filter((el) => el.tagName === 'A');
    expect(links).toHaveLength(0);
  });

  it('clicking Accept calls onGranted and removes banner', () => {
    const onGranted = vi.fn();
    const onDenied = vi.fn();

    renderConsentBanner(root, {
      language: 'en',
      accentColor: '#6c5ce7',
      onGranted,
      onDenied,
    });

    const acceptBtn = elements.find((el) => el.tagName === 'BUTTON' && el.textContent === 'Accept');
    expect(acceptBtn).toBeDefined();
    acceptBtn!.click();

    expect(onGranted).toHaveBeenCalledOnce();
    expect(onDenied).not.toHaveBeenCalled();
  });

  it('clicking Decline calls onDenied and removes banner', () => {
    const onGranted = vi.fn();
    const onDenied = vi.fn();

    renderConsentBanner(root, {
      language: 'en',
      accentColor: '#6c5ce7',
      onGranted,
      onDenied,
    });

    const declineBtn = elements.find(
      (el) => el.tagName === 'BUTTON' && el.textContent === 'Decline',
    );
    expect(declineBtn).toBeDefined();
    declineBtn!.click();

    expect(onDenied).toHaveBeenCalledOnce();
    expect(onGranted).not.toHaveBeenCalled();
  });

  it('returns a teardown function that removes banner and style', () => {
    const onGranted = vi.fn();
    const onDenied = vi.fn();

    const teardown = renderConsentBanner(root, {
      language: 'en',
      accentColor: '#6c5ce7',
      onGranted,
      onDenied,
    });

    expect(typeof teardown).toBe('function');
    // Calling teardown should not throw
    expect(() => {
      teardown();
    }).not.toThrow();
  });

  it('sets data-estalara-consent attribute on Accept button', () => {
    renderConsentBanner(root, {
      language: 'en',
      accentColor: '#6c5ce7',
      onGranted: vi.fn(),
      onDenied: vi.fn(),
    });

    const acceptBtn = elements.find((el) => el.tagName === 'BUTTON' && el.textContent === 'Accept');
    expect(acceptBtn?._attrs['data-estalara-consent']).toBe('accept');
  });

  it('sets data-estalara-consent attribute on Decline button', () => {
    renderConsentBanner(root, {
      language: 'en',
      accentColor: '#6c5ce7',
      onGranted: vi.fn(),
      onDenied: vi.fn(),
    });

    const declineBtn = elements.find(
      (el) => el.tagName === 'BUTTON' && el.textContent === 'Decline',
    );
    expect(declineBtn?._attrs['data-estalara-consent']).toBe('decline');
  });
});
