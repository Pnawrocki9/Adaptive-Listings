/**
 * Consent-audit-log retention — ONE declared value, two derived consumers.
 *
 * ## Why this module exists
 *
 * Until FOLLOW-1118 the retention period for the consent-decision audit log lived in at least
 * four places that disagreed with each other: a 13-month TTL in
 * `infra/clickhouse/migrations/0001_create_events.sql`, a hand-written "7 days" sentence
 * byte-locked into three locales, rows in `docs/compliance/ropa.md` stating a third thing, and
 * three tables with no TTL at all. The shipped banner therefore promised visitors, in en/pl/es,
 * that their consent-decision log was *"retained for 7 days and is then permanently deleted"*
 * while the only mechanism kept it for 13 months (ESC-071, RETRO-309).
 *
 * The CEO ruling (2026-08-24) was not "shorten retention" — the data is wanted at this stage —
 * but *"I want to be able to change the text and have the retention period adapt to the new
 * value automatically."* This module is that mechanism:
 *
 *   1. {@link CONSENT_LOG_RETENTION_DAYS} is the SOURCE OF TRUTH. It is the only place the
 *      retention period appears as a number.
 *   2. {@link renderDisclosure13_1} GENERATES the DPIA §13.1 disclosure sentence for each
 *      locale from it. The sentences are templates, never hand-written alongside the constant,
 *      so the number cannot be edited independently of the mechanism.
 *   3. {@link buildConsentLogRetentionSql} builds the ClickHouse statements the daily retention
 *      cron issues, from the same constant.
 *
 * Change the constant and BOTH follow. `scripts/check-consent-retention-sync.mjs` fails CI when
 * the constant, the rendered disclosure and the cron's window disagree — without that gate this
 * work would have *moved* the drift rather than removed it.
 *
 * ## Why a cron rather than a ClickHouse TTL
 *
 * A measured constraint, not a preference. ClickHouse DDL is not auto-applied in this repo —
 * `infra/clickhouse/migrations/` is applied by hand through the Cloud console — and the production
 * role can issue `ALTER … DELETE` on `events` but cannot alter its TTL: see [MP-015] in
 * `docs/ops/MEASURED_PREMISES.md`, which owns that claim, its date and its expiry. A TTL-based fix
 * therefore could never satisfy "adapts automatically": every future change would need a human in
 * a console. `ALTER DELETE` is available, so a cron can.
 *
 * ## Why the SQL builder lives in `@estalara/shared` and not in the control plane
 *
 * Deliberately, so that the deletion window is derived from the same constant the disclosure is
 * derived from, in the same file, with no import between them that could be swapped. It also
 * lets the CI gate EVALUATE the real builder — the number it checks is the one the cron will
 * actually send — instead of pattern-matching the route's source and hoping.
 *
 * @module @estalara/shared/consent-retention
 */

/**
 * How long the consent-decision audit log (`consent.granted` / `consent.denied` rows in
 * ClickHouse `events`) is retained, in days.
 *
 * **This is the source of truth for the retention period.** It drives, in this order:
 *
 *   - the DPIA §13.1 disclosure sentence rendered to visitors in en/pl/es
 *     ({@link renderDisclosure13_1}) — via `apps/control-plane/public/consent-text.json` and
 *     `docs/compliance/consent-disclosures.canonical.json`, both of which the CI gate holds
 *     equal to the rendered output;
 *   - the deletion window of the daily retention cron
 *     (`GET /api/internal/retention/consent-log`) — via {@link buildConsentLogRetentionSql}.
 *
 * Changing this number changes both. Nothing else in the repository may state the period as a
 * literal: `scripts/check-consent-retention-sync.mjs` is the gate that keeps that true, and
 * `docs/compliance/ropa.md` + `docs/compliance/dpia.md` §13.1 name this constant rather than
 * restating the figure.
 *
 * Set to 180 by CEO ruling (ESC-071, 2026-08-24). The `events` table's own 13-month TTL is
 * untouched and continues to govern every other event type.
 */
export const CONSENT_LOG_RETENTION_DAYS = 180;

/**
 * The event types that make up the consent-decision audit log — the ONLY rows the retention
 * cron deletes.
 *
 * Every other type in `events` is governed by the table's 13-month TTL
 * (`infra/clickhouse/migrations/0001_create_events.sql`), which this mechanism must not touch.
 */
export const CONSENT_LOG_EVENT_TYPES = ['consent.granted', 'consent.denied'] as const;

/** Locales the DPIA §13.1 disclosure sentence ships in. */
export const CONSENT_DISCLOSURE_LOCALES = ['en', 'pl', 'es'] as const;

/** One of the locales the DPIA §13.1 disclosure sentence ships in. */
export type ConsentDisclosureLocale = (typeof CONSENT_DISCLOSURE_LOCALES)[number];

