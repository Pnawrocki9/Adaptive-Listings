/**
 * Open-redirect guard for `/auth/callback?next=` (FOLLOW-1336).
 */
import { describe, expect, it } from 'vitest';

import { safeRedirectPath } from '../safe-redirect-path';

describe('safeRedirectPath', () => {
  it.each([
    ['/reset-password', '/reset-password'],
    ['/admin/tenants/abc?tab=1#x', '/admin/tenants/abc?tab=1#x'],
    ['/admin', '/admin'],
  ])('keeps the same-origin relative path %s', (input, expected) => {
    expect(safeRedirectPath(input)).toBe(expected);
  });

  it.each([
    ['absent', null],
    ['empty', ''],
    ['absolute https URL', 'https://evil.example'],
    ['absolute URL with path', 'https://evil.example/admin'],
    ['protocol-relative', '//evil.example'],
    ['protocol-relative with path', '//evil.example/admin'],
    ['backslash host', '/\\evil.example'],
    ['backslash anywhere', '/admin\\..\\evil'],
    ['double backslash', '\\\\evil.example'],
    ['tab inside the slashes', '/\t/evil.example'],
    ['newline inside the slashes', '/\n/evil.example'],
    ['javascript scheme', 'javascript:alert(1)'],
    ['no leading slash', 'evil.example'],
    ['relative traversal', '../evil'],
    ['leading space', ' //evil.example'],
  ])('refuses %s and falls back to /admin', (_label, input) => {
    expect(safeRedirectPath(input)).toBe('/admin');
  });
});
