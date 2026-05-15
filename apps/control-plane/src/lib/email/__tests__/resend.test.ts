/**
 * Unit tests for the Resend email helper.
 *
 * The Resend SDK is fully mocked — no network calls are made.
 *
 * @module apps/control-plane/src/lib/email/__tests__/resend.test
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

// ─── Mock Resend SDK ──────────────────────────────────────────────────────────

const mockEmailsSend = vi.fn();

vi.mock('resend', () => {
  const MockResend = vi.fn().mockImplementation(() => ({
    emails: {
      send: mockEmailsSend,
    },
  }));
  return { Resend: MockResend };
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('sendEmail', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('calls client.emails.send() with correct args when RESEND_API_KEY is set', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_test_fake_key_12345678901234567890');
    mockEmailsSend.mockResolvedValueOnce({ id: 'msg_abc123' });

    const { sendEmail } = await import('../resend.js');
    await sendEmail({
      to: 'buyer@example.com',
      subject: 'Your data request',
      html: '<p>Code: 042813</p>',
    });

    expect(mockEmailsSend).toHaveBeenCalledOnce();
    expect(mockEmailsSend).toHaveBeenCalledWith({
      from: 'Estalara <noreply@estalara.com>',
      to: 'buyer@example.com',
      subject: 'Your data request',
      html: '<p>Code: 042813</p>',
    });
  });

  it('throws with message containing RESEND_API_KEY when env var is missing', async () => {
    vi.stubEnv('RESEND_API_KEY', '');

    const { sendEmail } = await import('../resend.js');
    await expect(
      sendEmail({ to: 'buyer@example.com', subject: 'Test', html: '<p>hi</p>' }),
    ).rejects.toThrow('RESEND_API_KEY');
  });

  it('uses DEFAULT_FROM when from is not provided', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_test_fake_key_12345678901234567890');
    mockEmailsSend.mockResolvedValueOnce({ id: 'msg_xyz999' });

    const { sendEmail } = await import('../resend.js');
    await sendEmail({
      to: 'someone@example.com',
      subject: 'Hello',
      html: '<p>hello</p>',
    });

    expect(mockEmailsSend).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'Estalara <noreply@estalara.com>' }),
    );
  });

  it('respects a custom from address when provided', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_test_fake_key_12345678901234567890');
    mockEmailsSend.mockResolvedValueOnce({ id: 'msg_custom' });

    const { sendEmail } = await import('../resend.js');
    await sendEmail({
      to: 'someone@example.com',
      subject: 'Custom from',
      html: '<p>hi</p>',
      from: 'Custom <custom@estalara.com>',
    });

    expect(mockEmailsSend).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'Custom <custom@estalara.com>' }),
    );
  });
});
