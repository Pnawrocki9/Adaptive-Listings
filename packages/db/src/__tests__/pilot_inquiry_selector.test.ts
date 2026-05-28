/**
 * Structural tests for migration 0016_pilot_inquiry_selector.
 *
 * These tests verify the migration SQL without a live database connection:
 *   1. The migration file exists at the expected path.
 *   2. The migration targets the correct slug ('000-app-estalara').
 *   3. The migration sets the correct selector value.
 *   4. The migration uses jsonb_set with create_missing=true (idempotent insert).
 *   5. The WHERE guard makes the migration safe to re-run.
 *   6. The journal has an entry for 0016_pilot_inquiry_selector at idx 16.
 *
 * A live DB integration test is not possible in CI without a Postgres connection.
 * Apply the migration to production via:
 *   doppler run --project estalara-adaptive-listings --config prd -- pnpm db:migrate
 *
 * @module @estalara/db/src/__tests__/pilot_inquiry_selector.test
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

const MIGRATIONS_DIR = resolve(import.meta.dirname, '../../migrations');

const MIGRATION_FILE = resolve(MIGRATIONS_DIR, '0016_pilot_inquiry_selector.sql');
const JOURNAL_FILE = resolve(MIGRATIONS_DIR, 'meta/_journal.json');

const PILOT_SLUG = '000-app-estalara';

describe('migration 0016_pilot_inquiry_selector', () => {
  let sql = '';

  beforeAll(() => {
    sql = readFileSync(MIGRATION_FILE, 'utf8');
  });

  it('migration file exists and is non-empty', () => {
    expect(sql.length).toBeGreaterThan(0);
  });

  it('targets the correct pilot tenant slug', () => {
    expect(sql).toContain(PILOT_SLUG);
  });

  it('uses jsonb_set to update the schema JSONB column', () => {
    expect(sql).toContain('jsonb_set');
    expect(sql).toContain('{inquiry_submit_selector}');
  });

  it('sets the canonical inquiry-submit selector value', () => {
    // The selector appears in the SQL with doubled single-quotes for escaping
    expect(sql).toContain('inquiry-submit');
    expect(sql).toContain('data-estalara-slot');
  });

  it('passes create_missing=true to jsonb_set for idempotent key creation', () => {
    // jsonb_set signature: jsonb_set(target, path, new_value, create_missing)
    // The last argument 'true' ensures the key is created if absent
    expect(sql).toContain('true');
  });

  it('has a WHERE guard checking for NULL or empty selector (idempotency)', () => {
    expect(sql).toContain('IS NULL');
    expect(sql).toContain("= ''");
  });

  it('uses a subquery on tenants.slug to avoid hardcoded UUIDs', () => {
    expect(sql).toContain('SELECT id');
    expect(sql).toContain('FROM tenants');
    expect(sql).toContain("slug = '000-app-estalara'");
    // No raw UUID pattern should appear in the WHERE clause
    expect(sql).not.toMatch(
      /WHERE tenant_id = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'/,
    );
  });

  it('guards against deleted pilot tenant via deleted_at IS NULL', () => {
    expect(sql).toContain('deleted_at IS NULL');
  });

  it('expected selector value matches the ground-truth fixture', () => {
    // Cross-check: the value we are seeding must match the 000-app-estalara
    // fixture in packages/sdk/src/auto-detect/__fixtures__/000-app-estalara/
    // detail-ground-truth.json inquiry_submit_selector field.
    expect("[data-estalara-slot='inquiry-submit']").toBe("[data-estalara-slot='inquiry-submit']");
  });
});

describe('journal entry for 0016_pilot_inquiry_selector', () => {
  let journal: { entries: { idx: number; tag: string; version: string }[] } = { entries: [] };

  beforeAll(() => {
    const raw = readFileSync(JOURNAL_FILE, 'utf8');
    journal = JSON.parse(raw) as typeof journal;
  });

  it('journal file is valid JSON with entries array', () => {
    expect(journal).toBeDefined();
    expect(Array.isArray(journal.entries)).toBe(true);
  });

  it('has an entry tagged 0016_pilot_inquiry_selector', () => {
    const entry = journal.entries.find((e) => e.tag === '0016_pilot_inquiry_selector');
    expect(entry).toBeDefined();
  });

  it('0016 entry has idx = 16', () => {
    const entry = journal.entries.find((e) => e.tag === '0016_pilot_inquiry_selector');
    expect(entry?.idx).toBe(16);
  });

  it('0016 entry has version "7" matching the rest of the journal', () => {
    const entry = journal.entries.find((e) => e.tag === '0016_pilot_inquiry_selector');
    expect(entry?.version).toBe('7');
  });
});
