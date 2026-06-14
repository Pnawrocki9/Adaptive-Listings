/**
 * Tests for src/middleware.ts — CORS injection for SDK-facing adapt routes.
 *
 * Covers the dev-only localhost CORS gating added for local E2E testing
 * (Estalara-app SvelteKit on :5173 calling control-plane on :3000).
 *
 * Coverage:
 *   CORS-OPTIONS-1: OPTIONS from localhost:5173 → 204 + Allow-Origin in dev
 *   CORS-OPTIONS-2: OPTIONS from localhost:5173 → 204 + NO Allow-Origin in prod
 *   CORS-OPTIONS-3: OPTIONS from admin.estalara.com → 204 + Allow-Origin in prod
 *   CORS-OPTIONS-4: OPTIONS from evil.example.com → 204 + no Allow-Origin in dev
 *   CORS-GET-1: GET /api/adapt from localhost:5173 → middleware injects Allow-Origin in dev
 *   CORS-GET-2: GET /api/adapt from localhost:5173 → no Allow-Origin in prod
 *   CORS-GET-3: GET /api/adapt/description from localhost:5173 → Allow-Origin in dev
 *   CORS-GET-4: GET /api/adapt/feedback (POST) from localhost:5173 → Allow-Origin in dev
 *   CORS-NON-ADAPT: GET /api/quiz/public-config is NOT matched by adapter prefix
 *                   (that route sets its own `*` CORS — middleware must not interfere)
 *
 * Auth calls are mocked so the test does not require a live DB or JWT secret.
 */

import { NextRequest } from 'next/server';
import { describe, expect, it, vi, afterEach } from 'vitest';

// Mock @estalara/auth so the dashboard/admin branches don't need real JWTs.
vi.mock('@estalara/auth', () => ({
  getAuthClaims: vi.fn().mockResolvedValue(null),
  isStaffClaims: vi.fn().mockReturnValue(false),
  isTenantClaims: vi.fn().mockReturnValue(false),
  requireAgencyRole: vi.fn(),
  requireStaffRole: vi.fn(),
}));

import { middleware } from './middleware.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRequest(pathname: string, method = 'GET', origin: string | null = null): NextRequest {
  const url = `http://localhost:3000${pathname}`;
  const headers: Record<string, string> = {};
  if (origin) headers.Origin = origin;
  return new NextRequest(url, { method, headers });
}

// ─── OPTIONS preflight tests ──────────────────────────────────────────────────

describe('CORS OPTIONS preflight — /api/adapt routes', () => {
  it('CORS-OPTIONS-1: localhost:5173 preflight returns 204 + Allow-Origin in dev', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const req = makeRequest('/api/adapt', 'OPTIONS', 'http://localhost:5173');
    const res = await middleware(req);
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('GET');
  });

  it('CORS-OPTIONS-2: localhost:5173 preflight returns 204 + NO Allow-Origin in prod', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const req = makeRequest('/api/adapt', 'OPTIONS', 'http://localhost:5173');
    const res = await middleware(req);
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('CORS-OPTIONS-3: app.estalara.com preflight returns Allow-Origin in prod', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const req = makeRequest('/api/adapt', 'OPTIONS', 'https://app.estalara.com');
    const res = await middleware(req);
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://app.estalara.com');
  });

  it('CORS-OPTIONS-4: evil.example.com preflight returns NO Allow-Origin in dev', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const req = makeRequest('/api/adapt', 'OPTIONS', 'https://evil.example.com');
    const res = await middleware(req);
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('OPTIONS preflight matches /api/adapt/description in dev', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const req = makeRequest('/api/adapt/description', 'OPTIONS', 'http://localhost:5173');
    const res = await middleware(req);
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
  });

  it('OPTIONS preflight matches /api/adapt/feedback in dev', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const req = makeRequest('/api/adapt/feedback', 'OPTIONS', 'http://localhost:5173');
    const res = await middleware(req);
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
  });
});

// ─── Non-preflight inject tests ───────────────────────────────────────────────

describe('CORS header injection — GET/POST to /api/adapt routes', () => {
  it('CORS-GET-1: GET /api/adapt from localhost:5173 injects Allow-Origin header in dev', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const req = makeRequest('/api/adapt', 'GET', 'http://localhost:5173');
    const res = await middleware(req);
    // Middleware calls NextResponse.next() and sets header — it is not a real 200 response
    // (route handler hasn't run), but the returned NextResponse carries the injected header.
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
  });

  it('CORS-GET-2: GET /api/adapt from localhost:5173 — no Allow-Origin in prod', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const req = makeRequest('/api/adapt', 'GET', 'http://localhost:5173');
    const res = await middleware(req);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('CORS-GET-3: GET /api/adapt/description injects Allow-Origin in dev', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const req = makeRequest('/api/adapt/description', 'GET', 'http://localhost:5173');
    const res = await middleware(req);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
  });

  it('CORS-GET-4: POST /api/adapt/feedback injects Allow-Origin in dev', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const req = makeRequest('/api/adapt/feedback', 'POST', 'http://localhost:5173');
    const res = await middleware(req);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
  });

  it('CORS-NON-ADAPT: /api/quiz/public-config is NOT matched (middleware passes through)', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const req = makeRequest('/api/quiz/public-config', 'GET', 'http://localhost:5173');
    const res = await middleware(req);
    // Middleware passes through — it must NOT inject a conflicting Allow-Origin.
    // The route itself sets `*`; middleware should not override it.
    // Since the middleware calls NextResponse.next() without headers here, the
    // header on the _middleware_ response will be null (the route sets it separately).
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
});
