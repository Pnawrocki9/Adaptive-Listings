/**
 * FOLLOW-1459 (resolves FOLLOW-1453): `feature` and `cta` copy must fit the element it fills.
 *
 * `feature` fills a section heading and was served whole paragraphs. `cta` fills a button that only
 * opens a message thread to the agent and was served "Request the investment pack". Each refusal is
 * of the slot: the seller's copy stands there and the other slots of the batch are served (ESC-076,
 * `slotRefusal`). The recorded texts are the ones served live on 2026-11-02.
 *
 * @module apps/control-plane/src/lib/__tests__/llm-gateway.follow1459.test
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@anthropic-ai/sdk', () => {
  const mockCreate = vi.fn();
  const MockAnthropic = vi.fn(() => ({ messages: { create: mockCreate } }));
  (MockAnthropic as unknown as Record<string, unknown>).__mockCreate = mockCreate;
  return { default: MockAnthropic };
});

import Anthropic from '@anthropic-ai/sdk';

const mockCreate = (Anthropic as unknown as { __mockCreate: ReturnType<typeof vi.fn> })
  .__mockCreate;

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const { callLlmGateway } = await import('@/lib/llm-gateway');
const { checkSlotFit } = await import('@/lib/ungrounded-directives');
const { getPlaybook, getAllPlaybooks } = await import('@estalara/shared/playbooks');

const RECORDED_PARAGRAPH =
  'Palm Coast has seen steady population growth and strong seasonal rental demand. This ' +
  'low-maintenance, move-in-ready home in this price band rents and resells well, on a quiet ' +
  'cul-de-sac minutes from I-95.';

describe('checkSlotFit: feature is a short section label', () => {
  it.each(['Investment Performance', 'Why Upgrade', 'Dla rodziny — najważniejsze', 'a'.repeat(40)])(
    'accepts %s',
    (value) => {
      expect(checkSlotFit('feature', value)).toBeNull();
    },
  );

  it.each([
    RECORDED_PARAGRAPH,
    'a'.repeat(41),
    'Rents and resells well.',
    'Quiet street. Close to I-95',
    'Why upgrade?',
    'Is this the one? Yes',
    'Line one\nLine two',
    'Line one\r\nLine two',
    'Line one\u2028Line two',
    // Fails safe: a heading that happens to hold an abbreviation (left refused on purpose).
    "St. Mary's Quarter",
  ])('refuses %s', (value) => {
    expect(checkSlotFit('feature', value)).toBe('feature_not_a_label');
  });
});

describe('checkSlotFit: cta says what the button does', () => {
  it.each([
    'Request the investment pack',
    'Request the full financial details',
    'Download Expat Relocation Guide',
    'Get the brochure',
    'See the rental report',
    'Send me the documents',
    'Get the PDF',
    // The shapes the review got past the first list.
    'Request the guidebook',
    'Get the prospectus',
    'See the factsheet',
    'See the fact sheet',
    'Open the rental calculator',
    'Request a financial summary',
    'Request the downloadable pack',
    // Normalised before matching: NBSP, other spaces and decomposed accents.
    'Request\u00a0the\u00a0pack',
    'financial\u00a0details',
    'financial\n  details',
    'Ver la gui\u0301a',
    // Asking about something is fine; asking and getting it is not.
    'Ask about returns and get the guide',
    'Ask the agent about this home and download the brochure',
    'Ask for the guide',
    // PL, inflected
    'Otrzymaj dosier inwestycyjny',
    'Pobierz materiały',
    'Zobacz zestawienie kosztów',
    'Otwórz kalkulator najmu',
    'Zamów analizę rentowności',
    'Pobierz poradnik dla rodzin',
    'Zamów pakiet inwestycyjny',
    'Poproś o broszurę',
    'Zobacz raport najmu',
    'Otrzymaj dokumenty',
    'Poproś o szczegóły finansowe',
    'Przejrzyj przewodnik',
    // ES, with and without the accent
    'Descarga la guía para familias',
    'Descargar la guia',
    'Solicita el dossier',
    'Pide el folleto',
    'Recibe el informe de rentabilidad',
    'Solicita los documentos',
    'Ver los detalles financieros',
    'Pide el paquete de inversión',
    'Solicita el dosier',
    'Solicita la ficha',
    'Ver el catálogo',
    'Ver el catalogo',
    'Solicita la información financiera',
    'Solicita la informacion financiera',
  ])('refuses %s', (value) => {
    expect(checkSlotFit('cta', value)).toBe('cta_promises_deliverable');
  });

  it.each([
    'Ask the agent about this home',
    'Message the agent',
    'Book a Viewing',
    'Request Private Viewing',
    'Zapytaj agenta o tę nieruchomość',
    'Pregunta al agente sobre esta vivienda',
    // A stem inside a longer word is no promise.
    'Ask about the backpacking trails',
    'Ask about the reporter',
    // A question to the agent, whatever it names: the button does exactly that.
    'Ask about the lease documents',
    'Ask the agent about the financial details',
    'Zapytaj o szczegóły umowy najmu i dokumentację lokalu',
    'Pregunta al agente sobre la ficha del local',
  ])('accepts %s', (value) => {
    expect(checkSlotFit('cta', value)).toBeNull();
  });

  // Known false positives, left refused: they fail safe, the seller's copy stands. Pinned so a change
  // of the list shows up here.
  it.each([
    'Let the agent guide you',
    'Message the agent about the lease documents',
    'Zobacz materiały wykończeniowe',
    'Ask about the documents to see',
  ])('still refuses %s', (value) => {
    expect(checkSlotFit('cta', value)).toBe('cta_promises_deliverable');
  });

  it('family wording is not what it reads (ESC-089)', () => {
    expect(checkSlotFit('cta', 'Ask the agent about family life here')).toBeNull();
    expect(checkSlotFit('feature', 'Family Essentials')).toBeNull();
  });

  it('no other slot is read', () => {
    expect(checkSlotFit('headline', RECORDED_PARAGRAPH)).toBeNull();
    expect(checkSlotFit('headline', 'Request the investment pack')).toBeNull();
  });
});

describe('every shipped playbook string fits its slot', () => {
  const rows = [...getAllPlaybooks().values()].flatMap((p) =>
    p.slots
      .filter((s) => s.slot === 'cta' || s.slot === 'feature')
      .flatMap((s) =>
        [s.en, s.pl, s.es, ...Object.values(s.variants ?? {}).flat()]
          .filter((v): v is string => typeof v === 'string')
          .map((value) => [p.archetype, s.slot, value] as const),
      ),
  );

  it('reads a real population', () => {
    expect(rows.length).toBeGreaterThanOrEqual(34);
  });

  it.each(rows)('%s %s: %s', (_archetype, slot, value) => {
    expect(checkSlotFit(slot, value)).toBeNull();
  });
});

describe('the gateway refuses the slot and serves the rest', () => {
  const PLAYBOOK = getPlaybook('yield_hunter');
  const INPUT = {
    archetypeId: 'yield_hunter' as const,
    confidence: 0.75,
    similarity: 0.75,
    basePlaybook: PLAYBOOK,
    listingContext: {
      headline: 'Sunlit apartment with river views',
      description: 'A calm, well-connected home in the old town.',
      location: 'Alfama, Lisbon',
    } as Record<string, string>,
  };
  const reply = (...pairs: [string, string][]) => ({
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(
          pairs.map(([slot, value]) => ({
            type: 'text',
            slot,
            value,
            archetype: 'yield_hunter',
            confidence: 0.8,
          })),
        ),
      },
    ],
    usage: { input_tokens: 150, output_tokens: 50 },
  });

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ANTHROPIC_API_KEY = 'test-key-follow-1459';
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: [{ total: '0' }] }),
    });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('a paragraph in feature and a pack in cta go; the grounded headline stays, unjudged', async () => {
    mockCreate.mockResolvedValueOnce(
      reply(
        ['headline', 'Sunlit apartment with river views'],
        // Fully grounded and still no heading: the fit rule alone refuses it.
        ['feature', 'A calm, well-connected home in the old town, with river views.'],
        ['cta', 'Request the investment pack'],
      ),
    );
    const result = await callLlmGateway(INPUT);
    expect(result?.directives.map((d) => d.slot)).toEqual(['headline']);
    // The fit verdict is deterministic and final: no judge round trip for either slot.
    expect(mockCreate).toHaveBeenCalledTimes(1);
    const warned = (console.warn as unknown as ReturnType<typeof vi.fn>).mock.calls
      .flat()
      .join(' ');
    expect(warned).toContain('feature_not_a_label');
    expect(warned).toContain('cta_promises_deliverable');
  });

  it('only unfit slots in the batch: the request is refused as any all-refused batch', async () => {
    const reasons: string[] = [];
    mockCreate.mockResolvedValueOnce(reply(['cta', 'Download the guide']));
    const result = await callLlmGateway({ ...INPUT, onFallback: (r: string) => reasons.push(r) });
    expect(result).toBeNull();
    expect(reasons).toEqual(['fact_check_refused']);
  });

  it.each([
    ['tweak', 0.75],
    ['full', 0.5],
  ])('the %s prompt tells the model both rules', async (_band, similarity) => {
    mockCreate.mockResolvedValueOnce(reply(['headline', 'Sunlit apartment with river views']));
    await callLlmGateway({ ...INPUT, similarity });
    const prompt = JSON.stringify(mockCreate.mock.calls[0]?.[0]);
    expect(prompt).toContain('at most 40 characters');
    expect(prompt).toContain('opens a message thread to the listing agent');
    expect(prompt).toMatch(/never promise a download, guide, pack, brochure, report, document/i);
  });
});
