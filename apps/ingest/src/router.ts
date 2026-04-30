/**
 * Top-level Hono app + routes. Health check + `/v1/events` POST. Worker `fetch` entry-point in
 * `index.ts` re-exports this.
 *
 * @module apps/ingest/src/router
 */

import { Hono } from 'hono';

import type { Env } from './types.js';
import { events } from './handlers/events.js';

export function createApp(): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();

  app.get('/health', (c) =>
    c.json({
      status: 'ok',
      service: 'estalara-ingest',
      environment: c.env.ENVIRONMENT,
    }),
  );

  app.route('/v1/events', events);

  app.notFound((c) => c.json({ error: 'not_found', path: new URL(c.req.url).pathname }, 404));

  app.onError((err, c) => {
    console.error('ingest_unhandled_error', err);
    return c.json({ error: 'internal_error' }, 500);
  });

  return app;
}
