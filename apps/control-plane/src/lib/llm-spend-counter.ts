/**
 * Daily LLM spend counter on Upstash Redis (FOLLOW-1290 / WP-2.5).
 *
 * Replaces the per-request `SELECT sum(cost_usd) FROM llm_calls WHERE ts >= now() - 1 DAY`
 * circuit-breaker read (a ClickHouse scan on the hot path) with one O(1) Redis `GET`.
 *
 * - Key: `llm:spend:<YYYY-MM-DD>` (UTC day). The cap is therefore a UTC-day cap, not a rolling 24 h.
 * - Write: `INCRBYFLOAT key <cost>` after every billed call, with `EXPIRE key 48h NX`, so the TTL is
 *   set once, on the first write of the day (the key outlives its day by 24 h, then vanishes).
 * - Read: `GET key` — the gate.
 * - `llm_calls` in ClickHouse stays the log of record; this counter is only the gate's cache.
 *
 * Failure posture (unchanged from the ClickHouse check, Rule K.2 stated explicitly): Redis not
 * configured (dev/CI) is a silent zero; configured-but-failed FAILS OPEN — the call proceeds, the
 * error is logged and captured to Sentry (`kind: 'spend_counter'`). It never fails closed: a Redis
 * outage must not take every adaptation down.
 *
 * @module apps/control-plane/src/lib/llm-spend-counter
 */

import * as Sentry from '@sentry/nextjs';

const SPEND_KEY_PREFIX = 'llm:spend:';
/** 48 h: the key outlives its UTC day by one day, then expires. */
export const SPEND_KEY_TTL_SECONDS = 48 * 60 * 60;

/** Redis key for the UTC day containing `now`. */
export function spendKeyFor(now: Date = new Date()): string {
  return `${SPEND_KEY_PREFIX}${now.toISOString().slice(0, 10)}`;
}

function redisBase(): string | null {
  const url = process.env.UPSTASH_REDIS_URL;
  return url ? url.replace(/\/$/, '') : null;
}

function redisHeaders(): Record<string, string> {
  const token = process.env.UPSTASH_REDIS_TOKEN;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function reportFailure(op: 'read' | 'write', err: unknown): void {
  const e = err instanceof Error ? err : new Error(String(err));
  console.error(`[llm-spend] counter ${op} failed (fail-open):`, e.message);
  Sentry.captureException(e, { tags: { area: 'adapt', kind: 'spend_counter', op } });
}

/**
 * Today's accumulated spend in USD. Returns 0 when Redis is unconfigured, the key is absent, or
 * Redis fails (fail-open; the failure is logged and captured).
 */
export async function getDailySpend(now: Date = new Date()): Promise<number> {
  const base = redisBase();
  if (!base) return 0;
  try {
    const path = ['get', spendKeyFor(now)].map((a) => encodeURIComponent(a)).join('/');
    const res = await fetch(`${base}/${path}`, { method: 'GET', headers: redisHeaders() });
    if (!res.ok) throw new Error(`Upstash GET returned HTTP ${String(res.status)}`);
    const envelope = (await res.json()) as { result?: string | number | null } | null;
    const total = Number(envelope?.result ?? 0);
    return Number.isFinite(total) ? total : 0;
  } catch (err: unknown) {
    reportFailure('read', err);
    return 0;
  }
}

/**
 * Add one billed call's cost to today's counter. No-op for a non-positive cost or an unconfigured
 * Redis. Never throws; resolves after the Redis round trip so callers can register it via
 * `afterResponse()`.
 */
export async function recordLlmSpend(costUsd: number, now: Date = new Date()): Promise<void> {
  if (!(costUsd > 0)) return;
  const base = redisBase();
  if (!base) return;
  const key = spendKeyFor(now);
  try {
    const res = await fetch(`${base}/pipeline`, {
      method: 'POST',
      headers: { ...redisHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify([
        ['INCRBYFLOAT', key, String(costUsd)],
        ['EXPIRE', key, String(SPEND_KEY_TTL_SECONDS), 'NX'],
      ]),
    });
    if (!res.ok) throw new Error(`Upstash pipeline returned HTTP ${String(res.status)}`);
    const results = (await res.json()) as { error?: string }[];
    const failed = Array.isArray(results) ? results.find((r) => r.error) : undefined;
    if (failed) throw new Error(`Upstash command error: ${String(failed.error)}`);
  } catch (err: unknown) {
    reportFailure('write', err);
  }
}
