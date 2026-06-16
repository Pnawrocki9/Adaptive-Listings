/**
 * Unit tests for clickhouse-http.ts — the shared ClickHouse Basic-auth helper.
 *
 * Coverage:
 *   CH-H-1: clickhouseAuthHeaders — returns empty object when password is empty
 *   CH-H-2: clickhouseAuthHeaders — returns Authorization: Basic base64("user:password")
 *   CH-H-3: clickhouseAuthHeaders — default user 'default' produces base64("default:password")
 *   CH-H-4: clickhouseAuthHeaders — custom user included before colon (not empty-username bug)
 *
 * Root cause documented: previously all 12 control-plane sites built
 * `Buffer.from(`:${password}`)` — empty username — which ClickHouse Cloud
 * rejects with Code 516 AUTHENTICATION_FAILED. The fix requires the username
 * before the colon: `Buffer.from(`${user}:${password}`)`.
 *
 * @module apps/control-plane/src/lib/clickhouse-http.test
 */

import { describe, expect, it } from 'vitest';
import { clickhouseAuthHeaders } from './clickhouse-http';

describe('clickhouseAuthHeaders', () => {
  it('CH-H-1: returns empty object when password is empty', () => {
    const headers = clickhouseAuthHeaders({ user: 'ingest_worker', password: '' });
    expect(headers).toEqual({});
  });

  it('CH-H-2: returns Authorization header with user:password encoded in base64', () => {
    const headers = clickhouseAuthHeaders({ user: 'ingest_worker', password: 'mysecret' });
    expect(headers.Authorization).toMatch(/^Basic /);

    const decoded = Buffer.from(headers.Authorization!.replace('Basic ', ''), 'base64').toString(
      'utf-8',
    );
    expect(decoded).toBe('ingest_worker:mysecret');
  });

  it('CH-H-3: default user "default" produces base64("default:password")', () => {
    const headers = clickhouseAuthHeaders({ user: 'default', password: 'pw' });
    const decoded = Buffer.from(headers.Authorization!.replace('Basic ', ''), 'base64').toString(
      'utf-8',
    );
    expect(decoded).toBe('default:pw');
  });

  it('CH-H-4: username appears BEFORE the colon — not the empty-username bug', () => {
    // Regression guard: the old pattern was Buffer.from(`:${password}`) — empty
    // username before colon — which ClickHouse Cloud rejects (Code 516).
    const headers = clickhouseAuthHeaders({ user: 'ingest_worker', password: 'pw' });
    const decoded = Buffer.from(headers.Authorization!.replace('Basic ', ''), 'base64').toString(
      'utf-8',
    );
    // Must NOT start with ':' (that would be the empty-username form)
    expect(decoded.startsWith(':')).toBe(false);
    // Must be in user:password form
    expect(decoded).toMatch(/^[^:]+:.+$/);
  });
});
