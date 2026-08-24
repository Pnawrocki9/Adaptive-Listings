/**
 * Tests for the FOLLOW-1118 / ESC-071 consent-log retention contract.
 *
 * The property under test is not "the sentence says 180". It is **one value changes, and both
 * the text and the deletion follow** — the operative half of the CEO ruling. So every rendering
 * assertion is made for TWO different values, never one: a single snapshot would pass just as
 * happily against three hand-typed strings that happen to say 180 today, which is precisely the
 * state this work replaced.
 *
 * The `days: 7` cases are load-bearing for a different reason. They prove the templates
 * reproduce the text compliance signed on 2026-06-12 BYTE-IDENTICALLY at the old period — i.e.
 * that the 2026-08-24 change is the number and nothing but the number.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  CONSENT_DISCLOSURE_LOCALES,
  CONSENT_LOG_EVENT_TYPES,
  CONSENT_LOG_RETENTION_DAYS,
  buildConsentLogRetentionSql,
  renderDisclosure13_1,
} from './consent-retention.js';

/** The sentences compliance signed, at the period they were signed with (ESC-071, pre-ruling). */
const SIGNED_AT_7_DAYS: Record<string, string> = {
  en: 'We record the fact of your consent decision — including a denial — for compliance and debugging purposes. This log is retained for 7 days and is then permanently deleted.',
  pl: 'Rejestrujemy fakt Twojej decyzji dotyczącej zgody — w tym odmowę — w celach zgodności i debugowania. Dziennik ten jest przechowywany przez 7 dni, po czym jest trwale usuwany.',
  es: 'Registramos el hecho de tu decisión de consentimiento — incluida una denegación — con fines de cumplimiento y depuración. Este registro se conserva durante 7 días y luego se elimina de forma permanente.',
};

describe('CONSENT_LOG_RETENTION_DAYS', () => {
  it('is the 180 days ruled in ESC-071', () => {
    expect(CONSENT_LOG_RETENTION_DAYS).toBe(180);
  });

  it('names exactly the two consent-audit event types and nothing else', () => {
    expect([...CONSENT_LOG_EVENT_TYPES]).toEqual(['consent.granted', 'consent.denied']);
  });
});

describe('renderDisclosure13_1 — the text follows the number', () => {
  it.each(CONSENT_DISCLOSURE_LOCALES)(
    'locale %s renders a DIFFERENT sentence for two different values',
    (locale) => {
      const a = renderDisclosure13_1(locale, 180);
      const b = renderDisclosure13_1(locale, 30);
      expect(a).not.toBe(b);
      expect(a).toContain('180');
      expect(b).toContain('30');
      expect(a).not.toContain('30 ');
      // Everything except the period is identical — the template interpolates, it does not
      // switch between hand-written variants.
      expect(a.replace('180', 'N')).toBe(b.replace('30', 'N'));
    },
  );

  it('changing the value changes ALL THREE rendered strings, not just one', () => {
    const at180 = CONSENT_DISCLOSURE_LOCALES.map((l) => renderDisclosure13_1(l, 180));
    const at30 = CONSENT_DISCLOSURE_LOCALES.map((l) => renderDisclosure13_1(l, 30));
    expect(at180).toHaveLength(3);
    for (let i = 0; i < at180.length; i += 1) {
      expect(at180[i]).not.toBe(at30[i]);
    }
  });

  it.each(CONSENT_DISCLOSURE_LOCALES)(
    'locale %s reproduces the compliance-signed sentence byte-identically at days = 7',
    (locale) => {
      expect(renderDisclosure13_1(locale, 7)).toBe(SIGNED_AT_7_DAYS[locale]);
    },
  );

  it('defaults to the declared constant', () => {
    for (const locale of CONSENT_DISCLOSURE_LOCALES) {
      expect(renderDisclosure13_1(locale)).toBe(
        renderDisclosure13_1(locale, CONSENT_LOG_RETENTION_DAYS),
      );
    }
  });

  it('renders a grammatical singular in every language at days = 1', () => {
    expect(renderDisclosure13_1('en', 1)).toContain('retained for 1 day and');
    expect(renderDisclosure13_1('pl', 1)).toContain('przez 1 dzień,');
    expect(renderDisclosure13_1('es', 1)).toContain('durante 1 día y');
  });

  it('matches the byte record that is served to visitors', () => {
    const canonical = JSON.parse(
      readFileSync(
        fileURLToPath(
          new URL('../../../docs/compliance/consent-disclosures.canonical.json', import.meta.url),
        ),
        'utf8',
      ),
    ) as { locales: Record<string, { disclosure13_1: string }> };
    for (const locale of CONSENT_DISCLOSURE_LOCALES) {
      expect(canonical.locales[locale]!.disclosure13_1).toBe(renderDisclosure13_1(locale));
    }
  });
});

describe('buildConsentLogRetentionSql — the deletion follows the same number', () => {
  it('binds the declared constant as the window by default', () => {
    const { count, del, retentionDays } = buildConsentLogRetentionSql();
    expect(retentionDays).toBe(CONSENT_LOG_RETENTION_DAYS);
    expect(count.params.retention_days).toBe(String(CONSENT_LOG_RETENTION_DAYS));
    expect(del.params.retention_days).toBe(String(CONSENT_LOG_RETENTION_DAYS));
  });

  it('produces a DIFFERENT window for a different value', () => {
    expect(buildConsentLogRetentionSql(30).del.params.retention_days).toBe('30');
    expect(buildConsentLogRetentionSql(180).del.params.retention_days).toBe('180');
  });

  it('states the same number the rendered disclosure states', () => {
    for (const days of [30, 180]) {
      const window = buildConsentLogRetentionSql(days).del.params.retention_days;
      for (const locale of CONSENT_DISCLOSURE_LOCALES) {
        const stated = /\b(\d+)\b/.exec(renderDisclosure13_1(locale, days))?.[1];
        expect(stated).toBe(window);
      }
    }
  });

  it('targets ONLY the consent-audit event types — the 13-month TTL owns the rest', () => {
    const { del } = buildConsentLogRetentionSql();
    expect(del.sql).toContain('ALTER TABLE events DELETE WHERE');
    expect(del.sql).toContain('type IN ({consent_type_0:String}, {consent_type_1:String})');
    expect(Object.values(del.params)).toEqual(
      expect.arrayContaining(['consent.granted', 'consent.denied']),
    );
    // No predicate that could reach another type: the only other clause is the age bound.
    expect(del.sql).toBe(
      'ALTER TABLE events DELETE WHERE type IN ({consent_type_0:String}, {consent_type_1:String}) ' +
        'AND ts < now() - toIntervalDay({retention_days:UInt32})',
    );
  });

  it('counts exactly the rows it deletes — same predicate, same params', () => {
    const { count, del } = buildConsentLogRetentionSql();
    const predicate = (sql: string) => sql.slice(sql.indexOf('WHERE'));
    expect(predicate(count.sql)).toBe(predicate(del.sql));
    expect(count.params).toEqual(del.params);
  });

  it('binds every value as a ClickHouse parameter — no value is concatenated into the SQL', () => {
    const { del } = buildConsentLogRetentionSql();
    expect(del.sql).not.toContain('consent.granted');
    expect(del.sql).not.toContain('180');
  });

  it.each([0, -1, 1.5, Number.NaN])('rejects a non-positive-integer window (%s)', (days) => {
    expect(() => buildConsentLogRetentionSql(days)).toThrow(/positive integer/);
  });
});
