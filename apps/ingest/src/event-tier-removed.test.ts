/**
 * FOLLOW-1293 / ESC-081: the `tier` field is gone from the public event contract.
 *
 * The ingest handler (`handlers/events.ts`) validates each event with `EventSchema.safeParse` and
 * persists `parsed.data` only. The envelope is a non-strict zod object, so a stray `tier` key from
 * an old snippet or client is STRIPPED (event accepted, key never reaches ClickHouse) rather than
 * rejecting the event. This pins that behaviour at the exact call the handler makes.
 */

import { describe, expect, it } from 'vitest';
import { EventSchema } from '@estalara/shared';

const base = {
  event_id: '01928f00-7000-7000-8000-123456789abc',
  tenant_id: '01928f00-7000-7000-8000-aaaaaaaaaaaa',
  session_id: 'a'.repeat(40),
  ts: 1714180000000,
  region: 'eu' as const,
  consent_state: 'legitimate-interest' as const,
  schema_version: 1 as const,
  type: 'page.view' as const,
  payload: {
    url: 'https://example.com/listing/1',
    viewport: { width: 1440, height: 900 },
    device_class: 'desktop',
  },
};

describe('stray `tier` on an ingest event (FOLLOW-1293)', () => {
  it('is stripped from the validated event; the event itself is accepted', () => {
    const parsed = EventSchema.safeParse({ ...base, tier: 'observer' });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data).not.toHaveProperty('tier');
  });
});
