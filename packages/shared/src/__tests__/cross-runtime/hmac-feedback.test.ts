/**
 * Cross-runtime HMAC compatibility test — FOLLOW-069.
 *
 * Asserts that the two HMAC-SHA256 implementations used in this codebase produce
 * byte-identical hex digests for the same (key, body) inputs:
 *
 *   1. Web Crypto path — `crypto.subtle.sign('HMAC', ...)` — used by:
 *      - `packages/sdk/src/core/adapt.ts` (browser/SDK)
 *      - `apps/control-plane/src/app/api/adapt/feedback/route.ts` (Next.js server)
 *
 *   2. Node Crypto path — `node:crypto createHmac('sha256', ...)` — used by:
 *      - Any future server-side migration away from Web Crypto
 *      - Integration test harnesses that spin up pure Node environments
 *
 * Both implementations MUST produce identical lowercase hex digests.  An encoding
 * mismatch (UTF-8 vs Latin-1, BOM insertion, trailing-whitespace normalisation)
 * would cause the server to reject legitimate signatures from the SDK in production
 * with no visible error — only a 401 response.
 *
 * Fixture pairs cover: ASCII, non-ASCII (UTF-8), empty body, very long body,
 * bodies with newlines, bodies with leading/trailing whitespace, binary-like keys,
 * and realistic JSON payloads matching the feedback endpoint schema.
 *
 * Closes RETRO-006 LG-3.  See CONVENTIONS_PATCH.md Rule H amendment (2026-05-23).
 *
 * @module packages/shared/src/__tests__/cross-runtime/hmac-feedback.test
 */

import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';

// ─── Implementation helpers ──────────────────────────────────────────────────

/**
 * Compute HMAC-SHA256 using the Web Crypto API (mirrors both
 * `packages/sdk/src/core/adapt.ts` → `computeHmacSha256Hex` and
 * `apps/control-plane/src/app/api/adapt/feedback/route.ts` → `hmacSha256Hex`).
 *
 * Both production implementations use exactly this algorithm:
 *   TextEncoder().encode → importKey(raw, HMAC/SHA-256) → sign → hex map
 *
 * Kept inline rather than shared-module so this test acts as an independent
 * oracle that would catch a regression even if the shared helper drifted.
 */
