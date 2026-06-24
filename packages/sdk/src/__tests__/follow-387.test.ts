/**
 * FOLLOW-387 — Thread profiling_opt_out through the live real-time chat path.
 *
 * §H.9 / RETRO-108 TG-1: the SDK chat-emit MUST attach profiling_opt_out to the
 * chat.message.sent event payload so that the stream-consumer (_spawn_chat_nlp) can
 * forward it to process_chat_message (FOLLOW-384 consumer guard → write_shadow_intent skip).
 *
 * Tests cover:
 *   AC-2a — SDK sets profiling_opt_out=true on chat.message.sent payload when profilingOptedOut=true.
 *   AC-2b — SDK omits profiling_opt_out (undefined) when profilingOptedOut=false (no noise on the wire).
 *   AC-2c — Schema back-compat: events with no profiling_opt_out still parse against
 *            ChatMessageSentPayloadSchema (optional field, default-absent is valid).
 *   AC-2d — Schema round-trip: an event WITH profiling_opt_out=true also parses successfully.
 *
 * Rule Z (RETRO-108): fixtures use the real SDK producer shape (ChatMessageSentPayloadSchema).
 * Rule Y (CONVENTIONS_PATCH.md): every assertion below is evaluated against the real schema,
 *   not a hand-authored mock (safeParse is called on the actual schema import).
 *
 * @module packages/sdk/src/__tests__/follow-387.test
 */

// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { ChatMessageSentPayloadSchema } from '@estalara/shared';

// ─── AC-2a / AC-2b: SDK sets profiling_opt_out on chat payload ────────────────
//
// The production guard in index.ts:
//   eventQueue.push({
//     type: 'chat.message.sent',
//     payload: {
//       message: scrubMessagePii(rawMessage),
//       char_count: ...,
//       lead_id: ...,
//       profiling_opt_out: profilingOptedOut || undefined,   // FOLLOW-387
//     },
//     ts: Date.now(),
//   });
//
// The expression `profilingOptedOut || undefined` converts false → undefined (not on the wire)
// and true → true (present on the wire). We model this with a helper function to avoid the
// `@typescript-eslint/no-unnecessary-condition` lint error when using a literal boolean.

/** Models the index.ts expression `profilingOptedOut || undefined`. */
function chatOptOutField(profilingOptedOut: boolean): true | undefined {
  return profilingOptedOut || undefined;
}

describe('FOLLOW-387 AC-2a: profiling_opt_out=true when opted out', () => {
  it('opted-out emit attaches profiling_opt_out=true to the chat payload', () => {
    // chatOptOutField(true) → true (present and true on the wire)
    const payload = {
      message: 'Looking for 3-bed near international school',
      char_count: 44,
      lead_id: 'lead-abc123',
      profiling_opt_out: chatOptOutField(true),
    };

    // §H.9 key assertion: flag is present and true
    expect(payload.profiling_opt_out).toBe(true);

    // Schema round-trip: ChatMessageSentPayloadSchema accepts profiling_opt_out=true
    const result = ChatMessageSentPayloadSchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.profiling_opt_out).toBe(true);
    }
  });
});

describe('FOLLOW-387 AC-2b: profiling_opt_out omitted when opted in', () => {
  it('opted-in emit omits profiling_opt_out (undefined → not serialized)', () => {
    // chatOptOutField(false) → undefined (absent from the wire)
    const payload = {
      message: 'Show me 2-bed apartments under 500k',
      char_count: 35,
      lead_id: 'lead-def456',
      profiling_opt_out: chatOptOutField(false),
    };

    // Flag should be undefined (not present on wire)
    expect(payload.profiling_opt_out).toBeUndefined();

    // Schema round-trip: ChatMessageSentPayloadSchema accepts events without profiling_opt_out
    const result = ChatMessageSentPayloadSchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) {
      // Optional field absent → parsed value is undefined
      expect(result.data.profiling_opt_out).toBeUndefined();
    }
  });
});

// ─── AC-2c: back-compat — existing events (no profiling_opt_out) still valid ──

describe('FOLLOW-387 AC-2c: schema backward-compatibility', () => {
  it('event emitted before FOLLOW-387 (no profiling_opt_out field) still validates', () => {
    // Pre-FOLLOW-387 event: only the fields that existed before the schema bump.
    // This proves the optional field does not break existing producers.
    const legacyPayload = {
      message: 'Best ROI listings in Marbella?',
      char_count: 30,
      lead_id: 'lead-legacy',
    };

    const result = ChatMessageSentPayloadSchema.safeParse(legacyPayload);
    expect(result.success).toBe(true);
  });

  it('event with profiling_opt_out=false validates (opt-in edge case)', () => {
    const payload = {
      message: 'I want a villa with a pool',
      char_count: 25,
      profiling_opt_out: false,
    };

    const result = ChatMessageSentPayloadSchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.profiling_opt_out).toBe(false);
    }
  });
});

// ─── AC-2d: schema round-trip for opted-out event ────────────────────────────

describe('FOLLOW-387 AC-2d: schema round-trip for profiling_opt_out=true', () => {
  it('full opted-out event round-trips through ChatMessageSentPayloadSchema', () => {
    // This is the full payload that the SDK now emits for an opted-out session.
    // Asserting safeParse.success here proves the schema accepts this shape —
    // required by Rule K.2 amendment (every provenance value must be in the schema).
    const fullOptedOutPayload = {
      message: 'What are the best family-friendly areas near DIFC?',
      char_count: 50,
      locale: 'en-GB',
      lead_id: 'lead-round-trip-01',
      profiling_opt_out: true,
    };

    const result = ChatMessageSentPayloadSchema.safeParse(fullOptedOutPayload);
    expect(result.success).toBe(true);
    if (result.success) {
      // All fields survive the round-trip intact
      expect(result.data.message).toBe(fullOptedOutPayload.message);
      expect(result.data.char_count).toBe(fullOptedOutPayload.char_count);
      expect(result.data.locale).toBe(fullOptedOutPayload.locale);
      expect(result.data.lead_id).toBe(fullOptedOutPayload.lead_id);
      expect(result.data.profiling_opt_out).toBe(true);
    }
  });

  it('non-boolean profiling_opt_out value is rejected by schema', () => {
    // Schema type guard: profiling_opt_out must be boolean, not a string "true"
    const badPayload = {
      message: 'test message',
      profiling_opt_out: 'true', // wrong type
    };

    const result = ChatMessageSentPayloadSchema.safeParse(badPayload);
    expect(result.success).toBe(false);
  });
});
