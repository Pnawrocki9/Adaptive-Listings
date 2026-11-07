/**
 * @vitest-environment jsdom
 *
 * FOLLOW-1480 — the withdrawal control collapses to a small icon no later than 3 s after it appears
 * (CEO ruling 2026-11-07, H4 walk). The panel stays in the DOM, hidden; the icon is a real button
 * that brings it back. Pointer over the panel or focus inside it holds it open; it re-collapses
 * `COLLAPSE_MS` after both have left. Withdraw and download still work once it is expanded.
 *
 * @module packages/sdk/src/__tests__/follow-1480.test
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { QuizLanguage } from '@estalara/shared';

import { COLLAPSE_MS, renderProfilingToggle } from '../ui/profiling-toggle.js';

function mount(language: QuizLanguage = 'en'): {
  root: ShadowRoot;
  ctrl: ReturnType<typeof renderProfilingToggle>;
} {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = host.attachShadow({ mode: 'open' });
  const ctrl = renderProfilingToggle(root, {
    language,
    accentColor: '#2563EB',
    initialOptedOut: false,
    onChange: vi.fn(),
  });
  return { root, ctrl };
}

const panel = (root: ShadowRoot): HTMLElement =>
  root.querySelector<HTMLElement>('[data-estalara-profiling-toggle]')!;
const icon = (root: ShadowRoot): HTMLButtonElement =>
  root.querySelector<HTMLButtonElement>('[data-estalara-toggle-icon]')!;
const expanded = (root: ShadowRoot): boolean =>
  panel(root).style.display !== 'none' && icon(root).hidden;
/** A mouse click (detail 1) or a keyboard activation (detail 0, Enter / Space on a button). */
const press = (el: HTMLElement, detail: number): boolean =>
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, detail }));

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '';
});

afterEach(() => {
  vi.useRealTimers();
});