/**
 * The DPIA §13.1 disclosure sentence, per locale, as a template over the retention period.
 *
 * These are the bytes compliance signed, with the period — and only the period — replaced by an
 * interpolation. The singular forms exist so that a future value of `1` cannot render "retained
 * for 1 days"; the plural forms are correct for every other value in each language (Polish takes
 * the genitive plural `dni` for 2, 5, 22, 180 alike).
 *
 * Not exported: the rendered sentence is the contract, the template is an implementation detail.
 * Exporting it would give a second editable home to the text this module exists to unify.
 */
const DISCLOSURE_13_1_TEMPLATES: Record<ConsentDisclosureLocale, (days: number) => string> = {
  en: (days) =>
    'We record the fact of your consent decision — including a denial — for compliance and ' +
    `debugging purposes. This log is retained for ${String(days)} ${days === 1 ? 'day' : 'days'} ` +
    'and is then permanently deleted.',
  pl: (days) =>
    'Rejestrujemy fakt Twojej decyzji dotyczącej zgody — w tym odmowę — w celach zgodności i ' +
    `debugowania. Dziennik ten jest przechowywany przez ${String(days)} ` +
    `${days === 1 ? 'dzień' : 'dni'}, po czym jest trwale usuwany.`,
  es: (days) =>
    'Registramos el hecho de tu decisión de consentimiento — incluida una denegación — con ' +
    `fines de cumplimiento y depuración. Este registro se conserva durante ${String(days)} ` +
    `${days === 1 ? 'día' : 'días'} y luego se elimina de forma permanente.`,
};

/**
 * Render the DPIA §13.1 consent-audit-log disclosure sentence for one locale.
 *
 * The rendered output is what the visitor reads and what the byte-lock
 * (`docs/compliance/consent-disclosures.canonical.json`, enforced by
 * `scripts/check-adr-0021-conditions.mjs`) and the served document
 * (`apps/control-plane/public/consent-text.json`) must equal — enforced by
 * `scripts/check-consent-retention-sync.mjs`.
 *
 * @param locale - `'en' | 'pl' | 'es'`.
 * @param days - Retention period in days. Defaults to {@link CONSENT_LOG_RETENTION_DAYS};
 *   pass an explicit value only in tests that prove the text follows the number.
 * @returns The disclosure sentence.
 */
export function renderDisclosure13_1(
  locale: ConsentDisclosureLocale,
  days: number = CONSENT_LOG_RETENTION_DAYS,
): string {
  return DISCLOSURE_13_1_TEMPLATES[locale](days);
}

/** A parameterized ClickHouse statement: SQL text plus the values to bind as `param_<name>`. */
export interface ConsentRetentionSql {
  /** SQL text with `{name:Type}` placeholders — never contains a raw value. */
  sql: string;
  /** Values to bind, keyed by placeholder name (sent as `param_<name>`). */
  params: Record<string, string>;
}

/** The two statements the consent-log retention cron issues, in the order it issues them. */
export interface ConsentLogRetentionStatements {
  /** `SELECT count()` over exactly the rows `del` would delete. */
  count: ConsentRetentionSql;
  /** `ALTER TABLE events DELETE WHERE …` over exactly the rows `count` counted. */
  del: ConsentRetentionSql;
  /** The window both statements were built with, in days. */
  retentionDays: number;
}

/**
 * Build the ClickHouse statements that enforce {@link CONSENT_LOG_RETENTION_DAYS}.
 *
 * Both statements carry the SAME predicate, so the count the cron reports is exactly the set the
 * mutation removes. The predicate matches ONLY {@link CONSENT_LOG_EVENT_TYPES}: every other row
 * in `events` is left to the table's 13-month TTL, which this mechanism must not disturb.
 *
 * Values are bound as ClickHouse HTTP parameters rather than concatenated, matching
 * `apps/control-plane/src/lib/clickhouse-dsr.ts` (FOLLOW-462). Nothing here is user-controlled —
 * the types are compile-time constants and the window is a number — but a second SQL-building
 * convention in the same codebase is how the next injection gets written.
 *
 * @param days - Retention window in days. Defaults to {@link CONSENT_LOG_RETENTION_DAYS}.
 * @returns The count statement, the delete statement, and the window they were built with.
 * @throws If `days` is not a positive integer — a non-integer window would silently widen or
 *   narrow the promise made to data subjects.
 */
export function buildConsentLogRetentionSql(
  days: number = CONSENT_LOG_RETENTION_DAYS,
): ConsentLogRetentionStatements {
  if (!Number.isInteger(days) || days < 1) {
    throw new Error(
      `buildConsentLogRetentionSql: retention window must be a positive integer number of days, got ${String(days)}`,
    );
  }

  const params: Record<string, string> = { retention_days: String(days) };
  const placeholders = CONSENT_LOG_EVENT_TYPES.map((type, i) => {
    const name = `consent_type_${String(i)}`;
    params[name] = type;
    return `{${name}:String}`;
  });

  const predicate =
    `type IN (${placeholders.join(', ')}) ` +
    `AND ts < now() - toIntervalDay({retention_days:UInt32})`;

  return {
    count: { sql: `SELECT count() FROM events WHERE ${predicate}`, params },
    del: { sql: `ALTER TABLE events DELETE WHERE ${predicate}`, params },
    retentionDays: days,
  };
}
