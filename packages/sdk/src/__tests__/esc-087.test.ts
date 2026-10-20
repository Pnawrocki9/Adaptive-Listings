// @vitest-environment jsdom
/**
 * ESC-087 (CEO ruling 2026-10-20, option 1): the `similarity` the SDK sends to /api/adapt is capped
 * at 0.85 — the route's playbook-branch threshold (`similarity > 0.85` → playbook without the LLM).
 * A confirmed quiz leaf (0.90, FOLLOW-1359) must still reach the LLM branch; the calibrated posterior
 * stays in the SDK state and in `quiz_runs`. `confidence` is sent unchanged.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { CollectedEvent } from '../core/events.js';
import type { SdkConfig } from '../core/config.js';
import type { SessionState } from '../core/session.js';
import { fetchDirectives, resetAdaptState, setEventQueueRef } from '../core/adapt.js';
import { applyQuizLeaf, initIntentState } from '../core/intent.js';

const CONFIG: SdkConfig = {
  apiKey: 'est_pub_esc087',
  ingestUrl: 'https://ingest.estalara.com/v1/events',
  debug: false,
  consentState: 'legitimate_interest',
  language: 'en',
  accentColor: '#6c5ce7',
  decisionApiUrl: 'https://admin.estalara.com/api',
  tenantId: '550e8400-e29b-41d4-a716-446655440087',
};
const SESSION: SessionState = { sessionId: 'esc-087-sess', startedAt: Date.now(), pageCount: 1 };
const RESPONSE = {
  adapt_decision_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  session_id: 'esc-087-sess',
  archetype: 'first_time_buyer',
  confidence: 0.9,
  similarity: 0.85,
  tier: 1 as const,
  directives: [],
  source: 'llm_tweaked' as const,
  generated_at: '2026-10-20T00:00:00.000Z',
};

async function sentBody(
  state: ReturnType<typeof initIntentState>,
): Promise<Record<string, unknown>> {
  const fetchMock = vi.fn(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve(RESPONSE) }),
  );
  vi.stubGlobal('fetch', fetchMock);
  await fetchDirectives(CONFIG, SESSION, 'listing_detail', state);
  const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
  return JSON.parse(init.body as string) as Record<string, unknown>;
}

beforeEach(() => {
  setEventQueueRef([] as CollectedEvent[]);
  resetAdaptState();
  sessionStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('ESC-087 — sent similarity is capped at the playbook threshold', () => {
  it('a confirmed 0.90 leaf sends similarity 0.85 and confidence 0.90; state keeps 0.90', async () => {
    const state = applyQuizLeaf(initIntentState(), 'first_time_buyer', 'confirmed');
    expect(state.probabilities.first_time_buyer).toBeCloseTo(0.9, 6);
    const body = await sentBody(state);
    expect(body.similarity).toBe(0.85);
    expect(body.confidence).toBeCloseTo(0.9, 6);
    expect(state.probabilities.first_time_buyer).toBeCloseTo(0.9, 6);
  });

  it('a completed 0.72 leaf is sent unchanged', async () => {
    const body = await sentBody(applyQuizLeaf(initIntentState(), 'first_time_buyer', 'completed'));
    expect(body.similarity).toBeCloseTo(0.72, 6);
  });
});
