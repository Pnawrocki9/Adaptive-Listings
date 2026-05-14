/**
 * Unit tests for createSidebarWidget (Tier 1 Observer sidebar panel).
 *
 * Test environment: node (vitest default for this package), with a minimal
 * DOM API stub that covers everything the widget touches.
 */

/* eslint-disable @typescript-eslint/unbound-method --
 * MockElement methods are accessed as destructured object properties in test
 * helpers (e.g. el.appendChild, el.classList.add). This is the standard
 * test-stub pattern; methods do not rely on `this` binding. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createSidebarWidget,
  type SidebarState,
  type SidebarWidgetOptions,
} from '../ui/sidebar-widget.js';

// ---------------------------------------------------------------------------
// DOM stub types
// ---------------------------------------------------------------------------

interface MockElement {
  tagName: string;
  className: string;
  textContent: string;
  style: Record<string, string>;
  children: MockElement[];
  eventListeners: Record<string, ((...args: unknown[]) => void)[]>;
  attrs: Record<string, string>;
  parentNode: MockElement | null;
  classList: {
    add: (cls: string) => void;
    remove: (cls: string) => void;
    contains: (cls: string) => boolean;
    _classes: Set<string>;
  };
  appendChild: (child: MockElement) => MockElement;
  removeChild: (child: MockElement) => MockElement;
  remove: () => void;
  setAttribute: (k: string, v: string) => void;
  getAttribute: (k: string) => string | null;
  addEventListener: (ev: string, fn: (...args: unknown[]) => void) => void;
  removeEventListener: (ev: string, fn: (...args: unknown[]) => void) => void;
  dispatchEvent: (ev: { type: string }) => void;
  offsetHeight: number;
  lastChild: MockElement | null;
}

// ---------------------------------------------------------------------------
// DOM stub factory
// ---------------------------------------------------------------------------

function makeElement(tag: string): MockElement {
  const classes = new Set<string>();
  const el: MockElement = {
    tagName: tag.toUpperCase(),
    className: '',
    textContent: '',
    style: {},
    children: [],
    eventListeners: {},
    attrs: {},
    parentNode: null,
    offsetHeight: 50,
    get lastChild(): MockElement | null {
      return el.children[el.children.length - 1] ?? null;
    },
    classList: {
      _classes: classes,
      add(cls: string) {
        classes.add(cls);
        el.className = [...classes].join(' ');
      },
      remove(cls: string) {
        classes.delete(cls);
        el.className = [...classes].join(' ');
      },
      contains(cls: string) {
        return classes.has(cls);
      },
    },
    appendChild(child: MockElement) {
      child.parentNode = el;
      el.children.push(child);
      return child;
    },
    removeChild(child: MockElement) {
      const idx = el.children.indexOf(child);
      if (idx !== -1) {
        el.children.splice(idx, 1);
        child.parentNode = null;
      }
      return child;
    },
    remove() {
      if (el.parentNode) {
        el.parentNode.removeChild(el);
      }
    },
    setAttribute(k: string, v: string) {
      el.attrs[k] = v;
    },
    getAttribute(k: string) {
      return el.attrs[k] ?? null;
    },
    addEventListener(ev: string, fn: (...args: unknown[]) => void) {
      el.eventListeners[ev] ??= [];
      el.eventListeners[ev].push(fn);
    },
    removeEventListener(ev: string, fn: (...args: unknown[]) => void) {
      if (!el.eventListeners[ev]) return;
      el.eventListeners[ev] = el.eventListeners[ev].filter((f) => f !== fn);
    },
    dispatchEvent(ev: { type: string }) {
      const fns = el.eventListeners[ev.type] ?? [];
      fns.forEach((f) => {
        f(ev);
      });
    },
  };
  return el;
}

// ---------------------------------------------------------------------------
// Tree-walk helpers
// ---------------------------------------------------------------------------

function findAll(el: MockElement, pred: (e: MockElement) => boolean): MockElement[] {
  const results: MockElement[] = [];
  function walk(node: MockElement): void {
    if (pred(node)) results.push(node);
    node.children.forEach(walk);
  }
  walk(el);
  return results;
}

/**
 * Check if an element has a given class, regardless of how it was applied
 * (directly via className string assignment or via classList.add).
 */