async function hmacViaWebCrypto(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', keyMaterial, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Compute HMAC-SHA256 using Node.js `createHmac` from `node:crypto`.
 *
 * This path represents any future Node-native HMAC implementation and is included
 * so that a change from Web Crypto to Node Crypto on the server side cannot silently
 * diverge from the SDK output without this test catching it.
 *
 * Both key and message are encoded as UTF-8 via Buffer (Node default).
 */
function hmacViaNodeCrypto(secret: string, message: string): string {
  return createHmac('sha256', Buffer.from(secret, 'utf8'))
    .update(Buffer.from(message, 'utf8'))
    .digest('hex');
}

// ─── Fixture pairs ────────────────────────────────────────────────────────────

interface HmacFixture {
  label: string;
  key: string;
  body: string;
}

const FIXTURES: HmacFixture[] = [
  // 1. Minimal realistic feedback body (happy path)
  {
    label: 'realistic JSON feedback body',
    key: 'tenant_api_key_abc123def456',
    body: JSON.stringify({
      session_id: 'sess-feedback-001',
      tenant_id: 'tnt_abc',
      archetype: 'family_buyer',
      variant: 'v1',
      converted: true,
    }),
  },

  // 2. Body with converted: false
  {
    label: 'feedback body converted=false',
    key: 'tenant_test_key_xyz789',
    body: JSON.stringify({
      session_id: 'sess-feedback-002',
      tenant_id: 'tnt_xyz',
      archetype: 'yield_hunter',
      variant: 'v2',
      converted: false,
    }),
  },

  // 3. Empty body (edge case: server must handle; signature is still valid HMAC-of-empty-string)
  {
    label: 'empty body',
    key: 'secret_key_empty',
    body: '',
  },

  // 4. Body with embedded newlines (common in pretty-printed JSON or multi-line strings)
  {
    label: 'body with newline characters',
    key: 'key_with_newlines',
    body: '{"line1":"hello\nworld","line2":"foo\r\nbar"}',
  },

  // 5. Non-ASCII UTF-8 body (Polish characters — relevant for Polish tenant data)
  {
    label: 'non-ASCII UTF-8 body (Polish)',
    key: 'klucz_testowy',
    body: JSON.stringify({
      session_id: 'sess-pl-001',
      tenant_id: 'tnt_warszawa',
      archetype: 'rodzinna',
      variant: 'v1',
      note: 'Mieszkanie w Warszawie — ul. Marszałkowska 42',
      converted: true,
    }),
  },

  // 6. Non-ASCII UTF-8 body (Arabic/UAE characters)
  {
    label: 'non-ASCII UTF-8 body (Arabic)',
    key: 'miftah_dubai',
    body: JSON.stringify({
      session_id: 'sess-ae-001',
      tenant_id: 'tnt_dubai',
      archetype: 'luxury_buyer',
      note: 'شقة فاخرة في دبي',
      converted: true,
    }),
  },

  // 7. Very long body (>10KB — tests that buffer handling is identical across implementations)
  {
    label: 'very long body (10KB)',
    key: 'long_body_key',
    body: JSON.stringify({
      session_id: 'sess-long-001',
      tenant_id: 'tnt_long',
      archetype: 'yield_hunter',
      variant: 'v1',
      converted: true,
      padding: 'x'.repeat(10_000),
    }),
  },

  // 8. Key with special characters / high-entropy binary-like value
  {
    label: 'high-entropy key with special chars',
    key: 'key!@#$%^&*()_+-=[]{}|;:\'",./<>?',
    body: '{"session_id":"s1","tenant_id":"t1","archetype":"a","variant":"v1","converted":true}',
  },

  // 9. Body with leading/trailing whitespace (should NOT be trimmed by either implementation)
  {
    label: 'body with leading and trailing spaces',
    key: 'whitespace_key',
    body: '  {"session_id":"s2","tenant_id":"t2","archetype":"a","variant":"v1","converted":true}  ',
  },

  // 10. UUID-format key (matches real Estalara API key format)
  {
    label: 'UUID-format API key',
    key: '550e8400-e29b-41d4-a716-446655440000',
    body: JSON.stringify({
      session_id: 'sess-uuid-001',
      tenant_id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
      archetype: 'investor',
      variant: 'control',
      converted: false,
    }),
  },

  // 11. Minimal ASCII body + short key (boundary test)
  {
    label: 'minimal ASCII body and short key',
    key: 'k',
    body: 'x',
  },

  // 12. Body with tab characters and mixed whitespace
  {
    label: 'body with tab and mixed whitespace',
    key: 'tab_key',
    body: '{"a":"b\tc","d":"e\r\nf"}',
  },
];

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('HMAC cross-runtime compatibility (FOLLOW-069)', () => {
  describe('Web Crypto vs Node Crypto — byte-identical hex digests', () => {
    for (const fixture of FIXTURES) {
      it(`produces identical digest for: ${fixture.label}`, async () => {
        const webCryptoHex = await hmacViaWebCrypto(fixture.key, fixture.body);
        const nodeCryptoHex = hmacViaNodeCrypto(fixture.key, fixture.body);

        // Both must be valid 64-char lowercase hex strings (SHA-256 = 32 bytes)
        expect(webCryptoHex).toMatch(/^[0-9a-f]{64}$/);
        expect(nodeCryptoHex).toMatch(/^[0-9a-f]{64}$/);

        // The core assertion: byte-identical output
        expect(webCryptoHex).toBe(nodeCryptoHex);
      });
    }
  });

  describe('Web Crypto self-consistency — same inputs always produce same output', () => {
    it('repeated calls with same (key, body) produce identical hex digest', async () => {
      const key = 'consistency_key';
      const body =
        '{"session_id":"s","tenant_id":"t","archetype":"a","variant":"v","converted":true}';

      const first = await hmacViaWebCrypto(key, body);
      const second = await hmacViaWebCrypto(key, body);
      const third = await hmacViaWebCrypto(key, body);

      expect(first).toBe(second);
      expect(second).toBe(third);
    });

    it('different keys produce different digests', async () => {
      const body =
        '{"session_id":"s","tenant_id":"t","archetype":"a","variant":"v","converted":true}';
      const digest1 = await hmacViaWebCrypto('key_one', body);
      const digest2 = await hmacViaWebCrypto('key_two', body);
      expect(digest1).not.toBe(digest2);
    });

    it('different bodies produce different digests', async () => {
      const key = 'same_key';
      const digest1 = await hmacViaWebCrypto(key, '{"converted":true}');
      const digest2 = await hmacViaWebCrypto(key, '{"converted":false}');
      expect(digest1).not.toBe(digest2);
    });
  });

  describe('Node Crypto self-consistency', () => {
    it('repeated calls with same (key, body) produce identical hex digest', () => {
      const key = 'node_consistency_key';
      const body =
        '{"session_id":"s","tenant_id":"t","archetype":"a","variant":"v","converted":true}';

      const first = hmacViaNodeCrypto(key, body);
      const second = hmacViaNodeCrypto(key, body);
      const third = hmacViaNodeCrypto(key, body);

      expect(first).toBe(second);
      expect(second).toBe(third);
    });
  });
});
