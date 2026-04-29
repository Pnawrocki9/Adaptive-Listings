/**
 * Smoke tests for @estalara/platform-templates placeholder.
 *
 * Tests verify:
 * 1. matchPlatform returns null for empty input (placeholder behavior)
 * 2. matchPlatform returns null for unmatched hostname
 * 3. templates array is accessible and empty
 * 4. Zod schemas are correctly exported and validate types
 */

import { describe, expect, it } from 'vitest';

import {
  HostnameMatcherSchema,
  MatchResultSchema,
  PlatformTemplateSchema,
  SelectorSchema,
  matchPlatform,
  templates,
} from '../src/index.js';

describe('@estalara/platform-templates', () => {
  describe('matchPlatform', () => {
    it('returns null for empty html', () => {
      const result = matchPlatform('https://example.com', '<html></html>');
      expect(result).toBeNull();
    });

    it('returns null for unmatched hostname', () => {
      const result = matchPlatform(
        'https://unknown-platform.com',
        '<html><body>Some content</body></html>',
      );
      expect(result).toBeNull();
    });

    it('returns null for empty input', () => {
      const result = matchPlatform('', '');
      expect(result).toBeNull();
    });
  });

  describe('templates', () => {
    it('is an array', () => {
      expect(Array.isArray(templates)).toBe(true);
    });

    it('is empty in placeholder', () => {
      expect(templates).toHaveLength(0);
    });
  });

  describe('Zod schemas', () => {
    it('HostnameMatcherSchema validates string', () => {
      const result = HostnameMatcherSchema.safeParse('idealista.com');
      expect(result.success).toBe(true);
    });

    it('HostnameMatcherSchema validates pattern object', () => {
      const result = HostnameMatcherSchema.safeParse({ pattern: '*.idealista.*' });
      expect(result.success).toBe(true);
    });

    it('SelectorSchema validates complete selector', () => {
      const result = SelectorSchema.safeParse({
        primary: { type: 'css', value: '.title' },
        fallbacks: [],
        parser: 'text',
      });
      expect(result.success).toBe(true);
    });

    it('SelectorSchema applies defaults', () => {
      const result = SelectorSchema.safeParse({
        primary: { type: 'css', value: '.title' },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.fallbacks).toEqual([]);
        expect(result.data.parser).toBe('text');
      }
    });

    it('PlatformTemplateSchema validates complete template', () => {
      const result = PlatformTemplateSchema.safeParse({
        id: 'idealista-es',
        name: 'Idealista (Spain)',
        hostnameMatchers: ['idealista.com'],
        domSignatures: ['.main-info__title-main'],
        selectors: {
          title: {
            primary: { type: 'css', value: '.main-info__title-main' },
            fallbacks: [],
            parser: 'text',
          },
        },
        confidence: 0.99,
        locale: 'es-ES',
      });
      expect(result.success).toBe(true);
    });

    it('PlatformTemplateSchema validates confidence range', () => {
      const tooLow = PlatformTemplateSchema.safeParse({
        id: 'test',
        name: 'Test',
        hostnameMatchers: ['test.com'],
        selectors: {},
        confidence: -0.1,
      });
      expect(tooLow.success).toBe(false);

      const tooHigh = PlatformTemplateSchema.safeParse({
        id: 'test',
        name: 'Test',
        hostnameMatchers: ['test.com'],
        selectors: {},
        confidence: 1.1,
      });
      expect(tooHigh.success).toBe(false);

      const valid = PlatformTemplateSchema.safeParse({
        id: 'test',
        name: 'Test',
        hostnameMatchers: ['test.com'],
        selectors: {},
        confidence: 0.5,
      });
      expect(valid.success).toBe(true);
    });

    it('MatchResultSchema validates match result', () => {
      const result = MatchResultSchema.safeParse({
        templateId: 'idealista-es',
        templateName: 'Idealista (Spain)',
        confidence: 0.99,
        matchedSignatures: ['.main-info__title-main', '.info-data-price'],
      });
      expect(result.success).toBe(true);
    });

    it('MatchResultSchema validates confidence range', () => {
      const tooLow = MatchResultSchema.safeParse({
        templateId: 'test',
        templateName: 'Test',
        confidence: -0.1,
        matchedSignatures: [],
      });
      expect(tooLow.success).toBe(false);

      const tooHigh = MatchResultSchema.safeParse({
        templateId: 'test',
        templateName: 'Test',
        confidence: 1.1,
        matchedSignatures: [],
      });
      expect(tooHigh.success).toBe(false);
    });
  });
});