describe('FOLLOW-1480 — the panel collapses to an icon', () => {
  it('is 3000 ms, one named constant', () => {
    expect(COLLAPSE_MS).toBe(3000);
  });

  it('renders expanded, and collapses at 3000 ms, not before', () => {
    const { root } = mount();
    expect(expanded(root)).toBe(true);
    vi.advanceTimersByTime(COLLAPSE_MS - 1);
    expect(expanded(root)).toBe(true);
    vi.advanceTimersByTime(1);
    expect(expanded(root)).toBe(false);
    expect(panel(root).style.display).toBe('none');
    expect(icon(root).hidden).toBe(false);
  });

  it('keeps the panel in the DOM while collapsed, state included', () => {
    const { root } = mount();
    vi.advanceTimersByTime(COLLAPSE_MS);
    expect(panel(root).isConnected).toBe(true);
    expect(root.querySelector('[data-estalara-toggle-checkbox]')).not.toBeNull();
  });

  it('the icon is a button with the locale title as aria-label and aria-expanded', () => {
    for (const [language, title] of [
      ['en', 'Personalization'],
      ['pl', 'Personalizacja'],
      ['es', 'Personalización'],
    ] as const) {
      const { root } = mount(language);
      const button = icon(root);
      expect(button.tagName).toBe('BUTTON');
      // The shadow host is `pointer-events:none`; the icon must take clicks itself.
      expect(button.getAttribute('style')).toContain('pointer-events:auto');
      expect(button.getAttribute('aria-label')).toBe(title);
      expect(button.getAttribute('aria-expanded')).toBe('true');
      vi.advanceTimersByTime(COLLAPSE_MS);
      expect(button.getAttribute('aria-expanded')).toBe('false');
      expect(button.textContent.trim().length).toBe(1);
    }
  });

  it('a click on the icon expands it, and it re-collapses 3000 ms later', () => {
    const { root } = mount();
    vi.advanceTimersByTime(COLLAPSE_MS);
    press(icon(root), 1);
    expect(expanded(root)).toBe(true);
    expect(icon(root).getAttribute('aria-expanded')).toBe('true');
    vi.advanceTimersByTime(COLLAPSE_MS - 1);
    expect(expanded(root)).toBe(true);
    vi.advanceTimersByTime(1);
    expect(expanded(root)).toBe(false);
  });

  it('the pointer over the panel holds it open; it re-collapses 3000 ms after leave', () => {
    const { root } = mount();
    panel(root).dispatchEvent(new Event('pointerenter'));
    vi.advanceTimersByTime(COLLAPSE_MS * 4);
    expect(expanded(root)).toBe(true);
    panel(root).dispatchEvent(new Event('pointerleave'));
    vi.advanceTimersByTime(COLLAPSE_MS - 1);
    expect(expanded(root)).toBe(true);
    vi.advanceTimersByTime(1);
    expect(expanded(root)).toBe(false);
  });

  it('a keyboard expand moves focus in; focus inside holds it; it re-collapses after focus leaves', () => {
    const { root } = mount();
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    vi.advanceTimersByTime(COLLAPSE_MS);
    icon(root).focus();
    press(icon(root), 0);
    expect(expanded(root)).toBe(true);
    expect(root.activeElement?.hasAttribute('data-estalara-toggle-checkbox')).toBe(true);
    vi.advanceTimersByTime(COLLAPSE_MS * 4);
    expect(expanded(root)).toBe(true);
    outside.focus();
    vi.advanceTimersByTime(COLLAPSE_MS - 1);
    expect(expanded(root)).toBe(true);
    vi.advanceTimersByTime(1);
    expect(expanded(root)).toBe(false);
  });

  it('withdraw works after expanding; the status reads, then collapses; the icon reopens it', async () => {
    const { root, ctrl } = mount();
    const onWithdraw = vi.fn(() => Promise.resolve(true));
    ctrl.showWithdraw(onWithdraw, Promise.resolve(undefined));
    vi.advanceTimersByTime(COLLAPSE_MS);
    expect(expanded(root)).toBe(false);

    press(icon(root), 0);
    // A keyboard user: focus sits on the withdraw button, which the status text then replaces.
    const withdraw = root.querySelector<HTMLButtonElement>('[data-estalara-withdraw]')!;
    withdraw.focus();
    withdraw.click();
    expect(onWithdraw).toHaveBeenCalledTimes(1);
    expect(panel(root).getAttribute('role')).toBe('status');
    expect(panel(root).textContent).toBe('Personalization: disabled');
    await vi.advanceTimersByTimeAsync(COLLAPSE_MS - 1);
    expect(expanded(root)).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(expanded(root)).toBe(false);

    press(icon(root), 1);
    expect(expanded(root)).toBe(true);
    expect(panel(root).textContent).toBe('Personalization: disabled');
  });

  it('a mouse withdraw collapses too, though the hovered button is gone and no pointerleave comes', async () => {
    const { root, ctrl } = mount();
    ctrl.showWithdraw(() => Promise.resolve(true), Promise.resolve(undefined));
    panel(root).dispatchEvent(new Event('pointerenter'));
    root.querySelector<HTMLButtonElement>('[data-estalara-withdraw]')!.click();
    await vi.advanceTimersByTimeAsync(COLLAPSE_MS - 1);
    expect(expanded(root)).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(expanded(root)).toBe(false);
  });

  it('download works after expanding', async () => {
    const { root, ctrl } = mount();
    const onData = vi.fn(() => Promise.resolve(false));
    ctrl.showData(onData);
    vi.advanceTimersByTime(COLLAPSE_MS);
    press(icon(root), 1);
    const button = root.querySelector<HTMLButtonElement>('[data-estalara-data]')!;
    button.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(onData).toHaveBeenCalledTimes(1);
    expect(button.textContent).toBe('Download failed, try again');
  });

  it('destroy removes the icon too', () => {
    const { root, ctrl } = mount();
    ctrl.destroy();
    expect(root.querySelector('[data-estalara-toggle-icon]')).toBeNull();
    expect(root.querySelector('[data-estalara-profiling-toggle]')).toBeNull();
  });
});