function hasClass(el: MockElement, cls: string): boolean {
  // Check the _classes Set (populated by classList.add)
  if (el.classList._classes.has(cls)) return true;
  // Also check the className string directly (populated by direct `.className =` assignment)
  return el.className.split(' ').includes(cls);
}

function findByClass(el: MockElement, cls: string): MockElement | undefined {
  return findAll(el, (e) => hasClass(e, cls))[0];
}

// ---------------------------------------------------------------------------
// Test setup — stub global document + window
// ---------------------------------------------------------------------------

const docListeners: Record<string, ((...args: unknown[]) => void)[]> = {};

beforeEach(() => {
  vi.stubGlobal('document', {
    createElement: vi.fn((tag: string): MockElement => makeElement(tag)),
    createTextNode: vi.fn((text: string): MockElement => {
      const el = makeElement('#text');
      el.textContent = text;
      return el;
    }),
    addEventListener: vi.fn((ev: string, fn: (...args: unknown[]) => void) => {
      docListeners[ev] ??= [];
      docListeners[ev].push(fn);
    }),
    removeEventListener: vi.fn((ev: string, fn: (...args: unknown[]) => void) => {
      if (docListeners[ev]) {
        docListeners[ev] = docListeners[ev].filter((f) => f !== fn);
      }
    }),
  });

  vi.stubGlobal('window', {
    innerHeight: 768,
    getComputedStyle: vi.fn(() => ({ top: '300px' })),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const key of Object.keys(docListeners)) {
    docListeners[key] = [];
  }
});

// ---------------------------------------------------------------------------
// Shadow root factory
// ---------------------------------------------------------------------------

function makeShadowRootWithCapture(): {
  shadowRoot: ShadowRoot;
  getPanel(): MockElement | undefined;
} {
  const appendedChildren: MockElement[] = [];

  const shadowRoot = {
    appendChild: vi.fn((el: MockElement) => {
      appendedChildren.push(el);
      el.parentNode = shadowRoot as unknown as MockElement;
      return el;
    }),
    removeChild: vi.fn((el: MockElement) => {
      const idx = appendedChildren.indexOf(el);
      if (idx !== -1) {
        appendedChildren.splice(idx, 1);
        el.parentNode = null;
      }
      return el;
    }),
    children: appendedChildren,
  } as unknown as ShadowRoot;

  return {
    shadowRoot,
    getPanel() {
      return appendedChildren.find(
        (el): el is MockElement => el.attrs['data-estalara-sidebar'] === '',
      );
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Assert that an element is defined and return it, narrowing the type.
 * Used in tests where we already expect the element to exist.
 */
function assertEl(el: MockElement | undefined, desc: string): MockElement {
  if (!el) throw new Error(`Expected element ${desc} to exist but it was undefined`);
  return el;
}

/**
 * Assert that an array has at least one item and return the first element.
 */
function firstEl(arr: MockElement[], desc: string): MockElement {
  const el = arr[0];
  if (!el) throw new Error(`Expected at least one element for ${desc} but array was empty`);
  return el;
}

/**
 * Assert that a function-from-listeners array has at least one item and return it.
 */
function firstFn(
  fns: ((...args: unknown[]) => void)[] | undefined,
  desc: string,
): (...args: unknown[]) => void {
  if (!fns || fns.length === 0)
    throw new Error(`Expected at least one listener for ${desc} but found none`);

  return fns[0]!;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const DEFAULT_STATE: SidebarState = {
  archetype: 'Yield Hunter',
  confidence: 0.82,
  signalCount: 7,
};

const OPTIONS: SidebarWidgetOptions = {
  accentColor: '#ff5500',
  language: 'en',
  onClose: vi.fn(),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createSidebarWidget', () => {
  describe('mount', () => {
    it('appends a <style> element and the panel element to the shadow root', () => {
      const { shadowRoot } = makeShadowRootWithCapture();
      createSidebarWidget(shadowRoot, OPTIONS);

      const appended = (shadowRoot as unknown as { children: MockElement[] }).children;
      const styleEls = appended.filter((e) => e.tagName === 'STYLE');
      const panelEls = appended.filter((e) => e.attrs['data-estalara-sidebar'] === '');

      expect(styleEls.length).toBeGreaterThanOrEqual(1);
      expect(panelEls).toHaveLength(1);
    });

    it('panel is hidden by default (does not have --visible class)', () => {
      const { shadowRoot, getPanel } = makeShadowRootWithCapture();
      createSidebarWidget(shadowRoot, OPTIONS);
      const panel = getPanel();
      expect(panel).toBeDefined();
      expect(panel!.classList.contains('estalara-sidebar--visible')).toBe(false);
    });

    it('sets role="complementary" on panel for accessibility', () => {
      const { shadowRoot, getPanel } = makeShadowRootWithCapture();
      createSidebarWidget(shadowRoot, OPTIONS);
      const panel = getPanel();
      expect(panel!.attrs.role).toBe('complementary');
    });

    it('attaches mousemove and mouseup listeners on document for drag', () => {
      const { shadowRoot } = makeShadowRootWithCapture();
      createSidebarWidget(shadowRoot, OPTIONS);
      expect(document.addEventListener).toHaveBeenCalledWith('mousemove', expect.any(Function));
      expect(document.addEventListener).toHaveBeenCalledWith('mouseup', expect.any(Function));
    });
  });

  describe('show()', () => {
    it('adds the --visible class to the panel', () => {
      const { shadowRoot, getPanel } = makeShadowRootWithCapture();
      const widget = createSidebarWidget(shadowRoot, OPTIONS);
      widget.show(DEFAULT_STATE);
      const panel = getPanel();
      expect(panel!.classList.contains('estalara-sidebar--visible')).toBe(true);
    });

    it('renders archetype name into the archetype label element', () => {
      const { shadowRoot, getPanel } = makeShadowRootWithCapture();
      const widget = createSidebarWidget(shadowRoot, OPTIONS);
      widget.show({ ...DEFAULT_STATE, archetype: 'Portfolio Builder' });
      const panel = getPanel()!;
      const labels = findAll(panel, (e) => e.className === 'estalara-sidebar__archetype-label');
      expect(labels.length).toBeGreaterThanOrEqual(1);
      expect(firstEl(labels, 'archetype-label').textContent).toBe('Portfolio Builder');
    });

    it('renders confidence as a rounded percentage', () => {
      const { shadowRoot, getPanel } = makeShadowRootWithCapture();
      const widget = createSidebarWidget(shadowRoot, OPTIONS);
      widget.show({ ...DEFAULT_STATE, confidence: 0.756 });
      const panel = getPanel()!;
      const badges = findAll(panel, (e) => e.className === 'estalara-sidebar__confidence-badge');
      expect(badges.length).toBeGreaterThanOrEqual(1);
      expect(firstEl(badges, 'confidence-badge').textContent).toBe('76%');
    });

    it('does not render the directives section when directives are absent', () => {
      const { shadowRoot, getPanel } = makeShadowRootWithCapture();
      const widget = createSidebarWidget(shadowRoot, OPTIONS);
      // omit directives field entirely — exactOptionalPropertyTypes compliant
      widget.show(DEFAULT_STATE);
      const panel = getPanel()!;
      const bodyEl = findByClass(panel, 'estalara-sidebar__body');
      const directiveInBody = bodyEl
        ? findAll(bodyEl, (e) => hasClass(e, 'estalara-sidebar__directives'))
        : [];
      expect(directiveInBody).toHaveLength(0);
    });

    it('renders directives preview when directives are provided', () => {
      const { shadowRoot, getPanel } = makeShadowRootWithCapture();
      const widget = createSidebarWidget(shadowRoot, OPTIONS);
      widget.show({
        ...DEFAULT_STATE,
        directives: [
          { slot: 'headline', text: 'Great yield opportunity' },
          { slot: 'cta', text: 'Calculate ROI now' },
        ],
      });
      const panel = getPanel()!;
      const bodyEl = findByClass(panel, 'estalara-sidebar__body');
      const directiveSection = bodyEl
        ? findByClass(bodyEl, 'estalara-sidebar__directives')
        : undefined;
      expect(directiveSection).toBeDefined();

      const items = directiveSection
        ? findAll(directiveSection, (e) => hasClass(e, 'estalara-sidebar__directive-item'))
        : [];
      expect(items).toHaveLength(2);
    });
  });

  describe('update()', () => {
    it('updates archetype label without toggling visibility', () => {
      const { shadowRoot, getPanel } = makeShadowRootWithCapture();
      const widget = createSidebarWidget(shadowRoot, OPTIONS);
      widget.show(DEFAULT_STATE);
      widget.update({ ...DEFAULT_STATE, archetype: 'Family Buyer' });
      const panel = getPanel()!;
      expect(panel.classList.contains('estalara-sidebar--visible')).toBe(true);
      const archetypeLabels = findAll(
        panel,
        (e) => e.className === 'estalara-sidebar__archetype-label',
      );
      expect(firstEl(archetypeLabels, 'archetype-label').textContent).toBe('Family Buyer');
    });

    it('updates directives list on subsequent calls', () => {
      const { shadowRoot, getPanel } = makeShadowRootWithCapture();
      const widget = createSidebarWidget(shadowRoot, OPTIONS);
      widget.show({ ...DEFAULT_STATE, directives: [{ slot: 'headline', text: 'First' }] });
      widget.update({
        ...DEFAULT_STATE,
        directives: [
          { slot: 'headline', text: 'Updated A' },
          { slot: 'cta', text: 'Updated B' },
        ],
      });
      const panel = getPanel()!;
      const bodyEl = findByClass(panel, 'estalara-sidebar__body');
      const directiveSection = bodyEl
        ? findByClass(bodyEl, 'estalara-sidebar__directives')
        : undefined;
      const items = directiveSection
        ? findAll(directiveSection, (e) => hasClass(e, 'estalara-sidebar__directive-item'))
        : [];
      expect(items).toHaveLength(2);
    });

    it('removes directives section when update provides empty directives', () => {
      const { shadowRoot, getPanel } = makeShadowRootWithCapture();
      const widget = createSidebarWidget(shadowRoot, OPTIONS);
      widget.show({ ...DEFAULT_STATE, directives: [{ slot: 'headline', text: 'Visible' }] });
      widget.update({ ...DEFAULT_STATE, directives: [] });
      const panel = getPanel()!;
      const bodyEl = findByClass(panel, 'estalara-sidebar__body');
      const directiveInBody = bodyEl
        ? findAll(bodyEl, (e) => hasClass(e, 'estalara-sidebar__directives'))
        : [];
      expect(directiveInBody).toHaveLength(0);
    });
  });

  describe('hide()', () => {
    it('removes the --visible class', () => {
      const { shadowRoot, getPanel } = makeShadowRootWithCapture();
      const widget = createSidebarWidget(shadowRoot, OPTIONS);
      widget.show(DEFAULT_STATE);
      widget.hide();
      const panel = getPanel()!;
      expect(panel.classList.contains('estalara-sidebar--visible')).toBe(false);
    });

    it('sets display:none on the panel element', () => {
      const { shadowRoot, getPanel } = makeShadowRootWithCapture();
      const widget = createSidebarWidget(shadowRoot, OPTIONS);
      widget.show(DEFAULT_STATE);
      widget.hide();
      const panel = getPanel()!;
      expect(panel.style.display).toBe('none');
    });
  });

  describe('destroy()', () => {
    it('removes the panel element from the shadow root', () => {
      const { shadowRoot, getPanel } = makeShadowRootWithCapture();
      const widget = createSidebarWidget(shadowRoot, OPTIONS);
      widget.show(DEFAULT_STATE);
      widget.destroy();
      const panel = getPanel();
      expect(panel).toBeUndefined();
    });

    it('removes document mousemove and mouseup listeners', () => {
      const { shadowRoot } = makeShadowRootWithCapture();
      const widget = createSidebarWidget(shadowRoot, OPTIONS);
      widget.destroy();
      expect(document.removeEventListener).toHaveBeenCalledWith('mousemove', expect.any(Function));
      expect(document.removeEventListener).toHaveBeenCalledWith('mouseup', expect.any(Function));
    });

    it('does not throw when destroy is called twice', () => {
      const { shadowRoot } = makeShadowRootWithCapture();
      const widget = createSidebarWidget(shadowRoot, OPTIONS);
      expect(() => {
        widget.destroy();
        widget.destroy();
      }).not.toThrow();
    });
  });

  describe('close button', () => {
    it('calls onClose callback when close button is clicked', () => {
      const onClose = vi.fn();
      const { shadowRoot, getPanel } = makeShadowRootWithCapture();
      const widget = createSidebarWidget(shadowRoot, { ...OPTIONS, onClose });
      widget.show(DEFAULT_STATE);
      const panel = getPanel()!;
      const closeBtn = assertEl(findByClass(panel, 'estalara-sidebar__close'), 'close button');
      closeBtn.dispatchEvent({ type: 'click' });
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('hides the panel after close button click', () => {
      const { shadowRoot, getPanel } = makeShadowRootWithCapture();
      const widget = createSidebarWidget(shadowRoot, OPTIONS);
      widget.show(DEFAULT_STATE);
      const panel = getPanel()!;
      const closeBtn = assertEl(findByClass(panel, 'estalara-sidebar__close'), 'close button');
      closeBtn.dispatchEvent({ type: 'click' });
      expect(panel.classList.contains('estalara-sidebar--visible')).toBe(false);
    });

    it('does not throw when onClose is not provided', () => {
      const { shadowRoot, getPanel } = makeShadowRootWithCapture();
      const widget = createSidebarWidget(shadowRoot, { accentColor: '#0066ff' });
      widget.show(DEFAULT_STATE);
      const panel = getPanel()!;
      const closeBtn = assertEl(findByClass(panel, 'estalara-sidebar__close'), 'close button');
      expect(() => {
        closeBtn.dispatchEvent({ type: 'click' });
      }).not.toThrow();
    });
  });

  describe('drag handle', () => {
    it('renders a drag handle element with the correct class', () => {
      const { shadowRoot, getPanel } = makeShadowRootWithCapture();
      createSidebarWidget(shadowRoot, OPTIONS);
      const panel = getPanel()!;
      const handle = findByClass(panel, 'estalara-sidebar__drag-handle');
      expect(handle).toBeDefined();
    });

    it('drag handle has aria-label for accessibility', () => {
      const { shadowRoot, getPanel } = makeShadowRootWithCapture();
      createSidebarWidget(shadowRoot, OPTIONS);
      const panel = getPanel()!;
      const handle = assertEl(findByClass(panel, 'estalara-sidebar__drag-handle'), 'drag handle');
      expect(handle.attrs['aria-label']).toBeTruthy();
    });

    it('mousedown on drag handle registers a mousedown listener on the handle', () => {
      const { shadowRoot, getPanel } = makeShadowRootWithCapture();
      createSidebarWidget(shadowRoot, OPTIONS);
      const panel = getPanel()!;
      const handle = assertEl(findByClass(panel, 'estalara-sidebar__drag-handle'), 'drag handle');
      expect(handle.eventListeners.mousedown).toHaveLength(1);
    });

    it('mousedown event sets isDragging and resets transform', () => {
      const { shadowRoot, getPanel } = makeShadowRootWithCapture();
      createSidebarWidget(shadowRoot, OPTIONS);
      const panel = getPanel()!;
      const handle = assertEl(findByClass(panel, 'estalara-sidebar__drag-handle'), 'drag handle');

      const mousedownFn = firstFn(handle.eventListeners.mousedown, 'mousedown');
      const fakeEvent = {
        type: 'mousedown',
        clientY: 300,
        preventDefault: vi.fn(),
      };
      mousedownFn(fakeEvent);

      expect(panel.style.transform).toBe('none');
      expect(fakeEvent.preventDefault).toHaveBeenCalled();
    });

    it('mousemove updates panel top when dragging', () => {
      const { shadowRoot, getPanel } = makeShadowRootWithCapture();
      createSidebarWidget(shadowRoot, OPTIONS);
      const panel = getPanel()!;
      panel.offsetHeight = 100;

      const handle = assertEl(findByClass(panel, 'estalara-sidebar__drag-handle'), 'drag handle');
      const mousedownFn = firstFn(handle.eventListeners.mousedown, 'mousedown');
      mousedownFn({ type: 'mousedown', clientY: 300, preventDefault: vi.fn() });

      // window.getComputedStyle → top: '300px', panelStartTop = 300
      // Move to clientY: 350 → delta = 50 → newTop = 350 (within 0–668)
      const moveFns = docListeners.mousemove ?? [];
      expect(moveFns.length).toBeGreaterThan(0);
      moveFns.forEach((fn) => {
        fn({ type: 'mousemove', clientY: 350 });
      });

      expect(panel.style.top).toBe('350px');
    });

    it('mouseup stops dragging so subsequent mousemove has no effect', () => {
      const { shadowRoot, getPanel } = makeShadowRootWithCapture();
      createSidebarWidget(shadowRoot, OPTIONS);
      const panel = getPanel()!;
      panel.offsetHeight = 100;

      const handle = assertEl(findByClass(panel, 'estalara-sidebar__drag-handle'), 'drag handle');
      const mousedownFn = firstFn(handle.eventListeners.mousedown, 'mousedown');
      mousedownFn({ type: 'mousedown', clientY: 300, preventDefault: vi.fn() });

      const upFns = docListeners.mouseup ?? [];
      upFns.forEach((fn) => {
        fn({ type: 'mouseup' });
      });

      const panelTopBefore = panel.style.top;
      const moveFns = docListeners.mousemove ?? [];
      moveFns.forEach((fn) => {
        fn({ type: 'mousemove', clientY: 400 });
      });
      expect(panel.style.top).toBe(panelTopBefore);
    });
  });

  describe('language support', () => {
    it('uses Polish labels when language is pl', () => {
      const { shadowRoot, getPanel } = makeShadowRootWithCapture();
      createSidebarWidget(shadowRoot, { language: 'pl', accentColor: '#0066ff' });
      const panel = getPanel()!;
      const titles = findAll(panel, (e) => e.className === 'estalara-sidebar__title');
      expect(titles.length).toBeGreaterThanOrEqual(1);
      expect(firstEl(titles, 'title').textContent).toBe('Personalizujemy dla Ciebie');
    });

    it('uses Spanish labels when language is es', () => {
      const { shadowRoot, getPanel } = makeShadowRootWithCapture();
      createSidebarWidget(shadowRoot, { language: 'es', accentColor: '#0066ff' });
      const panel = getPanel()!;
      const titles = findAll(panel, (e) => e.className === 'estalara-sidebar__title');
      expect(titles.length).toBeGreaterThanOrEqual(1);
      expect(firstEl(titles, 'title').textContent).toBe('Personalizando para ti');
    });

    it('falls back to English labels by default', () => {
      const { shadowRoot, getPanel } = makeShadowRootWithCapture();
      createSidebarWidget(shadowRoot, { accentColor: '#0066ff' });
      const panel = getPanel()!;
      const titles = findAll(panel, (e) => e.className === 'estalara-sidebar__title');
      expect(titles.length).toBeGreaterThanOrEqual(1);
      expect(firstEl(titles, 'title').textContent).toBe('Personalizing for you');
    });
  });

  describe('CSS scoping', () => {
    it('injects a <style> element so styles are scoped to shadow DOM', () => {
      const { shadowRoot } = makeShadowRootWithCapture();
      createSidebarWidget(shadowRoot, OPTIONS);
      const appended = (shadowRoot as unknown as { children: MockElement[] }).children;
      const styleEls = appended.filter((e) => e.tagName === 'STYLE');
      expect(styleEls.length).toBeGreaterThanOrEqual(1);
      expect(firstEl(styleEls, 'style').textContent).toContain('#ff5500');
    });

    it('style textContent includes sidebar position rules', () => {
      const { shadowRoot } = makeShadowRootWithCapture();
      createSidebarWidget(shadowRoot, { accentColor: '#0066ff' });
      const appended = (shadowRoot as unknown as { children: MockElement[] }).children;
      const styleEl = appended.find((e) => e.tagName === 'STYLE');
      expect(styleEl).toBeDefined();
      expect(styleEl!.textContent).toContain('position: fixed');
      expect(styleEl!.textContent).toContain('right: 0');
    });
  });

  describe('no host DOM mutation', () => {
    it('does not call document.body.appendChild', () => {
      const bodyAppend = vi.fn();
      vi.stubGlobal('document', {
        createElement: vi.fn((tag: string) => makeElement(tag)),
        createTextNode: vi.fn((text: string) => {
          const el = makeElement('#text');
          el.textContent = text;
          return el;
        }),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        body: { appendChild: bodyAppend },
      });

      const { shadowRoot } = makeShadowRootWithCapture();
      createSidebarWidget(shadowRoot, OPTIONS);
      expect(bodyAppend).not.toHaveBeenCalled();
    });
  });
});
