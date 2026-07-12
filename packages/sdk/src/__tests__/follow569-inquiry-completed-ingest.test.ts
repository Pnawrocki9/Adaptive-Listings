// @vitest-environment jsdom
/**
 * F-01 (audit 2026-07-12) / FOLLOW-569 — inquiry.completed ingest listener.
 *
 * Before this fix, inquiry.completed reached ONLY the bandit feedback ping
 * (registerFeedbackListener in adapt.ts) and was never queued for ingest, so the
 * cta-lift conversion-analytics leg that JOINs on inquiry.completed was permanently
 * empty for holdout AND variant sessions. index.ts now registers a dedicated ingest
 * listener (mirroring the live.signup one) that queues inquiry.completed for every
 * session, with a payload limited to InquiryCompletedPayloadSchema (no PII).
 *
 * Following the FOLLOW-197 convention, the listener body is simulated here byte-for-byte
 * so the mapping logic is unit-tested without mounting the full init() path. Any change
 * to the inquiry.completed listener in index.ts MUST be reflected here (Rule H / Rule J).
 */

import { beforeEach, describe, expect, it } from 'vitest';

import type { CollectedEvent } from '../core/events.js';

/**
 * Mirror of the inquiry.completed ingest listener handler from index.ts. Keep in sync.
 */
function simulateInquiryCompletedListener(
  detail: Record<string, unknown> | null,
  queue: CollectedEvent[],
): void {
  if (detail?.is_agent === true) return;

  const payload: Record<string, unknown> = {};
  if (typeof detail?.has_phone === 'boolean') payload.has_phone = detail.has_phone;
  if (
    typeof detail?.message_length === 'number' &&
    Number.isInteger(detail.message_length) &&
    detail.message_length >= 0
  ) {
    payload.message_length = detail.message_length;
  }
  if (
    typeof detail?.channel === 'string' &&
    ['email', 'phone', 'whatsapp', 'sms', 'in_person'].includes(detail.channel)
  ) {
    payload.channel = detail.channel;
  }
  if (
    typeof detail?.timeline === 'string' &&
    ['0-3m', '3-6m', '6-12m', '12m+'].includes(detail.timeline)
  ) {
    payload.timeline = detail.timeline;
  }
  if (typeof detail?.budget_hint === 'string') payload.budget_hint = detail.budget_hint;

  queue.push({ type: 'inquiry.completed', payload, ts: Date.now() });
}

describe('inquiry.completed ingest listener (F-01 / FOLLOW-569)', () => {
  let queue: CollectedEvent[];

  beforeEach(() => {
    queue = [];
  });

  it('queues an inquiry.completed ingest event with a schema-valid mapped payload', () => {
    simulateInquiryCompletedListener(
      {
        channel: 'email',
        has_phone: true,
        timeline: '0-3m',
        message_length: 42,
        budget_hint: '300k-500k',
      },
      queue,
    );
    expect(queue).toHaveLength(1);
    const ev = queue[0]!;
    expect(ev.type).toBe('inquiry.completed');
    expect(ev.payload).toEqual({
      channel: 'email',
      has_phone: true,
      timeline: '0-3m',
      message_length: 42,
      budget_hint: '300k-500k',
    });
    expect(typeof ev.ts).toBe('number');
  });

  it('queues an event even with an empty/undefined detail (envelope carries session attribution)', () => {
    simulateInquiryCompletedListener(null, queue);
    expect(queue).toHaveLength(1);
    expect(queue[0]!.type).toBe('inquiry.completed');
    expect(queue[0]!.payload).toEqual({});
  });

  it('drops agent-side signals (is_agent=true) — no ingest event', () => {
    simulateInquiryCompletedListener({ is_agent: true, channel: 'email' }, queue);
    expect(queue).toHaveLength(0);
  });

  it('filters out schema-invalid fields (bad channel/timeline, negative/non-int length, wrong types)', () => {
    simulateInquiryCompletedListener(
      {
        channel: 'carrier-pigeon', // not in enum → dropped
        timeline: 'someday', // not in enum → dropped
        message_length: -3, // negative → dropped
        has_phone: 'yes', // wrong type → dropped
        budget_hint: 500, // wrong type → dropped
      },
      queue,
    );
    expect(queue).toHaveLength(1);
    expect(queue[0]!.payload).toEqual({});
  });

  it('keeps only the valid subset when detail is mixed', () => {
    simulateInquiryCompletedListener(
      { channel: 'whatsapp', message_length: 3.5, has_phone: false },
      queue,
    );
    expect(queue).toHaveLength(1);
    // 3.5 is non-integer → dropped; channel + has_phone kept
    expect(queue[0]!.payload).toEqual({ channel: 'whatsapp', has_phone: false });
  });
});
