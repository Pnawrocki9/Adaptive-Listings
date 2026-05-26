/**
 * DetectionPreview unit tests (TICKET-AUTO-006-POLISH).
 *
 * All 5 required test cases from the spec:
 *   1. Field table renders all 3 fields with correct name/selector/confidence badge class
 *   2. Null sample_value → shows "—"
 *   3. Copy button calls navigator.clipboard.writeText with string containing data-api-key
 *   4. Save & Activate → button disabled + spinner before mocked API resolves
 *   5. Snippet shown after activation with mocked { api_key, tenant_id }
 *
 * @module apps/control-plane/src/components/onboarding/DetectionPreview.test
 */

import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DetectionPreview, buildSnippet } from './DetectionPreview';
import type { DetectionPreviewProps } from './DetectionPreview';
import type { TenantSiteSchema } from '@estalara/shared';
import { CONTROL_PLANE_URL } from '@estalara/shared';

// ─── Fixtures ──────────────────────────────────────────────────────────────────

const MOCK_SCHEMA: TenantSiteSchema = {
  tenant_id: 'tenant-abc',
  domain: 'example.com',
  detected_at: '2026-01-01T00:00:00Z',
  detection_source: 'data_estalara',
  detection_confidence: 0.99,
  index_schema: {
    url_patterns: ['https://example.com/**'],
    listing_card_selector: '[data-estalara-listing]',
    card_field_mappings: {},
    data_extractors_per_card: {},
    reorder_capable: false,
  },
  detail_schema: {
    url_patterns: ['https://example.com/listing/*'],
    slot_selectors: {},
    data_extractors: {},
  },
  archetype_hints: [],
};

const MOCK_FIELDS = [
  { name: 'price', selector: '.price', sample_value: '€450,000', confidence: 0.99 },
  { name: 'headline', selector: '.headline', sample_value: 'Luxury Villa', confidence: 0.75 },
  { name: 'bedrooms', selector: '.beds', sample_value: null, confidence: 0.45 },
];

