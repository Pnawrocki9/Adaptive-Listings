/**
 * @estalara/platform-templates — Type definitions for platform fingerprint templates.
 *
 * This module defines the schema for pre-built platform templates used in Auto-Onboarding
 * Layer 3 (Master Design sections B.4.2, B.5.1). These templates provide known CSS selectors
 * for 50+ real estate platforms (Idealista, Rightmove, Otodom, Zillow, Bayut, WordPress themes).
 *
 * @module @estalara/platform-templates/types
 */

import { z } from 'zod';

/**
 * Hostname matcher — either exact string or regex pattern.
 *
 * @example
 * // Exact match
 * "idealista.com"
 *
 * @example
 * // Regex pattern match
 * { pattern: "*.idealista.*" }
 */
export const HostnameMatcherSchema = z.union([
  z.string(), // exact match: "idealista.com"
  z.object({ pattern: z.string() }), // regex: { pattern: "*.idealista.*" }
]);
export type HostnameMatcher = z.infer<typeof HostnameMatcherSchema>;

/**
 * Selector strategy for extracting a field from the DOM.
 *
 * Supports CSS, XPath, and JSON path selectors with fallbacks.
 * Parser defines how to interpret the extracted value.
 */
export const SelectorSchema = z.object({
  primary: z.object({
    type: z.enum(['css', 'xpath', 'json_path']),
    value: z.string(),
  }),
  fallbacks: z
    .array(
      z.object({
        type: z.enum(['css', 'xpath', 'json_path']),
        value: z.string(),
      }),
    )
    .default([]),
  parser: z.enum(['text', 'number', 'currency', 'array', 'json']).default('text'),
});
export type Selector = z.infer<typeof SelectorSchema>;

/**
 * Platform template — pre-validated selectors for a known platform.
 *
 * Each template covers a specific real estate platform (e.g., Idealista Spain,
 * WordPress + Houzez theme, Zillow US) with known DOM structure.
 *
 * @example
 * {
 *   id: 'idealista-es',
 *   name: 'Idealista (Spain)',
 *   hostnameMatchers: ['idealista.com'],
 *   domSignatures: ['.main-info__title-main'],
 *   selectors: {
 *     title: { primary: { type: 'css', value: '.main-info__title-main' }, fallbacks: [], parser: 'text' },
 *     price: { primary: { type: 'css', value: '.info-data-price span' }, fallbacks: [], parser: 'currency' }
 *   },
 *   confidence: 0.99
 * }
 */
export const PlatformTemplateSchema = z.object({
  id: z.string(), // 'wordpress-houzez', 'idealista-es'
  name: z.string(), // human-readable: 'WordPress + Houzez Theme'
  hostnameMatchers: z.array(HostnameMatcherSchema),
  domSignatures: z.array(z.string()).default([]), // CSS selectors that prove platform
  selectors: z.record(SelectorSchema), // field → selector strategy
  confidence: z.number().min(0).max(1), // baseline confidence when matched
  locale: z.string().optional(), // 'es-ES', 'en-GB', etc.
});
export type PlatformTemplate = z.infer<typeof PlatformTemplateSchema>;

/**
 * Result of matching a URL+HTML against the platform registry.
 *
 * @example
 * {
 *   templateId: 'idealista-es',
 *   templateName: 'Idealista (Spain)',
 *   confidence: 0.99,
 *   matchedSignatures: ['.main-info__title-main', '.info-data-price']
 * }
 */
export const MatchResultSchema = z.object({
  templateId: z.string(),
  templateName: z.string(),
  confidence: z.number().min(0).max(1),
  matchedSignatures: z.array(z.string()),
});
export type MatchResult = z.infer<typeof MatchResultSchema>;
