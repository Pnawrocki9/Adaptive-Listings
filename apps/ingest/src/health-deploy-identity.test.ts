/**
 * FOLLOW-938 AC(1) — `/health` must answer "what is actually running?".
 *
 * The observation that produced this ticket: in one merge window, #710 landed in the control
 * plane and was observably live within hours, while #711 landed in this Worker and **is not
 * deployed** — no automated ingest deploy exists. Both tickets closed DONE on identical evidence
 * (merge commit + green CI). Nothing could distinguish them, because `/health` returned only
 * status/service/environment.
 *
 * These cases pin the CONTRACT, not the value: the keys must exist and must be `null` rather than
 * absent when unknown. An absent key reads as "old shape" — the reader retries against the wrong
 * assumption instead of concluding "nobody knows".
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, it, expect } from 'vitest';

import { createApp } from './router.js';
import type { Env } from './types.js';

function envWith(overrides: Partial<Env> = {}): Env {
  return { ENVIRONMENT: 'production', ...overrides } as Env;
}

async function health(env: Env): Promise<Record<string, unknown>> {
  const res = await createApp().fetch(new Request('http://test/health'), env);
  expect(res.status).toBe(200);
  return await res.json<Record<string, unknown>>();
}

describe('FOLLOW-938 — /health carries the deploy identity', () => {
  it('reports the Cloudflare version id when the binding is present', async () => {
    const body = await health(envWith({ CF_VERSION_METADATA: { id: 'v-abc-123' } }));
    expect(body.version_id).toBe('v-abc-123');
  });

  it('reports the git sha when something injects it', async () => {
    const body = await health(envWith({ GIT_SHA: 'deadbeef' }));
    expect(body.git_sha).toBe('deadbeef');
  });

  it('says null — not nothing — when neither is available', async () => {
    const body = await health(envWith());
    // The distinction this ticket exists for: `null` is an answer ("nobody knows"), an absent key
    // is a shrug that reads as an older deployment.
    expect(body).toHaveProperty('version_id');
    expect(body).toHaveProperty('git_sha');
    expect(body.version_id).toBeNull();
    expect(body.git_sha).toBeNull();
  });

  it('keeps the pre-existing liveness fields, so existing probes do not break', async () => {
    const body = await health(envWith());
    expect(body.status).toBe('ok');
    expect(body.service).toBe('estalara-ingest');
    expect(body.environment).toBe('production');
  });
});

describe('FOLLOW-938 — the binding that makes version_id non-null is actually declared', () => {
  const wrangler = readFileSync(join(__dirname, '../wrangler.toml'), 'utf8');

  // Without this, `/health` answers `null` in production forever and nothing notices — a producer
  // that exists in code with no configuration behind it, which is the shape this estate keeps
  // finding. Named environments do NOT inherit top-level bindings in wrangler, so each must
  // declare its own: asserting only the top-level block would pass while prod stayed blind.
  for (const section of [
    '[version_metadata]',
    '[env.staging.version_metadata]',
    '[env.production.version_metadata]',
  ]) {
    it(`declares ${section}`, () => {
      expect(
        wrangler.includes(section),
        `${section} is missing — /health will report version_id: null in that environment`,
      ).toBe(true);
    });
  }
});
