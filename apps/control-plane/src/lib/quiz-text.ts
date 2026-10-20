/**
 * Turn stored quiz answer indexes into text for the staff surfaces (FOLLOW-1362 C4): the
 * completions viewer (question prompt + answer label per step, resolved archetype label) and the
 * quiz analytics tab (branch labels, per-question drop-off).
 *
 * An answer index is only meaningful against the definition that was served, so every function
 * takes the definition explicitly. The loaders pick it: the version a `quiz_runs` row pinned
 * (exact), else the tenant's active definition, else the built-in v2 default (approximate).
 *
 * @module apps/control-plane/src/lib/quiz-text
 */

import { and, eq, inArray } from 'drizzle-orm';

import { quizDefinitions, type Database } from '@estalara/db';
import type { QuizDefinition } from '@estalara/shared';
import { DEFAULT_QUIZ_DEFINITION_V2, nextStep, resolveLabel } from '@estalara/shared';
import type { QuizPathStep } from '@estalara/shared';
import { summarizeStoredDefinition } from '@/lib/quiz-definition-admin';

/** EN text plus the PL text when the definition carries one. */
export interface TextBag {
  en: string;
  pl: string | null;
}

/** One answer the buyer picked on a step. */
interface PathAnswerText {
  index: number;
  /** `null` when the index no longer exists in the definition used to resolve it. */
  label: TextBag | null;
}

/** One step of a stored answer path, as text. */
export interface PathStepText {
  question_id: string;
  /** `null` when the question is not in the definition used to resolve it. */
  prompt: TextBag | null;
  /** One entry for a single question, every chosen trait for a multi step. */
  answers: PathAnswerText[];
}

type LabelBag = Partial<Record<'en' | 'pl' | 'es', string>>;

/** `{en, pl}` for a label bag (EN falls back like the widget does). */
function textBag(bag: LabelBag): TextBag {
  return { en: resolveLabel(bag, 'en'), pl: bag.pl ?? null };
}

/** A stored `answer_path` entry, validated defensively (it is jsonb written by the SDK). */
interface StoredStep {
  question_id: string;
  indexes: number[];
  multi: boolean;
}

function parseStoredPath(raw: unknown): StoredStep[] | null {
  if (!Array.isArray(raw)) return null;
  const out: StoredStep[] = [];
  for (const entry of raw as unknown[]) {
    if (entry === null || typeof entry !== 'object') return null;
    const e = entry as { question_id?: unknown; answer_index?: unknown; answer_indexes?: unknown };
    if (typeof e.question_id !== 'string') return null;
    if (Array.isArray(e.answer_indexes)) {
      out.push({
        question_id: e.question_id,
        indexes: (e.answer_indexes as unknown[]).filter((i): i is number => Number.isInteger(i)),
        multi: true,
      });
    } else if (typeof e.answer_index === 'number' && Number.isInteger(e.answer_index)) {
      out.push({ question_id: e.question_id, indexes: [e.answer_index], multi: false });
    } else {
      return null;
    }
  }
  return out;
}

/**
 * Describe a stored `answer_path` against `def`. `null` when the row never reported a path
 * (legacy) or the value is not a path at all.
 */
export function describePath(def: QuizDefinition, raw: unknown): PathStepText[] | null {
  const steps = parseStoredPath(raw);
  if (steps === null) return null;
  const byId = new Map(def.questions.map((q) => [q.id, q]));
  return steps.map((s) => {
    const q = byId.get(s.question_id);
    return {
      question_id: s.question_id,
      prompt: q ? textBag(q.prompt_i18n) : null,
      answers: s.indexes.map((index) => {
        const a = q?.answers[index];
        return { index, label: a ? textBag(a.label_i18n) : null };
      }),
    };
  });
}

/** The display name of an archetype in the definition's confirmation block, if it has one. */
export function archetypeLabel(def: QuizDefinition, archetype: string): TextBag | null {
  const bag = def.confirm?.names_i18n[archetype];
  return bag ? textBag(bag) : null;
}

/**
 * Label of each branch id: a branch is the question a ROOT answer leads to, so its label is that
 * answer's label (several root answers into the same question are joined with " / ").
 */
export function branchLabels(def: QuizDefinition): Record<string, TextBag> {
  const root = def.questions.find((q) => q.id === def.root);
  const grouped = new Map<string, TextBag[]>();
  for (const a of root?.answers ?? []) {
    if (a.next === null) continue;
    grouped.set(a.next, [...(grouped.get(a.next) ?? []), textBag(a.label_i18n)]);
  }
  const out: Record<string, TextBag> = {};
  for (const [qid, bags] of grouped) {
    out[qid] = {
      en: bags.map((b) => b.en).join(' / '),
      pl: bags.every((b) => b.pl !== null) ? bags.map((b) => b.pl).join(' / ') : null,
    };
  }
  return out;
}

/**
 * The question a buyer was looking at when a run was dismissed: replay the recorded path through
 * `nextStep`; with no recorded path, step 0 is the root question. `null` when it cannot be told.
 */
export function pendingQuestion(
  def: QuizDefinition,
  rawPath: unknown,
  lastStep: number | null,
): { id: string; prompt: TextBag } | null {
  const steps = parseStoredPath(rawPath);
  let questionId: string | null = null;
  if (steps !== null && steps.length > 0) {
    const path: QuizPathStep[] = steps.map((s) => (s.multi ? s.indexes : (s.indexes[0] ?? 0)));
    const next = nextStep(def, { path });
    if (next.kind === 'question') questionId = next.questionId;
  } else if ((steps === null || steps.length === 0) && (lastStep ?? 0) === 0) {
    questionId = def.root;
  }
  const q = questionId === null ? undefined : def.questions.find((x) => x.id === questionId);
  return q ? { id: q.id, prompt: textBag(q.prompt_i18n) } : null;
}

/** A definition and where it came from. */
interface LoadedDefinition {
  /** Stored version, or `null` for the built-in default. */
  version: number | null;
  definition: QuizDefinition;
}

/** The tenant's active definition (serve-schema valid), or the built-in v2 default. */
export async function loadActiveDefinition(
  db: Pick<Database, 'select'>,
  tenantId: string,
): Promise<LoadedDefinition> {
  const rows = await db
    .select({ version: quizDefinitions.version, definition: quizDefinitions.definition })
    .from(quizDefinitions)
    // invariant 5: the explicit tenant fence on the service-role client.
    .where(and(eq(quizDefinitions.tenantId, tenantId), eq(quizDefinitions.isActive, true)))
    .limit(1);
  const row = rows[0];
  if (row) {
    const parsed = (await summarizeStoredDefinition(row.definition)).definition;
    if (parsed) return { version: row.version, definition: parsed };
  }
  return { version: null, definition: DEFAULT_QUIZ_DEFINITION_V2 };
}

/** The stored definitions of the given versions (invalid or missing versions are absent). */
export async function loadDefinitionVersions(
  db: Pick<Database, 'select'>,
  tenantId: string,
  versions: readonly number[],
): Promise<Map<number, QuizDefinition>> {
  const out = new Map<number, QuizDefinition>();
  if (versions.length === 0) return out;
  const rows = await db
    .select({ version: quizDefinitions.version, definition: quizDefinitions.definition })
    .from(quizDefinitions)
    // invariant 5: the explicit tenant fence on the service-role client.
    .where(
      and(eq(quizDefinitions.tenantId, tenantId), inArray(quizDefinitions.version, [...versions])),
    );
  for (const row of rows) {
    const parsed = (await summarizeStoredDefinition(row.definition)).definition;
    if (parsed) out.set(row.version, parsed);
  }
  return out;
}
