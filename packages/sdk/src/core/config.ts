/**
 * SDK configuration — read from data-* attributes on the <script> tag.
 *
 * @module @estalara/sdk/core/config
 */

export interface SdkConfig {
  apiKey: string;
  /** Derived from API key prefix (optional override via data-tenant-id). */
  tenantId?: string;
  ingestUrl: string;
  tier: 'observer' | 'augment' | 'native';
  debug: boolean;
  consentState: 'consented' | 'legitimate_interest' | 'opted_out';
}

export const DEFAULT_CONFIG: Omit<SdkConfig, 'apiKey'> = {
  ingestUrl: 'https://ingest.estalara.com/v1/events',
  tier: 'observer',
  debug: false,
  consentState: 'legitimate_interest',
};

/**
 * Read SDK configuration from a <script> element's data-* attributes.
 * @throws {Error} if data-api-key is missing.
 */
export function readConfig(script: { dataset: Record<string, string | undefined> }): SdkConfig {
  const apiKey = script.dataset.apiKey ?? script.dataset['api-key'] ?? '';
  if (!apiKey) {
    throw new Error('[Estalara] data-api-key is required on the Estalara script tag');
  }

  const rawTier = script.dataset.tier;
  const tier: SdkConfig['tier'] =
    rawTier === 'augment' || rawTier === 'native' ? rawTier : DEFAULT_CONFIG.tier;

  const rawConsent = script.dataset.consentState;
  const consentState: SdkConfig['consentState'] =
    rawConsent === 'consented' || rawConsent === 'opted_out'
      ? rawConsent
      : DEFAULT_CONFIG.consentState;

  const tenantId = script.dataset.tenantId;

  return {
    apiKey,
    ...(tenantId !== undefined ? { tenantId } : {}),
    ingestUrl: script.dataset.ingestUrl ?? DEFAULT_CONFIG.ingestUrl,
    tier,
    debug: script.dataset.debug === 'true',
    consentState,
  };
}
