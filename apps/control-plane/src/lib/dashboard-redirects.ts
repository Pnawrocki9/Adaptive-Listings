/**
 * `/dashboard/*` → `/admin/...` redirect table (FOLLOW-1335, ESC-085 decision D-B).
 *
 * The agency `/dashboard` was merged into the staff backoffice: FOLLOW-1334 ported its surfaces to
 * `/admin/tenants/[id]/*`, FOLLOW-1335 deleted `app/dashboard/**`. For ONE release every old
 * `/dashboard` URL is forwarded (by `middleware.ts`) to the `/admin` page that now hosts the same
 * function, so bookmarks and links keep working. Every target is asserted to exist by
 * `app/admin/__tests__/admin-nav-reachability.test.ts`.
 *
 * @module apps/control-plane/src/lib/dashboard-redirects
 */

import { ESTALARA_TENANT_ID } from '@/lib/estalara-tenant';

/** `?tab=` values the `/admin/tenants/[id]/analytics` page understands (`analytics-tabs.tsx`). */
const ANALYTICS_TABS = new Set(['overview', 'pilot', 'quiz']);

/**
 * The `/admin` path (with query) an old `/dashboard` URL is forwarded to, or `null` when
 * `pathname` is not under `/dashboard`.
 *
 * The middleware answers it with a 307, not a 308: the target embeds the per-environment tenant id
 * (`NEXT_PUBLIC_ESTALARA_TENANT_ID`) and browsers cache a permanent redirect (FOLLOW-1322).
 */
export function dashboardRedirectPath(pathname: string, search: URLSearchParams): string | null {
  if (pathname !== '/dashboard' && !pathname.startsWith('/dashboard/')) return null;
  const tenant = `/admin/tenants/${ESTALARA_TENANT_ID}`;
  const path = pathname.replace(/\/+$/, '');

  const analytics = (tab: string | null): string =>
    tab && ANALYTICS_TABS.has(tab) ? `${tenant}/analytics?tab=${tab}` : `${tenant}/analytics`;

  if (path === '/dashboard/analytics') return analytics(search.get('tab'));
  if (path === '/dashboard/pilot') return analytics('pilot');
  if (path === '/dashboard/quiz/analytics') return analytics('quiz');
  if (path === '/dashboard/analytics/labels') return `${tenant}/labels`;
  if (path === '/dashboard/quiz') return `${tenant}/quiz`;
  if (path === '/dashboard/demo/override') return `${tenant}/demo`;
  if (path === '/dashboard/settings') return '/admin/settings';
  // The listing id is carried over as the (still percent-encoded) path segment it arrived as.
  const listingId = /^\/dashboard\/listings\/([^/]+)\/answers$/.exec(path)?.[1];
  if (listingId !== undefined) return `${tenant}/listings/${listingId}/answers`;
  return '/admin';
}

// ───────────────────────────────────────────────────────────────────────────
