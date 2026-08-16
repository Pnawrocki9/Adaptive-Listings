/**
 * FOLLOW-1002 — tests for POST /api/admin/tenants/quiz-definition/suggest-weights
 * (LLM-assisted answer→archetype weight suggestions, advisory-only).
 *
 * `@anthropic-ai/sdk` is mocked at the module boundary; the tests drive the
 * route's REAL prompt build, reply parsing and post-validation. Auth is a
 * `resolveTenantAccess` spy like every staff-route sibling.
 *
 * Coverage:
 *   - ops staff → 200 with validated suggestions; hallucinated pairs and
 *     non-canonical/neutral weight keys land in `rejected[]`, never in output;
 *     weights are clamped to [0, 1].
 *   - Markdown-fenced reply is tolerated; garbage reply → 502 (K.2 fail-loud).
 *   - Anthropic API throw → 502; missing ANTHROPIC_API_KEY → 503.
 *   - Agency → 403 staff_only; readonly staff → 403 (write-rank gate).
 *   - Invalid body / invalid definition → 400.
 *   - ARCHETYPE_DESCRIPTORS covers EXACTLY CANONICAL_ARCHETYPE_IDS (drift guard).
 *
 * @module apps/control-plane/src/app/api/admin/tenants/quiz-definition/suggest-weights/route.test
 */

import { NextRequest } from 'next/server';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type * as SessionAuthModule from '@/lib/session-auth';
import { CANONICAL_ARCHETYPE_IDS } from '@estalara/shared';
import type { SuggestWeightsResponse } from './route';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockCreate = vi.fn();
vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = { create: mockCreate };
  },
}));

vi.mock('@/lib/global-config-store', () => ({
  getGlobalGenerationModel: vi.fn().mockResolvedValue('claude-sonnet-4-6'),
}));

vi.mock('@/lib/session-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof SessionAuthModule>();
  return { ...actual, resolveTenantAccess: vi.fn() };
});

vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }));

import { resolveTenantAccess, type TenantAccess } from '@/lib/session-auth';
import { ARCHETYPE_DESCRIPTORS, POST } from './route';

const mockResolve = vi.mocked(resolveTenantAccess);

const TENANT_A = '550e8400-e29b-41d4-a716-446655440042';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function staffAccess(
  tenantId: string,
  role: 'estalara:superadmin' | 'estalara:ops' | 'estalara:readonly' = 'estalara:ops',
): TenantAccess {
  const rank = { 'estalara:superadmin': 3, 'estalara:ops': 2, 'estalara:readonly': 1 }[role];
  return {
    via: 'staff',
    tenantId,
    staff: {
      sub: 'staff-uuid-777',
      email: 'staff@estalara.com',
      tenant_id: null,
      estalara_staff: true,
      estalara_role: role,
      mfa_verified: true,
    },
    role,
    canWrite: rank >= 2,
    isSuperadmin: rank >= 3,
  };
}

function agencyAccess(tenantId: string): TenantAccess {
  return {
    via: 'agency',
    tenantId,
    claims: {
      sub: 'user-uuid',
      email: 'user@agency.com',
      tenant_id: tenantId,
      agency_role: 'agency:admin',
      estalara_staff: false,
      mfa_verified: true,
    },
    rawToken: 'agency-jwt',
  };
}

const DEFINITION = {
  schema_version: 1,
  root: 'q_gate',
  languages: ['en'],
  questions: [
    {
      id: 'q_gate',
      prompt_i18n: { en: 'What are you looking for?' },
      answers: [
        { id: 'a_invest', label_i18n: { en: 'Investment property' }, weights: {}, next: 'q_focus' },
        { id: 'a_skip', label_i18n: { en: 'Just browsing' }, weights: {}, next: null },
      ],
    },
    {
      id: 'q_focus',
      prompt_i18n: { en: 'What is your focus?' },
      answers: [
        { id: 'a_yield', label_i18n: { en: 'Rental income' }, weights: {}, next: null },
        { id: 'a_flip', label_i18n: { en: 'Flip / renovation' }, weights: {}, next: null },
      ],
    },
  ],
};

function llmReply(payload: unknown): { content: { type: string; text: string }[] } {
  return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
}

function makeRequest(body: unknown, query: Record<string, string> = {}): NextRequest {
  const url = new URL('http://localhost/api/admin/tenants/quiz-definition/suggest-weights');
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return new NextRequest(url.toString(), {
    method: 'POST',
    headers: { Authorization: 'Bearer mock-token', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ANTHROPIC_API_KEY = 'test-key';
});

afterEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
});

// ═══════════════════════════════════════════════════════════════════════════

