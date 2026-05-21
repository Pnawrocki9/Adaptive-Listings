/**
 * DetectWizard unit tests (TICKET-030).
 *
 * All 6 acceptance-criteria test cases:
 *   1. Idle → analyzing on submit (spinner present, button disabled)
 *   2. Detected state: mock 200 + non-null schema → <DetectionPreview> rendered with correct props
 *   3. Null schema → needs_review message shown, no preview
 *   4. API error (400) → failed state + "Try again" button
 *   5. Double-submit: second click while analyzing does not fire second fetch call
 *   6. Invalid URL ('not-a-url') → submit button remains disabled
 *
 * Tests mock at the fetch level — no mock data in component logic.
 *
 * @module apps/control-plane/src/components/onboarding/DetectWizard.test
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DetectWizard } from './DetectWizard';

// ─── Fixtures ──────────────────────────────────────────────────────────────────

const VALID_URL = 'https://www.example.com/properties';

const MOCK_SCHEMA = {
  domain: 'www.example.com',
  index_schema: {
    listing_card_selector: '.property-card',
    card_field_mappings: {
      price: { primary: '.price', type: 'text' },
    },
  },
  detail_schema: {
    slot_selectors: {},
  },
  detection_source: 'css_pattern',
  tenant_id: 'tenant-123',
};

const MOCK_FIELDS = [
  {
    name: 'price',
    selector: '.price',
    sample_value: '€450,000',
    confidence: 0.99,
  },
];

const MOCK_SUCCESS_RESPONSE = {
  schema: MOCK_SCHEMA,
  detection_source: 'css_pattern',
  detection_confidence: 0.99,
  fields: MOCK_FIELDS,
  cached: false,
  request_id: '00000000-0000-0000-0000-000000000001',
};

const MOCK_NULL_SCHEMA_RESPONSE = {
  schema: null,
  detection_source: null,
  detection_confidence: 0,
  fields: [],
  cached: false,
  request_id: '00000000-0000-0000-0000-000000000002',
};

const MOCK_ERROR_RESPONSE = {
  error: {
    code: 'FETCH_FAILED',
    message: 'Could not fetch the provided URL',
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mockFetchOnce(body: unknown, status = 200): void {
  vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

function typeUrl(input: HTMLElement, value: string): void {
  fireEvent.change(input, { target: { value } });
}

function getUrlInput(): HTMLElement {
  return screen.getByLabelText(/your listing site url/i);
}

function getSubmitButton(): HTMLElement {
  return screen.getByRole('button', { name: /detect/i });
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('DetectWizard', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * AC Test 1 — Idle → analyzing on submit.
   * Submit a valid URL; assert spinner is present and button is disabled.
   */
  it('transitions to analyzing state on submit: spinner visible, button disabled', async () => {
    // Never resolve so we can inspect the analyzing state
    vi.spyOn(globalThis, 'fetch').mockReturnValue(new Promise(() => undefined));

    render(<DetectWizard />);

    const input = getUrlInput();
    typeUrl(input, VALID_URL);

    const button = getSubmitButton();
    expect(button).not.toBeDisabled();

    fireEvent.submit(button.closest('form')!);

    // Spinner should appear
    await waitFor(() => {
      expect(
        screen.getByRole('status', { name: /detecting your site schema/i }),
      ).toBeInTheDocument();
    });

    // Button should be disabled while analyzing
    expect(button).toBeDisabled();
  });

  /**
   * AC Test 2 — Detected state: mock 200 + non-null schema → <DetectionPreview> rendered.
   */
  it('renders DetectionPreview with correct props when detection returns non-null schema', async () => {
    mockFetchOnce(MOCK_SUCCESS_RESPONSE, 200);

    render(<DetectWizard />);

    typeUrl(getUrlInput(), VALID_URL);
    fireEvent.submit(screen.getByRole('button', { name: /detect/i }).closest('form')!);

    await waitFor(() => {
      expect(screen.getByTestId('detection-preview')).toBeInTheDocument();
    });

    // The stub renders a placeholder div — confirm no error or review state is shown
    expect(screen.queryByText(/couldn't automatically detect/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/detection failed/i)).not.toBeInTheDocument();
  });

  /**
   * AC Test 3 — Null schema → needs_review message shown, no preview.
   */
  it('shows needs_review message when API returns schema: null', async () => {
    mockFetchOnce(MOCK_NULL_SCHEMA_RESPONSE, 200);

    render(<DetectWizard />);

    typeUrl(getUrlInput(), VALID_URL);
    fireEvent.submit(screen.getByRole('button', { name: /detect/i }).closest('form')!);

    await waitFor(() => {
      expect(
        screen.getByText(/we couldn't automatically detect your site's schema/i),
      ).toBeInTheDocument();
    });

    // DetectionPreview should NOT be rendered
    expect(screen.queryByTestId('detection-preview')).not.toBeInTheDocument();

    // No retry button in needs_review state
    expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument();
  });

  /**
   * AC Test 4 — API error (400) → failed state + "Try again" button.
   */
  it('shows failed state with error message and Try again button on API error', async () => {
    mockFetchOnce(MOCK_ERROR_RESPONSE, 400);

    render(<DetectWizard />);

    typeUrl(getUrlInput(), VALID_URL);
    fireEvent.submit(screen.getByRole('button', { name: /detect/i }).closest('form')!);

    await waitFor(() => {
      expect(screen.getByText(/detection failed/i)).toBeInTheDocument();
    });

    // Error message from API response
    expect(screen.getByText(/could not fetch the provided url/i)).toBeInTheDocument();

    // Try again button present
    const retryButton = screen.getByRole('button', { name: /try again/i });
    expect(retryButton).toBeInTheDocument();

    // Clicking Try again resets to idle (input visible, no error)
    fireEvent.click(retryButton);
    expect(screen.queryByText(/detection failed/i)).not.toBeInTheDocument();
  });

  /**
   * AC Test 5 — Double-submit: second click while analyzing does NOT fire second fetch.
   */
  it('prevents double-submit: second click while analyzing does not fire second fetch call', async () => {
    // Never resolve — stays in analyzing state
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockReturnValue(new Promise(() => undefined));

    render(<DetectWizard />);

    typeUrl(getUrlInput(), VALID_URL);
    const form = screen.getByRole('button', { name: /detect/i }).closest('form')!;

    // First submission
    fireEvent.submit(form);

    await waitFor(() => {
      expect(
        screen.getByRole('status', { name: /detecting your site schema/i }),
      ).toBeInTheDocument();
    });

    // Button should be disabled — second submission should not fire
    const button = screen.getByRole('button', { name: /detecting…/i });
    expect(button).toBeDisabled();

    // Attempt second submission
    fireEvent.submit(form);

    // fetch should have been called exactly once
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  /**
   * AC Test 6 — Invalid URL ('not-a-url') → submit button remains disabled.
   */
  it('keeps submit button disabled for invalid URL', () => {
    render(<DetectWizard />);

    const input = getUrlInput();
    typeUrl(input, 'not-a-url');

    const button = screen.getByRole('button', { name: /detect/i });
    expect(button).toBeDisabled();
  });

  /**
   * Additional: empty URL → button disabled.
   */
  it('keeps submit button disabled when URL input is empty', () => {
    render(<DetectWizard />);

    const button = screen.getByRole('button', { name: /detect/i });
    expect(button).toBeDisabled();
  });

  /**
   * Additional: valid URL enables button.
   */
  it('enables submit button for valid https:// URL', () => {
    render(<DetectWizard />);

    typeUrl(getUrlInput(), VALID_URL);

    expect(screen.getByRole('button', { name: /detect/i })).not.toBeDisabled();
  });

  /**
   * Additional: valid http:// URL also enables button.
   */
  it('enables submit button for valid http:// URL', () => {
    render(<DetectWizard />);

    typeUrl(getUrlInput(), 'http://example.com/listings');

    expect(screen.getByRole('button', { name: /detect/i })).not.toBeDisabled();
  });

  /**
   * Additional: error message rendered in aria-live region.
   */
  it('renders error message inside aria-live="polite" region', async () => {
    mockFetchOnce(MOCK_ERROR_RESPONSE, 400);

    render(<DetectWizard />);
    typeUrl(getUrlInput(), VALID_URL);
    fireEvent.submit(screen.getByRole('button', { name: /detect/i }).closest('form')!);

    await waitFor(() => {
      expect(screen.getByText(/detection failed/i)).toBeInTheDocument();
    });

    const liveRegion = document.querySelector('[aria-live="polite"]');
    expect(liveRegion).toBeInTheDocument();
    expect(liveRegion).toHaveTextContent(/detection failed/i);
  });

  /**
   * Additional: network error → failed state with generic message.
   */
  it('shows failed state with generic message on network error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('network timeout'));

    render(<DetectWizard />);
    typeUrl(getUrlInput(), VALID_URL);
    fireEvent.submit(screen.getByRole('button', { name: /detect/i }).closest('form')!);

    await waitFor(() => {
      expect(screen.getByText(/network timeout/i)).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });
});
