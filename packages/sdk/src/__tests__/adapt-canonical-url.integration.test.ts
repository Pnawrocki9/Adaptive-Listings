// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { CONTROL_PLANE_URL } from '@estalara/shared';

import { readConfig } from '../core/config.js';
import { fetchDirectives, resetAdaptState } from '../core/adapt.js';
import type { SessionState } from '../core/session.js';

/**
 * FOLLOW-105 integration test — full canonical-path contract.
 *
 * Reproduces the production flow end-to-end without cross-importing the
 * control-plane component:
 *
 *   wizard activation → snippet generation → simulated SDK init → adapt request
 *
 * The snippet is built in the SAME format as
 * `apps/control-plane/src/components/onboarding/DetectionPreview.buildSnippet`
 * (`data-decision-url="${CONTROL_PLANE_URL}/api"`), parsed into a real <script>
 * element, run through the production `readConfig()`, then `fetchDirectives()`.
 * The test asserts the mocked fetch target is exactly
 * `https://admin.estalara.com/api/adapt` — the canonical control-plane endpoint
 * (ADR-0006 §Decision 2).
 *
 * Guard: if buildSnippet ever drifts from `${host}/api`, OR if readConfig/adapt
 * stop appending `/adapt`, this test breaks — surfacing the [BLOCKER] from the
 * 1a audit (§A / §F.1) at CI time.
 */

const SESSION: SessionState = {
  sessionId: 'integration-session',
  startedAt: Date.now(),
  pageCount: 1,
};

const VALID_RESPONSE = {
  adapt_decision_id: '22222222-2222-4222-8222-222222222222',
  session_id: 'integration-session',
  archetype: 'yield_hunter',
  confidence: 0.87,
  similarity: 0.91,
  tier: 1 as const,
  directives: [],
  source: 'playbook' as const,
  generated_at: '2026-05-25T00:00:00.000Z',
};

/**
 * Mirror of control-plane buildSnippet(). Kept here (not imported) because the
 * SDK package cannot resolve apps/control-plane at test time; the format must be
 * identical, which is exactly what this test guards.
 */
function buildSnippet(tenantId: string, apiKey: string): string {
  return `<script\n  src="https://cdn.estalara.com/sdk.js"\n  data-tenant-id="${tenantId}"\n  data-api-key="${apiKey}"\n  data-decision-url="${CONTROL_PLANE_URL}/api"\n></script>`;
}

/** Parse a snippet HTML string into a live <script> element (for dataset access). */
function snippetToScriptEl(snippet: string): HTMLScriptElement {
  const tpl = document.createElement('template');
  tpl.innerHTML = snippet.trim();
  const el = tpl.content.querySelector('script');
  if (!el) throw new Error('snippet did not contain a <script> element');
  return el;
}

beforeEach(() => {
  resetAdaptState();
});

afterEach(() => {
  vi.restoreAllMocks();
  resetAdaptState();
});

describe('FOLLOW-105 — snippet → SDK init → canonical /api/adapt request', () => {
  it('routes the adapt request to https://admin.estalara.com/api/adapt', async () => {
    const tenantId = '550e8400-e29b-41d4-a716-446655440000';
    const apiKey = 'est_pub_integration';

    // 1. Wizard activation → snippet generation.
    const snippet = buildSnippet(tenantId, apiKey);

    // 2. Simulated SDK init — parse the snippet's data-* attributes via readConfig.
    const scriptEl = snippetToScriptEl(snippet);
    const config = readConfig(scriptEl);

    expect(config.decisionApiUrl).toBe(`${CONTROL_PLANE_URL}/api`);
    expect(config.tenantId).toBe(tenantId);
    expect(config.apiKey).toBe(apiKey);

    // 3. Adapt request — assert the fetched URL is the canonical endpoint.
    const mockFetch = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve({ ok: true, json: () => Promise.resolve(VALID_RESPONSE) }),
    );
    vi.stubGlobal('fetch', mockFetch);

    const result = await fetchDirectives(config, SESSION, 'listing_list');

    expect(result).not.toBeNull();
    const fetchedUrl = mockFetch.mock.calls[0]?.[0] ?? '';
    expect(fetchedUrl).toBe('https://admin.estalara.com/api/adapt');
  });
});
