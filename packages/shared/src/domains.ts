/**
 * Canonical service domains and environment variable names for Estalara.
 *
 * Domain decision: estalara.com (.com) is canonical — per DECISIONS_2026-05-18_v2.
 * estalara.io was used in legacy wrangler/terraform config and has been superseded.
 *
 * NOTE: app.estalara.com belongs to Rafal's separate SvelteKit product — not this control plane.
 * The control plane (Next.js/Vercel) lives at admin.estalara.com.
 *
 * Worker apps (ingest, decision-api) consume service URLs via Wrangler env bindings, not
 * process.env. These constants serve as the single source of truth for documentation,
 * control-plane configuration, and SDK defaults.
 */

/** SDK CDN (Cloudflare R2 — serves @estalara/sdk bundles) */
export const SDK_CDN_DOMAIN = 'cdn.estalara.com' as const;
export const SDK_CDN_URL = `https://${SDK_CDN_DOMAIN}` as const;
/** Browser env var: NEXT_PUBLIC_SDK_CDN_URL; server/CI env var: ESTALARA_SDK_CDN_URL */
export const SDK_CDN_ENV_BROWSER = 'NEXT_PUBLIC_SDK_CDN_URL' as const;
export const SDK_CDN_ENV_SERVER = 'ESTALARA_SDK_CDN_URL' as const;

/** Ingest Worker (Cloudflare Workers) */
export const INGEST_DOMAIN = 'ingest.estalara.com' as const;
export const INGEST_URL = `https://${INGEST_DOMAIN}` as const;
export const INGEST_ENV = 'ESTALARA_INGEST_URL' as const;

/** Decision API Worker (Cloudflare Workers) */
export const DECISION_API_DOMAIN = 'decision.estalara.com' as const;
export const DECISION_API_URL = `https://${DECISION_API_DOMAIN}` as const;
export const DECISION_API_ENV = 'ESTALARA_DECISION_API_URL' as const;

/** Control Plane (Next.js on Vercel) */
export const CONTROL_PLANE_DOMAIN = 'admin.estalara.com' as const;
export const CONTROL_PLANE_URL = `https://${CONTROL_PLANE_DOMAIN}` as const;
export const CONTROL_PLANE_ENV = 'NEXT_PUBLIC_CONTROL_PLANE_URL' as const;

/**
 * Staging subdomain prefixes follow the pattern: <service>-staging.estalara.com
 * e.g. ingest-staging.estalara.com, api-staging.estalara.com
 */
export const INGEST_STAGING_DOMAIN = 'ingest-staging.estalara.com' as const;
export const DECISION_API_STAGING_DOMAIN = 'decision-staging.estalara.com' as const;
export const CDN_STAGING_DOMAIN = 'cdn-staging.estalara.com' as const;
