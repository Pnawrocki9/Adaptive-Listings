#!/usr/bin/env node
/**
 * upstash-rest-path-adapter.mjs — localhost only (FOLLOW-1299).
 *
 * WHY IT EXISTS. The control plane reads Redis with Upstash's URL-PATH REST form
 * (`GET {UPSTASH_REDIS_URL}/get/<key>`; `chat-intent-cache.ts`, `description-cache.ts`,
 * `tenant-schema.ts`, `feedback-nonce.ts`). The localhost Redis stand-in, SRH
 * (`hiett/serverless-redis-http` on :8079, LOCAL_PILOT_ENVIRONMENT.md 3.7), implements only the
 * POST-BODY form the `@upstash/redis` client uses (`POST /` with `["GET","<key>"]`, `/pipeline`,
 * `/multi-exec`) and answers every path-form request `404 SRH: Endpoint not found`. So the shim's
 * shadow-key write lands in a store the control plane cannot read, and chat never reaches
 * `/api/adapt` on localhost (measured 2026-10-04; README section 6.11).
 *
 * WHAT IT DOES. Translates the path form into the body form and forwards it to SRH, passing the
 * caller's `Authorization` header through. `/`, `/pipeline` and `/multi-exec` are forwarded
 * untouched. Query parameters are appended as arguments, as Upstash does (`/set/k/v?EX=60` →
 * `["set","k","v","EX","60"]`).
 *
 * WHAT IT IS NOT. Not a mock and not a cache: it holds no state and invents no value. Every byte
 * it returns is SRH's answer about the Redis the intent-engine shim wrote to.
 *
 * Env: PORT (default 8078), SRH_URL (default http://localhost:8079).
 */
import { createServer } from 'node:http';

const PORT = Number(process.env.PORT ?? 8078);
const SRH_URL = (process.env.SRH_URL ?? 'http://localhost:8079').replace(/\/$/, '');
const PASS_THROUGH = new Set(['/', '/pipeline', '/multi-exec']);

/**
 * The upstream path and JSON body for one incoming request.
 *
 * @param {string} rawUrl - The request's path and query, as received.
 * @param {string} body - The request body, as received.
 * @returns {{path: string, body: string}}
 */
export function translate(rawUrl, body) {
  const url = new URL(rawUrl, 'http://adapter.invalid');
  if (PASS_THROUGH.has(url.pathname)) return { path: url.pathname, body };
  const args = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  for (const [k, v] of url.searchParams) args.push(k, v);
  return { path: '/', body: JSON.stringify(args) };
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  createServer(async (req, res) => {
    const send = (status, text) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(text);
    };
    if (req.method === 'GET' && req.url === '/health') {
      send(200, JSON.stringify({ service: 'upstash-rest-path-adapter', upstream: SRH_URL }));
      return;
    }
    try {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const out = translate(req.url ?? '/', Buffer.concat(chunks).toString('utf8'));
      const headers = { 'content-type': 'application/json' };
      if (req.headers.authorization) headers.authorization = req.headers.authorization;
      const up = await fetch(`${SRH_URL}${out.path}`, { method: 'POST', headers, body: out.body });
      send(up.status, await up.text());
    } catch (err) {
      send(502, JSON.stringify({ error: `upstash-rest-path-adapter: ${String(err)}` }));
    }
  }).listen(PORT, '127.0.0.1', () => {
    console.log(`upstash-rest-path-adapter listening on :${String(PORT)} → ${SRH_URL}`);
  });
}
