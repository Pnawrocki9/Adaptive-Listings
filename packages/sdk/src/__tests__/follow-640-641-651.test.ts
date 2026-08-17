/**
 * @vitest-environment jsdom
 *
 * FOLLOW-640 / FOLLOW-641 / FOLLOW-651 — per-brand widget placement, opt-out label
 * overrides, and the "Powered by Estalara" attribution.
 *
 * The through-line of every case below is ADR-0019 D4: a tenant that configures NOTHING must
 * render byte-identically to before these controls existed. So each feature is asserted twice
 * — once for the configured brand, once for the unconfigured one.
 *
 * FOLLOW-651 specifically closes a HALF_WIRE_P (RETRO-214): `white_label` was piped into the
 * SDK config and read by nothing. These tests assert a RENDERED difference, not a value being
 * passed around, which is the evidence bar that ticket sets.
 *
 * @module packages/sdk/src/__tests__/follow-640-641-651.test
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_OPTOUT_PLACEMENT, DEFAULT_QUIZ_PLACEMENT } from '@estalara/shared';

import { placementToCss } from '../ui/placement.js';
import { renderProfilingToggle } from '../ui/profiling-toggle.js';
import { DEFAULT_QUIZ_DEFINITION, renderQuizWidget } from '../ui/quiz-widget.js';

/** A detached shadow root — the mount target every SDK widget renders into. */
function makeShadowRoot(): ShadowRoot {
  const host = document.createElement('div');
  document.body.appendChild(host);
  return host.attachShadow({ mode: 'open' });
}

beforeEach(() => {
  document.body.innerHTML = '';
});

// ─── FOLLOW-640: placement → CSS ──────────────────────────────────────────────

describe('placementToCss (FOLLOW-640)', () => {
  it('maps each corner to its two anchoring edges', () => {
    expect(placementToCss({ corner: 'bottom-left', offset_x: 24, offset_y: 24 })).toBe(
      'bottom:24px;left:24px',
    );
    expect(placementToCss({ corner: 'bottom-right', offset_x: 8, offset_y: 12 })).toBe(
      'bottom:12px;right:8px',
    );
    expect(placementToCss({ corner: 'top-left', offset_x: 1, offset_y: 2 })).toBe(
      'top:2px;left:1px',
    );
    expect(placementToCss({ corner: 'top-right', offset_x: 0, offset_y: 0 })).toBe(
      'top:0px;right:0px',
    );
  });

  it('emits the default placement for each widget', () => {
    // FOLLOW-1014 raised the quiz default from bottom:24px so it clears the opt-out toggle.
    expect(placementToCss(DEFAULT_QUIZ_PLACEMENT)).toBe('bottom:96px;left:24px');
    expect(placementToCss(DEFAULT_OPTOUT_PLACEMENT)).toBe('bottom:16px;left:16px');
  });
});

// FOLLOW-1015 removed the sticky quiz trigger, so there is no quiz widget with a
// placement any more (the card is a centered overlay). `DEFAULT_QUIZ_PLACEMENT` is still
// asserted above and still drives the admin quiz-config editor's form default, but the
// SDK no longer positions anything with it — see the FOLLOW-1016 stub in FOLLOW_UPS.md.

// ─── FOLLOW-641: opt-out toggle placement + labels ────────────────────────────