const BASE_PROPS: DetectionPreviewProps = {
  schema: MOCK_SCHEMA,
  fields: MOCK_FIELDS,
  detection_source: 'data_estalara',
  detection_confidence: 0.99,
  tenantId: 'tenant-abc',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mockFetchActivate(body: unknown, status = 200): void {
  vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('DetectionPreview', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // ── Test 1: Field table renders all 3 fields ─────────────────────────────

  it('renders all 3 fields with correct name, selector, and confidence badge class', () => {
    render(<DetectionPreview {...BASE_PROPS} />);

    // All three field names in the table
    expect(screen.getByText('price')).toBeInTheDocument();
    expect(screen.getByText('headline')).toBeInTheDocument();
    expect(screen.getByText('bedrooms')).toBeInTheDocument();

    // Selectors
    expect(screen.getByText('.price')).toBeInTheDocument();
    expect(screen.getByText('.headline')).toBeInTheDocument();
    expect(screen.getByText('.beds')).toBeInTheDocument();

    // Confidence badges — verify the badge colour classes
    const badges = document.querySelectorAll('[data-confidence]');
    expect(badges).toHaveLength(3);

    // price: 0.99 → green
    const priceBadge = document.querySelector('[data-confidence="0.99"]');
    expect(priceBadge).toHaveClass('bg-green-100');

    // headline: 0.75 → yellow
    const headlineBadge = document.querySelector('[data-confidence="0.75"]');
    expect(headlineBadge).toHaveClass('bg-yellow-100');

    // bedrooms: 0.45 → red
    const bedroomsBadge = document.querySelector('[data-confidence="0.45"]');
    expect(bedroomsBadge).toHaveClass('bg-red-100');
  });

  // ── Test 2: Null sample_value shows "—" ──────────────────────────────────

  it('shows "—" in the Sample Value column when sample_value is null', () => {
    render(<DetectionPreview {...BASE_PROPS} />);

    // The bedrooms field has sample_value: null — should display "—"
    expect(screen.getByText('—')).toBeInTheDocument();

    // price field should show its sample value, not "—"
    expect(screen.getByText('€450,000')).toBeInTheDocument();
  });

  // ── Test 3: Copy button calls clipboard API ───────────────────────────────

  it('copy button calls navigator.clipboard.writeText with string containing data-api-key', async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: writeTextMock },
      writable: true,
      configurable: true,
    });

    mockFetchActivate({ api_key: 'est_pub_test123', tenant_id: 'tenant-abc' });

    render(<DetectionPreview {...BASE_PROPS} />);

    // Activate first so the snippet is shown
    const activateBtn = screen.getByRole('button', { name: /save & activate/i });
    act(() => {
      fireEvent.click(activateBtn);
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /copy snippet/i })).toBeInTheDocument();
    });

    // Click copy button
    const copyBtn = screen.getByRole('button', { name: /copy snippet/i });
    act(() => {
      fireEvent.click(copyBtn);
    });

    expect(writeTextMock).toHaveBeenCalledOnce();
    const copiedText = writeTextMock.mock.calls[0]?.[0] as string;
    expect(typeof copiedText).toBe('string');
    expect(copiedText).toContain('data-api-key');
    expect(copiedText).toContain('est_pub_test123');
  });

  // ── Test 4: Save & Activate → button disabled + spinner ──────────────────

  it('disables Save & Activate button and shows spinner while activation is in-flight', async () => {
    // Never resolve — stays in-flight
    vi.spyOn(globalThis, 'fetch').mockReturnValue(new Promise(() => undefined));

    render(<DetectionPreview {...BASE_PROPS} />);

    const activateBtn = screen.getByRole('button', { name: /save & activate/i });
    expect(activateBtn).not.toBeDisabled();

    fireEvent.click(activateBtn);

    // Button should be disabled while in-flight
    await waitFor(() => {
      expect(activateBtn).toBeDisabled();
    });

    // Spinner SVG should be present
    expect(activateBtn.querySelector('svg')).toBeInTheDocument();

    // Button text changes to "Activating…"
    expect(screen.getByText(/activating/i)).toBeInTheDocument();
  });

  // ── Test 5: Snippet shown after activation ────────────────────────────────

  it('renders SDK snippet containing data-api-key after successful activation', async () => {
    mockFetchActivate({ api_key: 'est_pub_test123', tenant_id: 'uuid-abc' });

    render(<DetectionPreview {...BASE_PROPS} />);

    const activateBtn = screen.getByRole('button', { name: /save & activate/i });
    act(() => {
      fireEvent.click(activateBtn);
    });

    await waitFor(() => {
      expect(screen.getByText(/data-api-key="est_pub_test123"/)).toBeInTheDocument();
    });

    // The code block should also contain the tenant ID
    expect(screen.getByText(/data-tenant-id="uuid-abc"/)).toBeInTheDocument();

    // Save & Activate button should no longer be visible (replaced by snippet)
    expect(screen.queryByRole('button', { name: /save & activate/i })).not.toBeInTheDocument();
  });

  // ── Additional: header summary rendering ─────────────────────────────────

  it('renders header with humanised source and confidence percentage', () => {
    render(<DetectionPreview {...BASE_PROPS} />);

    expect(screen.getByText('data-estalara')).toBeInTheDocument();
    expect(screen.getByText('99% confidence')).toBeInTheDocument();
  });

  it('humanises ai_vision source as "AI Vision"', () => {
    render(<DetectionPreview {...BASE_PROPS} detection_source="ai_vision" />);
    expect(screen.getByText('AI Vision')).toBeInTheDocument();
  });

  it('humanises json_ld source as "JSON-LD"', () => {
    render(<DetectionPreview {...BASE_PROPS} detection_source="json_ld" />);
    expect(screen.getByText('JSON-LD')).toBeInTheDocument();
  });

  // ── Additional: activation error shows inline message ────────────────────

  it('shows inline error message when activation API returns non-2xx', async () => {
    mockFetchActivate({ error: { message: 'Database connection failed' } }, 500);

    render(<DetectionPreview {...BASE_PROPS} />);

    const activateBtn = screen.getByRole('button', { name: /save & activate/i });
    act(() => {
      fireEvent.click(activateBtn);
    });

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    expect(screen.getByRole('alert')).toHaveTextContent('Database connection failed');

    // Button should be re-enabled after error
    expect(activateBtn).not.toBeDisabled();
  });

  // ── Additional: copy button shows "Copied!" then resets ──────────────────

  it('copy button text changes to "Copied!" for 2 seconds then resets', async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: writeTextMock },
      writable: true,
      configurable: true,
    });

    mockFetchActivate({ api_key: 'est_pub_test123', tenant_id: 'tenant-abc' });

    render(<DetectionPreview {...BASE_PROPS} />);

    // Activate with real timers so fetch Promises resolve normally
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /save & activate/i }));
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /copy snippet/i })).toBeInTheDocument();
    });

    // Switch to fake timers now (only for the setTimeout in handleCopy)
    vi.useFakeTimers();

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /copy snippet/i }));
    });

    // navigator.clipboard.writeText returns a resolved Promise; flush microtasks
    await act(async () => {
      await Promise.resolve();
    });

    // Immediately after click: shows "Copied!"
    expect(screen.getByRole('button', { name: /copied!/i })).toBeInTheDocument();

    // After 2 seconds: resets to "Copy snippet"
    act(() => {
      vi.advanceTimersByTime(2100);
    });

    expect(screen.getByRole('button', { name: /copy snippet/i })).toBeInTheDocument();

    vi.useRealTimers();
  }, 10000);

  // ── FOLLOW-105 §F.1 — buildSnippet emits the canonical data-decision-url ──
  describe('buildSnippet — FOLLOW-105 canonical /api/adapt enforcement', () => {
    const TENANT = '550e8400-e29b-41d4-a716-446655440000';
    const KEY = 'est_pub_test123';

    it('emits data-tenant-id, data-api-key, AND data-decision-url', () => {
      const snippet = buildSnippet(TENANT, KEY);
      expect(snippet).toContain(`data-tenant-id="${TENANT}"`);
      expect(snippet).toContain(`data-api-key="${KEY}"`);
      expect(snippet).toContain('data-decision-url=');
    });

    it('data-decision-url ends with "/api" so the SDK-appended "/adapt" yields "/api/adapt"', () => {
      const snippet = buildSnippet(TENANT, KEY);
      const match = /data-decision-url="([^"]+)"/.exec(snippet);
      expect(match).not.toBeNull();
      const url = match?.[1] ?? '';
      expect(url.endsWith('/api')).toBe(true);
      // The SDK appends "/adapt" (core/adapt.ts) → canonical control-plane endpoint.
      expect(`${url}/adapt`).toBe(`${CONTROL_PLANE_URL}/api/adapt`);
      expect(`${url}/adapt`).toBe('https://admin.estalara.com/api/adapt');
    });

    it('data-decision-url is an ABSOLUTE control-plane URL (not a relative path)', () => {
      const snippet = buildSnippet(TENANT, KEY);
      const match = /data-decision-url="([^"]+)"/.exec(snippet);
      const url = match?.[1] ?? '';
      // Absolute https:// — a relative "/api" would resolve against the TENANT's
      // own domain when the snippet is embedded externally, silently misrouting
      // adapt requests. [FOLLOW-105 §F.1 / §F.2]
      expect(url.startsWith('https://')).toBe(true);
      expect(url.startsWith('/')).toBe(false);
      // Must NOT name the deprecated Cloudflare Worker.
      expect(url).not.toContain('decision.estalara.com');
    });
  });

  // ── FOLLOW-114 — buildSnippet emits data-inquiry-submit-selector ──────────
  describe('buildSnippet — FOLLOW-114 inquiry_submit_selector in snippet', () => {
    const TENANT = '550e8400-e29b-41d4-a716-446655440000';
    const KEY = 'est_pub_test123';
    const SELECTOR = "[data-estalara-slot='inquiry-submit']";

    it('includes data-inquiry-submit-selector when selector is provided', () => {
      const snippet = buildSnippet(TENANT, KEY, SELECTOR);
      expect(snippet).toContain('data-inquiry-submit-selector="' + SELECTOR + '"');
    });

    it('omits data-inquiry-submit-selector when called with two args (no selector)', () => {
      const snippet = buildSnippet(TENANT, KEY);
      expect(snippet).not.toContain('data-inquiry-submit-selector');
    });

    it('omits data-inquiry-submit-selector when selector is null', () => {
      const snippet = buildSnippet(TENANT, KEY, null);
      expect(snippet).not.toContain('data-inquiry-submit-selector');
    });

    it('omits data-inquiry-submit-selector when selector is undefined (explicit)', () => {
      const snippet = buildSnippet(TENANT, KEY, undefined);
      expect(snippet).not.toContain('data-inquiry-submit-selector');
    });
  });

  // ── FOLLOW-114 — DetectionPreview threads schema.inquiry_submit_selector ──
  describe('DetectionPreview — FOLLOW-114 snippet includes inquiry selector from schema', () => {
    it('renders snippet with data-inquiry-submit-selector when schema has inquiry_submit_selector', async () => {
      const schemaWithSelector: TenantSiteSchema = {
        ...MOCK_SCHEMA,
        inquiry_submit_selector: "[data-estalara-slot='inquiry-submit']",
      };
      mockFetchActivate({ api_key: 'est_pub_key1', tenant_id: 'tid-1' });

      render(<DetectionPreview {...BASE_PROPS} schema={schemaWithSelector} />);

      act(() => {
        fireEvent.click(screen.getByRole('button', { name: /save & activate/i }));
      });

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /copy snippet/i })).toBeInTheDocument();
      });

      // The pre/code block must contain the inquiry selector attribute.
      // Use a regex to match across the rendered text nodes.
      const codeEl = document.querySelector('code');
      expect(codeEl?.textContent).toContain('data-inquiry-submit-selector=');
      expect(codeEl?.textContent).toContain("[data-estalara-slot='inquiry-submit']");
    });

    it('renders snippet WITHOUT data-inquiry-submit-selector when schema has inquiry_submit_selector as null', async () => {
      const schemaWithoutSelector: TenantSiteSchema = {
        ...MOCK_SCHEMA,
        inquiry_submit_selector: null,
      };
      mockFetchActivate({ api_key: 'est_pub_key2', tenant_id: 'tid-2' });

      render(<DetectionPreview {...BASE_PROPS} schema={schemaWithoutSelector} />);

      act(() => {
        fireEvent.click(screen.getByRole('button', { name: /save & activate/i }));
      });

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /copy snippet/i })).toBeInTheDocument();
      });

      const codeEl = document.querySelector('code');
      expect(codeEl?.textContent).not.toContain('data-inquiry-submit-selector');
    });

    it('renders snippet WITHOUT data-inquiry-submit-selector when schema has no inquiry_submit_selector field', async () => {
      // MOCK_SCHEMA has no inquiry_submit_selector — field is absent
      mockFetchActivate({ api_key: 'est_pub_key3', tenant_id: 'tid-3' });

      render(<DetectionPreview {...BASE_PROPS} />);

      act(() => {
        fireEvent.click(screen.getByRole('button', { name: /save & activate/i }));
      });

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /copy snippet/i })).toBeInTheDocument();
      });

      const codeEl = document.querySelector('code');
      expect(codeEl?.textContent).not.toContain('data-inquiry-submit-selector');
    });
  });
});
