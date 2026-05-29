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
/**
 * @deprecated Names the deprecated Cloudflare Worker (`decision.estalara.com`),
 * whose `/api/adapt` handler is being retired (ADR-0006 §Decision 3, FOLLOW-105).
 * Do NOT use this constant to target the adapt endpoint in any snippet generator
 * or SDK config — use `CONTROL_PLANE_URL` (canonical `admin.estalara.com`) instead.
 * Will be removed in FOLLOW-107 (Sprint 14) once the Worker is fully retired.
 */
export const DECISION_API_URL = `https://${DECISION_API_DOMAIN}` as const;
export const DECISION_API_ENV = 'ESTALARA_DECISION_API_URL' as const;

/** Control Plane (Next.js on Vercel) */
export const CONTROL_PLANE_DOMAIN = 'admin.estalara.com' as const;
export const CONTROL_PLANE_URL = `https://${CONTROL_PLANE_DOMAIN}` as const;
export const CONTROL_PLANE_ENV = 'NEXT_PUBLIC_CONTROL_PLANE_URL' as const;

/**
 * Pilot SDK serve URL — control-plane static asset.
 *
 * The canonical CDN (`cdn.estalara.com`, see `SDK_CDN_URL` above) has not yet
 * been provisioned (no R2 bucket, no deploy pipeline, no SRI release flow).
 * For the Sprint 13a pilot we serve the IIFE bundle as a Vercel static asset
 * from the control-plane `public/` directory, reachable at
 * `https://admin.estalara.com/sdk.js`. [ESC-015]
 *
 * Phase 2 will provision `cdn.estalara.com` with versioned releases + SRI
 * hashes; at that point flip snippet generation back to `SDK_CDN_URL` and
 * delete this constant.
 */
export const SDK_SERVE_URL = `${CONTROL_PLANE_URL}/sdk.js` as const;

/**
 * Staging subdomain prefixes follow the pattern: <service>-staging.estalara.com
 * e.g. ingest-staging.estalara.com, api-staging.estalara.com
 */
export const INGEST_STAGING_DOMAIN = 'ingest-staging.estalara.com' as const;
export const DECISION_API_STAGING_DOMAIN = 'decision-staging.estalara.com' as const;
export const CDN_STAGING_DOMAIN = 'cdn-staging.estalara.com' as const;
