/**
 * Unit tests for AbAssignmentEventSchema.
 *
 * Verifies that the schema accepts valid ab.assignment events and rejects invalid ones.
 * TICKET-AB-001 AC-4 (event payload fields).
 *
 * @module @estalara/shared/schemas/events/__tests__/ab-assignment.test
 */

import { describe, expect, it } from 'vitest';

import { AbAssignmentEventSchema, AbAssignmentPayloadSchema } from '../ab-assignment.js';
import { EventSchema } from '../index.js';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const VALID_ENVELOPE = {
  event_id: '550e8400-e29b-41d4-a716-446655440001',
  tenant_id: '550e8400-e29b-41d4-a716-446655440000',
  session_id: 'a'.repeat(64),
  ts: 1714180000000,
  region: 'eu' as const,
  consent_state: 'consented' as const,
  schema_version: 1 as const,
};

const VALID_PAYLOAD = {
  session_id: 'a'.repeat(64),
  tenant_id: '550e8400-e29b-41d4-a716-446655440000',
  holdout_group: false,
  holdout_pct: 0.1,
  assigned_at: '2026-05-13T12:00:00.000Z',
};

const VALID_EVENT = {
  ...VALID_ENVELOPE,
  type: 'ab.assignment' as const,
  payload: VALID_PAYLOAD,
};

// ─── AbAssignmentPayloadSchema ────────────────────────────────────────────────

describe('AbAssignmentPayloadSchema', () => {
  it('accepts a valid payload', () => {
    const result = AbAssignmentPayloadSchema.safeParse(VALID_PAYLOAD);
    expect(result.success).toBe(true);
  });

  it('accepts holdout_group=true', () => {
    const result = AbAssignmentPayloadSchema.safeParse({ ...VALID_PAYLOAD, holdout_group: true });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.holdout_group).toBe(true);
  });

  it('rejects non-boolean holdout_group', () => {
    const result = AbAssignmentPayloadSchema.safeParse({
      ...VALID_PAYLOAD,
      holdout_group: 'true',
    });
    expect(result.success).toBe(false);
  });

  it('rejects holdout_pct > 1', () => {
    const result = AbAssignmentPayloadSchema.safeParse({ ...VALID_PAYLOAD, holdout_pct: 1.1 });
    expect(result.success).toBe(false);
  });

  it('rejects holdout_pct < 0', () => {
    const result = AbAssignmentPayloadSchema.safeParse({ ...VALID_PAYLOAD, holdout_pct: -0.1 });
    expect(result.success).toBe(false);
  });

  it('accepts holdout_pct=0 and holdout_pct=1 (boundary values)', () => {
    expect(AbAssignmentPayloadSchema.safeParse({ ...VALID_PAYLOAD, holdout_pct: 0 }).success).toBe(
      true,
    );
    expect(AbAssignmentPayloadSchema.safeParse({ ...VALID_PAYLOAD, holdout_pct: 1 }).success).toBe(
      true,
    );
  });

  it('rejects invalid assigned_at (not ISO datetime)', () => {
    const result = AbAssignmentPayloadSchema.safeParse({
      ...VALID_PAYLOAD,
      assigned_at: 'not-a-date',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid tenant_id (not UUID)', () => {
    const result = AbAssignmentPayloadSchema.safeParse({
      ...VALID_PAYLOAD,
      tenant_id: 'not-a-uuid',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty session_id', () => {
    const result = AbAssignmentPayloadSchema.safeParse({ ...VALID_PAYLOAD, session_id: '' });
    expect(result.success).toBe(false);
  });

  it('parses correctly — data matches input', () => {
    const result = AbAssignmentPayloadSchema.safeParse(VALID_PAYLOAD);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.holdout_group).toBe(false);
      expect(result.data.holdout_pct).toBe(0.1);
      expect(result.data.assigned_at).toBe('2026-05-13T12:00:00.000Z');
    }
  });
});

// ─── AbAssignmentEventSchema ──────────────────────────────────────────────────

describe('AbAssignmentEventSchema', () => {
  it('accepts a valid ab.assignment event', () => {
    const result = AbAssignmentEventSchema.safeParse(VALID_EVENT);
    expect(result.success).toBe(true);
  });

  it('rejects wrong event type', () => {
    const result = AbAssignmentEventSchema.safeParse({ ...VALID_EVENT, type: 'page.view' });
    expect(result.success).toBe(false);
  });

  it('rejects missing payload fields', () => {
    const result = AbAssignmentEventSchema.safeParse({
      ...VALID_EVENT,
      payload: { holdout_group: true },
    });
    expect(result.success).toBe(false);
  });
});

// ─── EventSchema discriminated union ─────────────────────────────────────────

describe('EventSchema includes ab.assignment', () => {
  it('accepts ab.assignment event in the top-level EventSchema', () => {
    const result = EventSchema.safeParse(VALID_EVENT);
    expect(result.success).toBe(true);
  });

  it('discriminates ab.assignment from page.view', () => {
    const result = EventSchema.safeParse(VALID_EVENT);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe('ab.assignment');
    }
  });
});

// ─── Export verification ──────────────────────────────────────────────────────

describe('exports', () => {
  it('AbAssignmentEventSchema is exported from events/index', async () => {
    const mod = await import('../index.js');
    expect((mod as Record<string, unknown>).AbAssignmentEventSchema).toBeDefined();
  });

  it('AbAssignmentPayloadSchema is exported from events/index', async () => {
    const mod = await import('../index.js');
    expect((mod as Record<string, unknown>).AbAssignmentPayloadSchema).toBeDefined();
  });

  it("'ab.assignment' is in EVENT_TYPES", async () => {
    const { EVENT_TYPES } = await import('../index.js');
    expect(EVENT_TYPES).toContain('ab.assignment');
  });
});
