/**
 * POST /api/admin/tenants/quiz-definition/suggest-weights?tenant_id=<uuid> —
 * LLM-assisted answer→archetype weight suggestions for the staff quiz editor
 * (FOLLOW-1002).
 *
 * THE PROBLEM THIS CLOSES: the quiz tree's semantic link to archetype matching
 * is the per-answer `weights` vector (`QuizAnswerSchema.weights` — the SDK
 * accumulates weights along the answered path and argmaxes via
 * `reduceWeightsToArchetype`). When staff EDITS a question's meaning in the
 * `/admin/tenants/[id]/quiz-definition` editor, nothing re-derives those
 * weights — a reworded question silently keeps mappings authored for the OLD
 * wording, so archetype assignment drifts from what buyers are actually being
 * asked. This route has an LLM read the CURRENT draft (prompts + answer labels
 * + tree structure) against the full 18-archetype taxonomy and propose weights
 * per answer, with a rationale per suggestion.
 *
 * ADVISORY ONLY — THE LLM NEVER WRITES. The response is a proposal the staff
 * editor renders for review; applying it merely merges weights into the client
 * draft, and persistence still goes through the EXISTING audited
 * `PUT /api/admin/tenants/quiz-definition` (validated by `QuizDefinitionSchema`,
 * versioned, `staff_audit_log`ged in one transaction). Human-in-the-loop by
 * construction: every weight that reaches production was accepted and saved by
 * an identified staff user.
 *
 * RUNTIME IS UNCHANGED: buyers still get the deterministic weight-accumulation
 * walk — no LLM call, no latency, no per-session cost. The LLM runs only at
 * authoring time, on an explicit staff click.
 *
 * Output discipline (the part that makes this safe):
 *   - The LLM's reply is parsed against a strict Zod contract; a malformed reply
 *     is a fail-loud 502, never a silent partial apply.
 *   - Every (question_id, answer_id) pair must exist in the SUBMITTED draft and
 *     every weight key must be a member of `CANONICAL_ARCHETYPE_IDS` — anything
 *     else is dropped into `rejected[]` with a reason, visibly, instead of being
 *     trusted. `neutral` is excluded from suggestions by instruction AND by
 *     post-filter (weighting the fallback is never meaningful).
 *   - Weights are clamped to [0, 1].
 *
 * Auth (ADR-0018): staff-only via `resolveTenantAccess` + `allowStaffOverride`
 * (agency 403 `staff_only`), and gated at `estalara:ops` write rank — this is an
 * authoring aid that spends LLM budget, so it takes the same rank as the save it
 * feeds. `?tenant_id` is validated (invariant 4); no DB query is made here (the
 * draft arrives in the request body), so there is no query to fence — the
 * tenant scoping exists to keep the auth shape identical to the sibling
 * quiz-definition routes and to attribute spend.
 *
 * Model: `getGlobalGenerationModel()` — the same admin-configurable generation
 * model the description/adaptation paths use (Sonnet-class default). Cost note:
 * this path is NOT wired into the llm-gateway $100/day breaker — that breaker
 * meters the BUYER-path spend in ClickHouse `llm_calls`; this is a staff-click
 * authoring action with `max_tokens` capped below. If authoring volume ever
 * grows, wire it into the same meter rather than raising this note.
 *
 * @module apps/control-plane/src/app/api/admin/tenants/quiz-definition/suggest-weights/route
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import * as Sentry from '@sentry/nextjs';
import Anthropic from '@anthropic-ai/sdk';

import type { QuizDefinition } from '@estalara/shared';
import { QuizDefinitionSchema } from '@estalara/shared';
import { getGlobalGenerationModel } from '@/lib/global-config-store';
import { resolveTenantAccess, type TenantAccess } from '@/lib/session-auth';
import { accessErrorToResponse } from '@/lib/access-error-response';
import {
  ARCHETYPE_DESCRIPTORS,
  SUGGESTIBLE_ARCHETYPES,
  SUGGESTIBLE_SET,
} from './archetype-descriptors';

// ─── Contracts ────────────────────────────────────────────────────────────────

const PostBodySchema = z.object({
  definition: QuizDefinitionSchema,
});

/** Strict contract for the LLM's reply — anything else is a fail-loud 502. */
const LlmReplySchema = z.object({
  suggestions: z.array(
    z.object({
      question_id: z.string().min(1),
      answer_id: z.string().min(1),
      weights: z.record(z.string(), z.number()),
      rationale: z.string().min(1),
    }),
  ),
});

