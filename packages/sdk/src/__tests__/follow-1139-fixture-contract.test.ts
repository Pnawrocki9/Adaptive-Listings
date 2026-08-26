// @vitest-environment jsdom
/**
 * FOLLOW-1139 — the FOLLOW-819 fixture must satisfy the directive contract it is measured against.
 *
 * WHY THIS EXISTS. `tests/e2e/follow-819/fixture-listing.html` is out of the typesystem by
 * construction (its own header comment says so): nothing breaks at build time when the slot
 * contract or the playbook copy moves, it breaks as a silent RED inside a harness run that
 * costs a full local substrate to reproduce. FOLLOW-819 AC(2) was red for two consecutive
 * sessions on exactly that class of drift — first the page-type strip (FOLLOW-1138), then this
 * one: the served `yield_hunter` headline is a template carrying `{yield}`/`{income}`, the
 * fixture's headline element carried neither `data-estalara-yield` nor `data-estalara-income`,
 * and `interpolatePlaceholders()` (FOLLOW-1018) discards the WHOLE directive on one unresolved
 * token. The fixture also never declared `cta` or `feature` slots, which every playbook ships,
 * so those two directives could only ever emit `no_slot_elements`.
 *
 * WHAT IT ASSERTS, AND WHY IT IS NOT AN INJECTION TEST. It reads the REAL fixture file off
 * disk and applies the REAL `getPlaybook('yield_hunter')` directives through the REAL
 * `applyDirectives()` — no hand-written markup, no hand-written directive value. If either
 * side moves and they stop agreeing, this reds in `pnpm --filter @estalara/sdk test` instead
 * of in a harness run nobody can execute without Docker. It does NOT replace the harness run
 * (it cannot: it has no control plane, no ingest, no page-type resolution) — it guards the one
 * hop the harness kept dying on.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import { applyDirectives, resetAdaptState, setEventQueueRef } from '../core/adapt.js';
import { getPlaybook } from '../core/playbooks/index.js';
import type { TextDirective } from '@estalara/shared';
import type { CollectedEvent } from '../core/events.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'tests',
  'e2e',
  'follow-819',
  'fixture-listing.html',
);

/** The `<body>` of the real harness fixture, loaded into jsdom. Scripts inserted via
 *  `innerHTML` never execute, so the SDK script tag is inert here. */
function loadFixtureBody(): string {
  const html = readFileSync(FIXTURE_PATH, 'utf8');
  const start = html.indexOf('<body>');
  const end = html.indexOf('</body>');
  expect(start, 'fixture has a <body>').toBeGreaterThan(-1);
  expect(end, 'fixture has a </body>').toBeGreaterThan(start);
  return html.slice(start + '<body>'.length, end);
}

/** Every headline copy the decision API can serve for this archetype: `en` plus every bandit variant. */
function headlineCopies(): string[] {
  const headline = getPlaybook('yield_hunter').slots.find((s) => s.slot === 'headline');
  expect(headline, 'yield_hunter ships a headline slot').toBeDefined();
  return [headline!.en, ...(headline!.variants?.en ?? [])];
}

let events: CollectedEvent[];

beforeEach(() => {
  resetAdaptState();
  events = [];
  setEventQueueRef(events);
  document.body.innerHTML = loadFixtureBody();
});

afterEach(() => {
  resetAdaptState();
  document.body.innerHTML = '';
});

function slotText(slot: string): string | null {
  const el = document.querySelector(`[data-estalara-slot="${slot}"]`);
  return el ? el.textContent.trim().replace(/\s+/g, ' ') : null;
}

function skipReasons(): string[] {
  return events
    .filter((e) => e.type === 'adapt.skipped')
    .map((e) => String((e.payload as { reason?: unknown }).reason));
}

describe('FOLLOW-1139 — FOLLOW-819 fixture satisfies the yield_hunter playbook', () => {
  it('declares every slot the playbook addresses', () => {
    const declared = new Set(
      [...document.querySelectorAll('[data-estalara-slot]')].map((el) =>
        el.getAttribute('data-estalara-slot'),
      ),
    );
    const addressed = getPlaybook('yield_hunter').slots.map((s) => s.slot);
    expect([...addressed].filter((s) => !declared.has(s))).toEqual([]);
  });

  it.each(headlineCopies())('resolves every placeholder in headline copy %#', (copy) => {
    const directive: TextDirective = {
      type: 'text',
      slot: 'headline',
      value: copy,
      archetype: 'yield_hunter',
      confidence: 1,
    };
    const before = slotText('headline');
    applyDirectives([directive]);

    expect(skipReasons().filter((r) => r.startsWith('unresolved_token_'))).toEqual([]);
    expect(slotText('headline')).not.toBe(before);
    expect(slotText('headline')).not.toMatch(/\{[a-z_]+\}/i);
  });

  it('paints every playbook slot — the harness AC(2) observable', () => {
    const before = new Map(
      [...document.querySelectorAll('[data-estalara-slot]')].map((el) => [
        el.getAttribute('data-estalara-slot')!,
        el.textContent.trim().replace(/\s+/g, ' '),
      ]),
    );
    const directives: TextDirective[] = getPlaybook('yield_hunter').slots.map((s) => ({
      type: 'text',
      slot: s.slot,
      value: s.en,
      archetype: 'yield_hunter',
      confidence: 1,
    }));
    applyDirectives(directives);

    expect(skipReasons()).toEqual([]);
    for (const slot of ['headline', 'cta', 'feature']) {
      expect(slotText(slot), `${slot} changed`).not.toBe(before.get(slot));
    }
  });
});
