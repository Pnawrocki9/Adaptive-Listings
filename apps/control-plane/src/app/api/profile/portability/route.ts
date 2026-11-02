/**
 * POST /api/profile/portability (FOLLOW-1316): export what is stored under the xid as versioned JSON (R30). 200 `{ format, format_version, exported_at, profile, expires_at, data_source }`; 503 when the store failed.
 * Auth, validation, quota and audit: `lib/buyer-profile-route.ts`.
 *
 * @module apps/control-plane/src/app/api/profile/portability/route
 */

import type { NextRequest, NextResponse } from 'next/server';

import { handleProfileRequest } from '@/lib/buyer-profile-route';

/** @see handleProfileRequest */
export function POST(req: NextRequest): Promise<NextResponse> {
  return handleProfileRequest(req, 'portability');
}