export interface WeightSuggestion {
  question_id: string;
  answer_id: string;
  /** Proposed archetype→weight vector, canonical keys only, clamped to [0, 1]. */
  weights: Record<string, number>;
  /** The model's one-sentence justification — shown to staff, never persisted. */
  rationale: string;
}

export interface RejectedSuggestion {
  question_id: string;
  answer_id: string;
  reason: string;
}

export interface SuggestWeightsResponse {
  tenant_id: string;
  model: string;
  suggestions: WeightSuggestion[];
  /** What the post-validator refused, stated visibly rather than silently dropped. */
  rejected: RejectedSuggestion[];
}

const MAX_TOKENS = 3000;

// ─── Prompt ───────────────────────────────────────────────────────────────────

function buildPrompt(definition: QuizDefinition): string {
  const taxonomy = SUGGESTIBLE_ARCHETYPES.map(
    (id) => `- ${id}: ${ARCHETYPE_DESCRIPTORS[id] ?? ''}`,
  ).join('\n');

  const tree = definition.questions
    .map((q) => {
      const answers = q.answers
        .map(
          (a) =>
            `  - answer id=${a.id} label=${JSON.stringify(a.label_i18n.en ?? Object.values(a.label_i18n)[0] ?? '')} next=${a.next ?? 'END'}`,
        )
        .join('\n');
      return `question id=${q.id} prompt=${JSON.stringify(q.prompt_i18n.en ?? Object.values(q.prompt_i18n)[0] ?? '')}\n${answers}`;
    })
    .join('\n');

  return [
    'You are calibrating a real-estate buyer-intent quiz. Each quiz answer carries a weight',
    'vector over buyer archetypes; the system sums the weights along the buyer_s answered path',
    'and picks the argmax archetype. Given the quiz tree below, propose the weight vector for',
    'EVERY answer, derived from what selecting that answer semantically reveals about the buyer.',
    '',
    'Archetype taxonomy (the ONLY allowed weight keys):',
    taxonomy,
    '',
    'Rules:',
    '- Weights are numbers in [0, 1]. Use 0.8-1.0 for a decisive signal, 0.3-0.6 for a partial',
    '  signal, and simply OMIT archetypes an answer says nothing about.',
    '- A pure navigation/gate answer (e.g. "Just browsing", "Skip") gets an EMPTY weights object.',
    '- Never use the key "neutral".',
    '- Consider the answer_s position in the tree: a leaf answer usually carries the decisive',
    '  signal; an early gate answer usually carries a broad, lower-weight signal.',
    '- One short rationale sentence per answer.',
    '',
    `Quiz tree (root=${definition.root}):`,
    tree,
    '',
    'Reply with ONLY a JSON object, no markdown fences, exactly this shape:',
    '{"suggestions":[{"question_id":"...","answer_id":"...","weights":{"archetype_id":0.8},"rationale":"..."}]}',
  ].join('\n');
}

// ─── Auth (mirrors the quiz-definition siblings) ──────────────────────────────

async function resolveStaffAccess(
  req: NextRequest,
): Promise<{ access: Extract<TenantAccess, { via: 'staff' }> } | { error: NextResponse }> {
  const tenantIdParam = req.nextUrl.searchParams.get('tenant_id');
  let access: TenantAccess;
  try {
    access = await resolveTenantAccess(req, {
      allowStaffOverride: true,
      minAgencyRole: 'agency:viewer',
      // exactOptionalPropertyTypes (RETRO-189): omit the key when absent.
      ...(tenantIdParam ? { tenantId: tenantIdParam } : {}),
    });
  } catch (err) {
    return { error: accessErrorToResponse(err) };
  }

  if (access.via !== 'staff') {
    return {
      error: NextResponse.json(
        {
          error: {
            code: 'staff_only',
            message: 'Quiz weight suggestions are an Estalara staff authoring aid',
          },
        },
        { status: 403 },
      ),
    };
  }

  return { access };
}

