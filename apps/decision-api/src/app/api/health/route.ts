/**
 * GET /api/health — liveness check for monitoring and load-balancer probes.
 *
 * @module apps/decision-api/src/app/api/health/route
 */

export function handleHealthRequest(): Response {
  return Response.json({ status: 'ok', service: 'decision-api', version: '0.0.1' });
}
