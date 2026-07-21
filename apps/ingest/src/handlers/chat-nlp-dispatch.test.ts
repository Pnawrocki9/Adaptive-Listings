/**
 * Unit tests for dispatchChatNlp — F-01 / ADR-0016 direct Modal chat-NLP invoke.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@sentry/cloudflare', () => ({
  captureException: vi.fn(),
}));

import * as Sentry from '@sentry/cloudflare';

import { dispatchChatNlp } from './chat-nlp-dispatch.js';

const ARGS = {
  tenant_id: 'tenant-abc',
  session_id: 's'.repeat(32),
  message_text: 'Looking for high yield',
  profiling_opt_out: false,
};

describe('dispatchChatNlp', () => {
  beforeEach(() => {
    vi.mocked(Sentry.captureException).mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('no-ops when MODAL_CHAT_NLP_URL is unset', async () => {
    const fetchMock = vi.fn();
    await dispatchChatNlp(ARGS, {}, fetchMock);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it('no-ops when message_text is empty', async () => {
    const fetchMock = vi.fn();
    await dispatchChatNlp(
      { ...ARGS, message_text: '  ' },
      { MODAL_CHAT_NLP_URL: 'https://modal.example/chat' },
      fetchMock,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('POSTs Bearer-auth JSON body to Modal URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 202 }));
    await dispatchChatNlp(
      { ...ARGS, profiling_opt_out: true },
      {
        MODAL_CHAT_NLP_URL: 'https://modal.example/chat',
        INTERNAL_API_SECRET: 'secret',
      },
      fetchMock,
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://modal.example/chat');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      'Content-Type': 'application/json',
      Authorization: 'Bearer secret',
    });
    expect(JSON.parse(init.body as string)).toEqual({
      tenant_id: 'tenant-abc',
      session_id: 's'.repeat(32),
      message: { role: 'user', content: 'Looking for high yield' },
      profiling_opt_out: true,
    });
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it('captures Sentry on HTTP rejection (Rule K.2)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('nope', { status: 500 }));
    await dispatchChatNlp(
      ARGS,
      { MODAL_CHAT_NLP_URL: 'https://modal.example/chat', INTERNAL_API_SECRET: 'secret' },
      fetchMock,
    );
    expect(Sentry.captureException).toHaveBeenCalledOnce();
    const [, extras] = vi.mocked(Sentry.captureException).mock.calls[0] as [
      Error,
      { tags: { kind: string } },
    ];
    expect(extras.tags.kind).toBe('dispatch_failed');
  });

  it('captures Sentry on network failure', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    await dispatchChatNlp(
      ARGS,
      { MODAL_CHAT_NLP_URL: 'https://modal.example/chat', INTERNAL_API_SECRET: 'secret' },
      fetchMock,
    );
    expect(Sentry.captureException).toHaveBeenCalledOnce();
    const [, extras] = vi.mocked(Sentry.captureException).mock.calls[0] as [
      Error,
      { tags: { kind: string } },
    ];
    expect(extras.tags.kind).toBe('network');
  });
});