describe('POST /api/admin/tenants/quiz-definition/suggest-weights', () => {
  it('ops staff → 200 with validated suggestions; hallucinations and bad keys are rejected visibly', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A));
    mockCreate.mockResolvedValue(
      llmReply({
        suggestions: [
          {
            question_id: 'q_focus',
            answer_id: 'a_yield',
            // 1.5 must clamp to 1; 'neutral' and a hallucinated id must be dropped.
            weights: { yield_hunter: 1.5, neutral: 0.4, made_up_archetype: 0.9 },
            rationale: 'Rental income is the defining yield_hunter signal.',
          },
          {
            question_id: 'q_focus',
            answer_id: 'no_such_answer',
            weights: { flip_investor: 0.9 },
            rationale: 'hallucinated pair',
          },
          {
            question_id: 'q_gate',
            answer_id: 'a_skip',
            weights: {},
            rationale: 'Pure gate answer — no signal.',
          },
        ],
      }),
    );

    const res = await POST(makeRequest({ definition: DEFINITION }, { tenant_id: TENANT_A }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as SuggestWeightsResponse;

    expect(body.tenant_id).toBe(TENANT_A);
    expect(body.model).toBe('claude-sonnet-4-6');
    // The valid pair survives with ONLY the canonical key, clamped.
    const yieldSuggestion = body.suggestions.find((s) => s.answer_id === 'a_yield');
    expect(yieldSuggestion?.weights).toEqual({ yield_hunter: 1 });
    // The empty-weights gate suggestion survives as-is.
    expect(body.suggestions.find((s) => s.answer_id === 'a_skip')?.weights).toEqual({});
    // The hallucinated pair is NOT in suggestions and IS in rejected.
    expect(body.suggestions.some((s) => s.answer_id === 'no_such_answer')).toBe(false);
    expect(body.rejected.some((r) => r.answer_id === 'no_such_answer')).toBe(true);
    // The dropped keys are reported, not silently swallowed.
    expect(
      body.rejected.some((r) => r.answer_id === 'a_yield' && r.reason.includes('neutral')),
    ).toBe(true);
  });

  it('sends the tree and taxonomy to the model (prompt carries prompts, labels and archetype ids)', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A));
    mockCreate.mockResolvedValue(llmReply({ suggestions: [] }));

    await POST(makeRequest({ definition: DEFINITION }, { tenant_id: TENANT_A }));
    const call = mockCreate.mock.calls[0]?.[0] as { messages: { content: string }[] };
    const prompt = call.messages[0]!.content;
    expect(prompt).toContain('What are you looking for?');
    expect(prompt).toContain('Rental income');
    expect(prompt).toContain('yield_hunter');
    // The fallback id is never offered as a weight key.
    expect(prompt).not.toMatch(/^- neutral:/m);
  });

  it('tolerates a markdown-fenced JSON reply', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A));
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: '```json\n{"suggestions":[]}\n```' }],
    });
    const res = await POST(makeRequest({ definition: DEFINITION }, { tenant_id: TENANT_A }));
    expect(res.status).toBe(200);
  });

  it('garbage reply → 502 llm_unavailable (K.2 — never an empty list posing as "no ideas")', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A));
    mockCreate.mockResolvedValue({ content: [{ type: 'text', text: 'sorry, as an AI...' }] });
    const res = await POST(makeRequest({ definition: DEFINITION }, { tenant_id: TENANT_A }));
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('llm_unavailable');
  });

  it('Anthropic API throw → 502 llm_unavailable', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A));
    mockCreate.mockRejectedValue(new Error('overloaded'));
    const res = await POST(makeRequest({ definition: DEFINITION }, { tenant_id: TENANT_A }));
    expect(res.status).toBe(502);
  });

  it('missing ANTHROPIC_API_KEY → 503 llm_unconfigured', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A));
    delete process.env.ANTHROPIC_API_KEY;
    const res = await POST(makeRequest({ definition: DEFINITION }, { tenant_id: TENANT_A }));
    expect(res.status).toBe(503);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('agency → 403 staff_only; readonly staff → 403; neither reaches the model', async () => {
    mockResolve.mockResolvedValue(agencyAccess(TENANT_A));
    const res1 = await POST(makeRequest({ definition: DEFINITION }, { tenant_id: TENANT_A }));
    expect(res1.status).toBe(403);

    mockResolve.mockResolvedValue(staffAccess(TENANT_A, 'estalara:readonly'));
    const res2 = await POST(makeRequest({ definition: DEFINITION }, { tenant_id: TENANT_A }));
    expect(res2.status).toBe(403);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('invalid definition (unknown archetype in weights) → 400 before any model call', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A));
    const bad = structuredClone(DEFINITION);
    bad.questions[1]!.answers[0]!.weights = { bogus_archetype: 1 };
    const res = await POST(makeRequest({ definition: bad }, { tenant_id: TENANT_A }));
    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('ARCHETYPE_DESCRIPTORS covers exactly CANONICAL_ARCHETYPE_IDS (drift guard)', () => {
    expect(Object.keys(ARCHETYPE_DESCRIPTORS).sort()).toEqual([...CANONICAL_ARCHETYPE_IDS].sort());
  });
});
