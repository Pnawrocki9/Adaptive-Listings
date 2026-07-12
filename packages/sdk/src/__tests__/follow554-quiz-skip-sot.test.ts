// @vitest-environment jsdom
/**
 * FOLLOW-554 (audit A3-F-03) — a quiz SKIP must not wipe the SoT archetype to `neutral`.
 *
 * The quiz onComplete callback in index.ts previously called persistResolvedArchetype()
 * unconditionally. Quiz Q1 option D resolves to `neutral` (a skip), so a buyer with an
 * established non-neutral SoT who opened the quiz and skipped had their source-of-truth
 * archetype wiped to `neutral` — violating the ADR-0014 invariant "never to neutral"
 * (session.ts). The fix gates the persist on `resolvedArchetype !== 'neutral'`.
 *
 * Per the FOLLOW-197 / FOLLOW-569 convention, the guard is mirrored here byte-for-byte and
 * exercised against the REAL persistResolvedArchetype / readResolvedArchetype storage layer.
 * Any change to the quiz-leaf seed guard in index.ts MUST be reflected here (Rule H / Rule J).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { persistResolvedArchetype, readResolvedArchetype } from '../core/session.js';

const SESSION_ID = 'FOLLOW554_SESSION';

/**
 * Mirror of the FOLLOW-554 quiz-leaf seed guard from index.ts's quiz onComplete callback.
 * Keep in sync: only a non-neutral quiz leaf seeds the SoT; a skip (neutral) is a no-op.
 */
function seedSotFromQuizLeaf(
  sessionId: string,
  resolvedArchetype: string,
  confidence: number,
): void {
  if (resolvedArchetype !== 'neutral') {
    persistResolvedArchetype(sessionId, resolvedArchetype, confidence);
  }
}

describe('FOLLOW-554 — quiz skip must not persist neutral into the SoT', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });
  afterEach(() => {
    sessionStorage.clear();
  });

  it('an established non-neutral SoT survives a quiz skip (Q1-D → neutral)', () => {
    // Buyer already resolved to family_buyer earlier in the session.
    persistResolvedArchetype(SESSION_ID, 'family_buyer', 0.85);
    expect(readResolvedArchetype(SESSION_ID)?.archetype).toBe('family_buyer');

    // They open the quiz and skip → resolvedArchetype === 'neutral'.
    seedSotFromQuizLeaf(SESSION_ID, 'neutral', 0.2);

    // SoT must be untouched (ADR-0014 invariant "never to neutral").
    expect(readResolvedArchetype(SESSION_ID)?.archetype).toBe('family_buyer');
    expect(readResolvedArchetype(SESSION_ID)?.confidence).toBe(0.85);
  });

  it('a non-neutral quiz leaf still overwrites the SoT exactly as before', () => {
    persistResolvedArchetype(SESSION_ID, 'family_buyer', 0.85);

    // Quiz resolves a different non-neutral archetype → SoT updates.
    seedSotFromQuizLeaf(SESSION_ID, 'yield_hunter', 0.92);

    expect(readResolvedArchetype(SESSION_ID)?.archetype).toBe('yield_hunter');
    expect(readResolvedArchetype(SESSION_ID)?.confidence).toBe(0.92);
  });

  it('a quiz skip with no prior SoT writes nothing (stays null, not neutral)', () => {
    expect(readResolvedArchetype(SESSION_ID)).toBeNull();

    seedSotFromQuizLeaf(SESSION_ID, 'neutral', 0.2);

    // No SoT key created — refreshDirectives has nothing to restore, which is correct:
    // a skip must never seed neutral.
    expect(readResolvedArchetype(SESSION_ID)).toBeNull();
  });
});
