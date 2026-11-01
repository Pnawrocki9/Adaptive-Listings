/**
 * POST /api/profile/access (FOLLOW-1316): return what is stored under the xid (R30). 200 `{ result: "found" | "not_found", profile, expires_at, data_source }`; 503 when the store failed.
 * Auth, validation, quota and audit: `lib/buyer-profile-route.ts`.
 *
 * @module apps/control-plane/src/app/api/profile/access/route
 */

import type { NextRequest, NextResponse } from 'next/server';

import { handleProfileRequest } from '@/lib/buyer-profile-route';

/** @see handleProfileRequest */
export function POST(req: NextRequest): Promise<NextResponse> {
  return handleProfileRequest(req, 'access');
}
