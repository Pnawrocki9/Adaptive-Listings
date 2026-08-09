/**
 * FOLLOW-931 / RETRO-264 LG-4 — the consent audit events must accept EVERY banner locale.
 *
 * The defect this locks down: `ConsentGrantedPayloadSchema.language` and its denied twin were
 * hand-written as `z.enum(['en', 'pl'])` while the banner shipped `en`, `pl` AND `es`. The SDK
 * sends `config.language` verbatim (`packages/sdk/src/index.ts`), so a Spanish visitor's decision
 * failed `EventSchema.safeParse` at the ingest boundary and was pushed into `rejected[]` —
 * per-event, with a 200 on the batch, so nothing anywhere went red.
 *
 * **The denial leg is the one that matters most.** DPIA §13.1 requires the refusal to reach the
 * audit trail; a dropped `consent.denied` means a visitor who said no leaves no record of having
 * been asked.
 *
 * The cases are GENERATED from `QUIZ_LANGUAGE_VALUES`, never listed by hand — a fourth locale
 * added to the canonical tuple is covered here the moment it lands, which is the only shape of
 * test that could have caught the original bug rather than restating it.
 */
import { describe, it, expect } from 'vitest';

import { QUIZ_LANGUAGE_VALUES } from '../quiz-config.js';
import { ConsentGrantedPayloadSchema, ConsentDeniedPayloadSchema } from './consent.js';

describe('consent audit payloads accept every canonical banner locale', () => {
  for (const language of QUIZ_LANGUAGE_VALUES) {
    it(`consent.granted accepts language '${language}'`, () => {
      const parsed = ConsentGrantedPayloadSchema.safeParse({ language, method: 'banner' });
      expect(
        parsed.success,
        `'${language}' rejected — this visitor's consent is dropped at ingest`,
      ).toBe(true);
    });

    it(`consent.denied accepts language '${language}'`, () => {
      const parsed = ConsentDeniedPayloadSchema.safeParse({ language, method: 'banner' });
      expect(parsed.success, `'${language}' rejected — DPIA §13.1 loses this refusal`).toBe(true);
    });
  }

  it('still rejects a locale outside the canonical tuple', () => {
    expect(
      ConsentGrantedPayloadSchema.safeParse({ language: 'de', method: 'banner' }).success,
    ).toBe(false);
    expect(ConsentDeniedPayloadSchema.safeParse({ language: 'de', method: 'banner' }).success).toBe(
      false,
    );
  });

  it('covers the whole canonical tuple, so this file cannot silently under-test', () => {
    // Guards the generator itself: if QUIZ_LANGUAGE_VALUES were ever emptied or narrowed, the
    // loop above would pass vacuously.
    expect(QUIZ_LANGUAGE_VALUES).toEqual(expect.arrayContaining(['en', 'pl', 'es']));
  });
});