describe('profiling opt-out toggle (FOLLOW-641)', () => {
  type ToggleOptions = Parameters<typeof renderProfilingToggle>[1];

  /**
   * `Partial<T>` would add `| undefined` to every key, which
   * `exactOptionalPropertyTypes` rejects — so the overridable keys are listed explicitly and
   * each is applied only when present.
   */
  function renderToggle(
    overrides: {
      language?: ToggleOptions['language'];
      placement?: NonNullable<ToggleOptions['placement']>;
      labels?: NonNullable<ToggleOptions['labels']>;
      showAttribution?: boolean;
    } = {},
  ): ShadowRoot {
    const shadowRoot = makeShadowRoot();
    const onChange: (optedOut: boolean) => void = vi.fn();
    renderProfilingToggle(shadowRoot, {
      language: overrides.language ?? 'en',
      accentColor: '#2563EB',
      initialOptedOut: false,
      onChange,
      ...(overrides.placement ? { placement: overrides.placement } : {}),
      ...(overrides.labels ? { labels: overrides.labels } : {}),
      ...(overrides.showAttribution === undefined
        ? {}
        : { showAttribution: overrides.showAttribution }),
    });
    return shadowRoot;
  }

  function container(shadowRoot: ShadowRoot): Element {
    const el = shadowRoot.querySelector('[data-estalara-profiling-toggle]');
    if (!el) throw new Error('toggle container not rendered');
    return el;
  }

  it('anchors to the configured corner and offsets', () => {
    const style =
      container(
        renderToggle({ placement: { corner: 'bottom-right', offset_x: 32, offset_y: 48 } }),
      ).getAttribute('style') ?? '';
    expect(style).toContain('bottom:48px;right:32px');
    expect(style).not.toContain('left:16px');
  });

  it('unconfigured tenant keeps the pre-FOLLOW-641 bottom-left 16/16 position', () => {
    const style = container(renderToggle()).getAttribute('style') ?? '';
    expect(style).toContain('bottom:16px;left:16px');
  });

  it('applies a per-brand label override for the active language', () => {
    const text = container(renderToggle({ labels: { on: { en: 'tailoring on' } } })).textContent;
    expect(text).toContain('tailoring on');
  });

  it('falls back to the English override when the active language has none', () => {
    const text = container(
      renderToggle({ language: 'pl', labels: { on: { en: 'english only' } } }),
    ).textContent;
    expect(text).toContain('english only');
  });

  it('an aria override replaces the compound state label', () => {
    const toggleInput = container(
      renderToggle({ labels: { aria: { en: 'Personalisation switch' } } }),
    ).querySelector('[role="switch"]');
    expect(toggleInput?.getAttribute('aria-label')).toBe('Personalisation switch');
  });

  it('without overrides the aria label stays the compound "<title>: <state>" form', () => {
    const toggleInput = container(renderToggle()).querySelector('[role="switch"]');
    const label = toggleInput?.getAttribute('aria-label') ?? '';
    expect(label).toContain(':');
    expect(label.length).toBeGreaterThan(1);
  });
});

// ─── FOLLOW-651: "Powered by Estalara" attribution ────────────────────────────

describe('white_label attribution (FOLLOW-651)', () => {
  function renderCard(showAttribution?: boolean): ShadowRoot {
    const shadowRoot = makeShadowRoot();
    renderQuizWidget(
      shadowRoot,
      {
        accentColor: '#2563EB',
        language: 'en',
        definition: DEFAULT_QUIZ_DEFINITION,
        ...(showAttribution === undefined ? {} : { showAttribution }),
      },
      () => undefined,
      () => undefined,
    );
    return shadowRoot;
  }

  it('renders the attribution BY DEFAULT (non-white-label brand)', () => {
    expect(renderCard().textContent).toContain('Powered by Estalara');
  });

  it('renders it when the flag is explicitly false on the brand (white_label === false)', () => {
    expect(renderCard(true).textContent).toContain('Powered by Estalara');
  });

  it('suppresses it for a white-label brand (showAttribution: false)', () => {
    expect(renderCard(false).textContent).not.toContain('Powered by Estalara');
  });

  it('the opt-out toggle honours the same flag', () => {
    const shadowRoot = makeShadowRoot();
    const onChange: (optedOut: boolean) => void = vi.fn();
    renderProfilingToggle(shadowRoot, {
      language: 'en',
      accentColor: '#2563EB',
      initialOptedOut: false,
      onChange,
      showAttribution: false,
    });
    expect(shadowRoot.textContent).not.toContain('Powered by Estalara');
  });
});
