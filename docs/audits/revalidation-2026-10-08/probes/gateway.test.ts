// Uses the real gateway and guards; only provider, telemetry and global model configuration are replaced.
import { it, expect, vi, beforeEach } from 'vitest';
const { create } = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create };
  },
}));
vi.mock('@/lib/global-config-store', () => ({
  getGlobalGenerationModel: () => Promise.resolve('claude-sonnet-4-6'),
}));
vi.mock('@/lib/after-response', () => ({ afterResponse: () => undefined }));
vi.mock('@sentry/nextjs', () => ({ captureMessage: vi.fn() }));
import { callLlmGateway } from '../../../../apps/control-plane/src/lib/llm-gateway';
import { getPlaybook } from '../../../../packages/sdk/src/core/playbooks';

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('Unexpected transport: audit is offline');
    }),
  );
  create.mockReset();
  vi.stubEnv('ANTHROPIC_API_KEY', 'local-fixture-no-network');
  vi.stubEnv('CLICKHOUSE_URL', '');
});
const input = {
  archetypeId: 'yield_hunter' as const,
  confidence: 0.8,
  similarity: 0.7,
  basePlaybook: getPlaybook('yield_hunter'),
  listingContext: {
    listing_title: 'apartment',
    listing_description: 'an apartment with no pool',
    listing_price: '400000',
  },
};
for (const text of [
  'private pool and sea view',
  'guaranteed rental income and planning permission',
  '400000 square metres',
]) {
  it(`F-02 actual gateway accepts unsupported assertion: ${text}`, async () => {
    create.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify([
            {
              type: 'text',
              slot: 'headline',
              value: text,
              archetype: 'yield_hunter',
              confidence: 0.8,
            },
          ]),
        },
      ],
      usage: { input_tokens: 30, output_tokens: 20 },
    });
    expect((await callLlmGateway(input))?.directives[0]?.value).toBe(text);
    expect(create).toHaveBeenCalledTimes(1);
  });
}
it('F-02 negative control: absent numeric token is rejected', async () => {
  create.mockResolvedValue({
    content: [
      {
        type: 'text',
        text: JSON.stringify([
          {
            type: 'text',
            slot: 'headline',
            value: '9.9% yield',
            archetype: 'yield_hunter',
            confidence: 0.8,
          },
        ]),
      },
    ],
    usage: { input_tokens: 30, output_tokens: 20 },
  });
  expect(await callLlmGateway(input)).toBeNull();
});
