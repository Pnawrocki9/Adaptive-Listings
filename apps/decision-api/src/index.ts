/**
 * Estalara decision API Cloudflare Worker — placeholder.
 *
 * Full implementation in TICKET-011 (backend-engineer).
 * p95 latency targets: <80ms (cached path), <2000ms (LLM path)
 *
 * Responsibilities:
 * - Accept adaptation decision requests from the SDK
 * - Check Upstash Redis for cached archetype decisions
 * - Fall through to Modal intent-engine on cache miss
 * - Return adaptation directives to the SDK
 */

export interface Env {
  ENVIRONMENT: string;
}

/** Placeholder fetch handler — returns 200 with service metadata. */
export default {
  // eslint-disable-next-line @typescript-eslint/require-await -- placeholder; no async ops yet (TICKET-011)
  async fetch(_request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    return new Response(
      JSON.stringify({
        service: 'estalara-decision-api',
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
