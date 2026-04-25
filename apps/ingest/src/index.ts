/**
 * Estalara ingest Cloudflare Worker — placeholder.
 *
 * Full implementation in TICKET-010 (backend-engineer).
 * p95 latency target: <50ms
 *
 * Responsibilities:
 * - Validate ingest events against Zod schema (packages/shared)
 * - Route to correct regional Redpanda topic
 * - Return 202 Accepted immediately
 * - Enforce rate limits per tenant
 */

export interface Env {
  ENVIRONMENT: string;
}

/** Placeholder fetch handler — returns 200 with service metadata. */
export default {
  // eslint-disable-next-line @typescript-eslint/require-await -- placeholder; no async ops yet (TICKET-010)
  async fetch(_request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    return new Response(
      JSON.stringify({
        service: 'estalara-ingest',
        version: '0.0.0',
        status: 'placeholder',
        environment: env.ENVIRONMENT,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  },
} satisfies ExportedHandler<Env>;