// ─── POST ─────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  const resolved = await resolveStaffAccess(req);
  if ('error' in resolved) return resolved.error;
  const access = resolved.access;
  const tenantId = access.tenantId;

  // Same rank as the save this feeds (ADR-0018 §4): below-ops staff is view-only,
  // and an authoring aid that spends LLM budget is not a view.
  if (!access.canWrite) {
    return NextResponse.json(
      { error: { code: 'forbidden', message: 'Staff write requires estalara:ops or higher' } },
      { status: 403 },
    );
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json(
      { error: { code: 'validation_failed', message: 'Request body must be valid JSON' } },
      { status: 400 },
    );
  }

  const parsed = PostBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: 'validation_failed',
          message: 'Body must be { definition: <valid QuizDefinition> }',
          details: parsed.error.flatten(),
        },
      },
      { status: 400 },
    );
  }
  const definition = parsed.data.definition;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // Honest 503: the feature is unconfigured, which is different from a request error.
    return NextResponse.json(
      { error: { code: 'llm_unconfigured', message: 'ANTHROPIC_API_KEY is not set' } },
      { status: 503 },
    );
  }

  const model = await getGlobalGenerationModel();

  let replyText: string;
  try {
    const anthropic = new Anthropic({ apiKey });
    const response = await anthropic.messages.create({
      model,
      max_tokens: MAX_TOKENS,
      temperature: 0.2,
      messages: [{ role: 'user', content: buildPrompt(definition) }],
    });
    const block = response.content[0];
    replyText = block?.type === 'text' ? block.text : '';
  } catch (err: unknown) {
    // Rule K.2 — fail loud: a configured-but-failing LLM is a real error the staff
    // must see, never an empty suggestions list that reads as "the model had no ideas".
    Sentry.captureException(err instanceof Error ? err : new Error(String(err)), {
      tags: { route: 'admin/tenants/quiz-definition/suggest-weights', op: 'llm_call' },
      extra: { tenant_id: tenantId, model },
    });
    return NextResponse.json(
      { error: { code: 'llm_unavailable', message: 'The suggestion model call failed — retry' } },
      { status: 502 },
    );
  }

  // Parse the reply against the strict contract. Tolerate accidental markdown fences
  // (the single most common wrapper models add), nothing else.
  let replyParsed: z.infer<typeof LlmReplySchema>;
  try {
    const stripped = replyText.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
    replyParsed = LlmReplySchema.parse(JSON.parse(stripped));
  } catch (err: unknown) {
    Sentry.captureException(err instanceof Error ? err : new Error(String(err)), {
      tags: { route: 'admin/tenants/quiz-definition/suggest-weights', op: 'llm_parse' },
      extra: { tenant_id: tenantId, model, reply_length: replyText.length },
    });
    return NextResponse.json(
      {
        error: {
          code: 'llm_unavailable',
          message: 'The suggestion model returned an unparseable reply — retry',
        },
      },
      { status: 502 },
    );
  }

  // ── Post-validation: trust nothing the contract alone cannot prove ──────────
  const validPairs = new Map<string, Set<string>>();
  for (const q of definition.questions) {
    validPairs.set(q.id, new Set(q.answers.map((a) => a.id)));
  }

  const suggestions: WeightSuggestion[] = [];
  const rejected: RejectedSuggestion[] = [];

  for (const s of replyParsed.suggestions) {
    const answerIds = validPairs.get(s.question_id);
    if (!answerIds?.has(s.answer_id)) {
      rejected.push({
        question_id: s.question_id,
        answer_id: s.answer_id,
        reason: 'no such question/answer pair in the submitted draft',
      });
      continue;
    }
    const weights: Record<string, number> = {};
    const droppedKeys: string[] = [];
    for (const [key, value] of Object.entries(s.weights)) {
      if (!SUGGESTIBLE_SET.has(key)) {
        droppedKeys.push(key);
        continue;
      }
      weights[key] = Math.min(1, Math.max(0, value));
    }
    if (droppedKeys.length > 0) {
      rejected.push({
        question_id: s.question_id,
        answer_id: s.answer_id,
        reason: `dropped non-canonical weight key(s): ${droppedKeys.join(', ')}`,
      });
    }
    suggestions.push({
      question_id: s.question_id,
      answer_id: s.answer_id,
      weights,
      rationale: s.rationale,
    });
  }

  const body: SuggestWeightsResponse = { tenant_id: tenantId, model, suggestions, rejected };
  return NextResponse.json(body, { status: 200 });
}
