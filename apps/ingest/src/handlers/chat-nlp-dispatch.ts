/**
 * Direct Modal HTTPS dispatch for chat.message.sent → intent-engine (audit F-01).
 *
 * Mirrors ADR-0016 / control-plane `publishDescriptionRequested`: Redpanda Cloud
 * Serverless has no HTTP Proxy, so stream-consumer never receives events in prod.
 * Ingest POSTs to `MODAL_CHAT_NLP_URL` (Modal `chat_nlp_endpoint`) inside
 * `ctx.waitUntil()` so ACK latency is unaffected.
 *
 * When `MODAL_CHAT_NLP_URL` is unset the dispatch is a configured no-op (same
 * shape as Redpanda / description URL guards). Failures are fail-loud to Sentry
 * (Rule K.2 fire-and-forget amendment) without blocking ingest ACK.
 *
 * §H.9: `profiling_opt_out` is forwarded so Modal skips the shadow Redis write;
 * the chat event itself still reaches ClickHouse via the normal batch path.
 *
 * @module apps/ingest/src/handlers/chat-nlp-dispatch
 */

import * as Sentry from '@sentry/cloudflare';

/** Env bindings for the chat-NLP Modal dispatch. */
export interface ChatNlpDispatchEnv {
  /**
   * Modal `chat_nlp_endpoint` HTTPS URL.
   * Empty / unset = skip dispatch (pilot not yet wired).
   */
  MODAL_CHAT_NLP_URL?: string;
  /**
   * Shared Bearer secret — must match Modal `estalara-secrets` INTERNAL_API_SECRET
   * (same secret used by description / embed-seed endpoints).
   */
  INTERNAL_API_SECRET?: string;
}

/** Minimal fields needed to spawn process_chat_message. */
export interface ChatNlpDispatchArgs {
  tenant_id: string;
  session_id: string;
  /** PII-scrubbed message text from ChatMessageSentPayloadSchema.message */
  message_text: string;
  /** §H.9 opt-out — when true, Modal skips the shadow Redis write. */
  profiling_opt_out?: boolean;
}

/**
 * POST to Modal chat_nlp_endpoint. Never throws; captures HTTP/network failures
 * to Sentry. Returns a Promise so callers can register it via `waitUntil`.
 *
 * @param args - Tenant/session/message fields from a validated chat.message.sent.
 * @param env - Worker env (URL + secret).
 * @param fetchImpl - Injectable fetch for tests.
 */
export function dispatchChatNlp(
  args: ChatNlpDispatchArgs,
  env: ChatNlpDispatchEnv,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const modalUrl = env.MODAL_CHAT_NLP_URL?.trim();
  if (!modalUrl) {
    return Promise.resolve();
  }

  const messageText = args.message_text.trim();
  if (!args.tenant_id || !args.session_id || !messageText) {
    return Promise.resolve();
  }

  const secret = env.INTERNAL_API_SECRET ?? '';
  const body = {
    tenant_id: args.tenant_id,
    session_id: args.session_id,
    message: { role: 'user', content: messageText },
    profiling_opt_out: args.profiling_opt_out === true,
  };

  return fetchImpl(modalUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify(body),
  })
    .then(async (res) => {
      if (!res.ok) {
        const text = await res.text().catch(() => '<unreadable body>');
        const msg = `[chat-nlp] Modal dispatch rejected: HTTP ${String(res.status)} — ${text.slice(0, 500)}`;
        console.error(msg);
        Sentry.captureException(new Error(msg), {
          tags: { area: 'chat-nlp', sink: 'modal', kind: 'dispatch_failed' },
          extra: { status: res.status, tenant_id: args.tenant_id },
        });
      }
    })
    .catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[chat-nlp] Modal dispatch failed:', msg);
      Sentry.captureException(err instanceof Error ? err : new Error(msg), {
        tags: { area: 'chat-nlp', sink: 'modal', kind: 'network' },
        extra: { tenant_id: args.tenant_id },
      });
    });
}
