/**
 * Tests for src/lib/dev-cors.ts — SDK-facing CORS helpers.
 *
 * Coverage:
 *   PROD-1: prod origins allowed in production NODE_ENV
 *   PROD-2: localhost origins BLOCKED in production NODE_ENV
 *   DEV-1: prod origins allowed in non-production NODE_ENV
 *   DEV-2: localhost:5173 allowed in non-production NODE_ENV
 *   DEV-3: localhost:3000 allowed in non-production NODE_ENV
 *   DEV-4: arbitrary evil origin blocked in all envs
 *   HEADERS-1: buildCorsHeaders includes Allow-Origin when origin is allowed
 *   HEADERS-2: buildCorsHeaders omits Allow-Origin when origin is not allowed
 *   HEADERS-3: buildCorsHeaders merges extra headers
 *   PREFLIGHT-1: corsPreflightResponse returns 204 with correct headers
 */

import { describe, expect, it, vi, afterEach } from 'vitest';
import { resolveAllowOrigin, buildCorsHeaders, corsPreflightResponse } from '../dev-cors.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

// ─── resolveAllowOrigin ───────────────────────────────────────────────────────

describe('resolveAllowOrigin — production env', () => {
  it('PROD-1: allows app.estalara.com in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(resolveAllowOrigin('https://app.estalara.com')).toBe('https://app.estalara.com');
  });

  it('PROD-1: allows admin.estalara.com in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(resolveAllowOrigin('https://admin.estalara.com')).toBe('https://admin.estalara.com');
  });

  it('PROD-2: rejects localhost:5173 in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(resolveAllowOrigin('http://localhost:5173')).toBeNull();
  });

  it('PROD-2: rejects localhost:3000 in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(resolveAllowOrigin('http://localhost:3000')).toBeNull();
  });

  it('PROD-2: rejects evil.example.com in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(resolveAllowOrigin('https://evil.example.com')).toBeNull();
  });
});

describe('resolveAllowOrigin — non-production env', () => {
  it('DEV-1: allows app.estalara.com in development', () => {
    vi.stubEnv('NODE_ENV', 'development');
    expect(resolveAllowOrigin('https://app.estalara.com')).toBe('https://app.estalara.com');
  });

  it('DEV-2: allows localhost:5173 in development', () => {
    vi.stubEnv('NODE_ENV', 'development');
    expect(resolveAllowOrigin('http://localhost:5173')).toBe('http://localhost:5173');
  });

  it('DEV-3: allows localhost:3000 in development', () => {
    vi.stubEnv('NODE_ENV', 'development');
    expect(resolveAllowOrigin('http://localhost:3000')).toBe('http://localhost:3000');
  });

  it('DEV-4: rejects evil.example.com in development', () => {
    vi.stubEnv('NODE_ENV', 'development');
    expect(resolveAllowOrigin('https://evil.example.com')).toBeNull();
  });

  it('returns null when requestOrigin is null', () => {
    vi.stubEnv('NODE_ENV', 'development');
    expect(resolveAllowOrigin(null)).toBeNull();
  });
});

// ─── buildCorsHeaders ─────────────────────────────────────────────────────────

describe('buildCorsHeaders', () => {
  it('HEADERS-1: includes Access-Control-Allow-Origin when origin is in allow-list', () => {
    vi.stubEnv('NODE_ENV', 'development');
    const headers = buildCorsHeaders('http://localhost:5173');
    expect(headers['Access-Control-Allow-Origin']).toBe('http://localhost:5173');
    expect(headers['Access-Control-Allow-Methods']).toContain('GET');
    expect(headers['Access-Control-Allow-Headers']).toContain('Authorization');
  });

  it('HEADERS-2: omits Access-Control-Allow-Origin when origin is not in allow-list', () => {
    vi.stubEnv('NODE_ENV', 'development');
    const headers = buildCorsHeaders('https://evil.example.com');
    expect(headers['Access-Control-Allow-Origin']).toBeUndefined();
  });

  it('HEADERS-3: merges extra headers', () => {
    vi.stubEnv('NODE_ENV', 'development');
    const headers = buildCorsHeaders('http://localhost:5173', { 'Cache-Control': 'no-store' });
    expect(headers['Cache-Control']).toBe('no-store');
    expect(headers['Access-Control-Allow-Origin']).toBe('http://localhost:5173');
  });
});

// ─── corsPreflightResponse ────────────────────────────────────────────────────

describe('corsPreflightResponse', () => {
  it('PREFLIGHT-1: returns 204 with CORS headers for an allowed origin', () => {
    vi.stubEnv('NODE_ENV', 'development');
    const res = corsPreflightResponse('http://localhost:5173');
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
    expect(res.headers.get('Access-Control-Max-Age')).toBe('86400');
  });

  it('PREFLIGHT-1: returns 204 with no Allow-Origin for a disallowed origin', () => {
    vi.stubEnv('NODE_ENV', 'development');
    const res = corsPreflightResponse('https://evil.example.com');
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('returns 204 with no Allow-Origin for localhost in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const res = corsPreflightResponse('http://localhost:5173');
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
});
