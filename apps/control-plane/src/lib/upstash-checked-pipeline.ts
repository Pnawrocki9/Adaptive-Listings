/**
 * One Upstash REST `/pipeline` call whose result is checked for its HTTP status AND for an error on
 * every command (FOLLOW-1308, Codex R-01).
 *
 * Upstash answers a failed command inside a 200: `[{ "error": "..." }]`. An HTTP 401/403 (a wrong or
 * read-only token) carries no per-command list at all. The DSR erasure helpers used to `await fetch`
 * and treat either as success, so a store failure read as "erased". `buyer-profile-store.ts` has its
 * own copy of this check (FOLLOW-1316) and is left as it is.
 *
 * @module apps/control-plane/src/lib/upstash-checked-pipeline
 */

/** Why a pipeline call did not give a clean result for every command. A code only, never a body. */
type UpstashPipelineFailure =
  | 'redis_unconfigured'
  | 'redis_unreachable'
  | 'redis_http_error'
  | 'redis_command_error';

/** Every command's `result`, in order, or why at least one of them is not known to have run. */
type UpstashPipelineOutcome =
  | { ok: true; results: unknown[] }
  | { ok: false; code: UpstashPipelineFailure };

const TIMEOUT_MS = 5_000;

/**
 * POST the commands to `/pipeline` on `UPSTASH_REDIS_URL`.
 *
 * @param commands - Redis commands, e.g. `[['DEL', key], ['EXISTS', key]]`.
 * @returns `ok` only when the HTTP status is 2xx, the body is a list of one reply per command, and
 *   no reply carries an `error`.
 */
export async function upstashCheckedPipeline(
  commands: string[][],
): Promise<UpstashPipelineOutcome> {
  const base = process.env.UPSTASH_REDIS_URL?.replace(/\/$/, '');
  if (!base) return { ok: false, code: 'redis_unconfigured' };
  const token = process.env.UPSTASH_REDIS_TOKEN;

  let res: Response;
  try {
    res = await fetch(`${base}/pipeline`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(commands),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return { ok: false, code: 'redis_unreachable' };
  }
  if (!res.ok) return { ok: false, code: 'redis_http_error' };

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { ok: false, code: 'redis_http_error' };
  }
  if (!Array.isArray(body) || body.length !== commands.length) {
    return { ok: false, code: 'redis_command_error' };
  }
  const replies = body as unknown[];
  if (replies.some((r) => r === null || typeof r !== 'object' || 'error' in r)) {
    return { ok: false, code: 'redis_command_error' };
  }
  return { ok: true, results: replies.map((r) => (r as { result?: unknown }).result ?? null) };
}
