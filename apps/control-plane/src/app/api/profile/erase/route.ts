/**
 * POST /api/profile/erase (FOLLOW-1316): delete the stored profile and leave a 24-hour tombstone (R24-R27, R30). 200 `{ result: "deleted" | "not_found", data_source }`; 503 when the store failed.
 * Auth, validation, quota and audit: `lib/buyer-profile-route.ts`.
 *
 * @module apps/control-plane/src/app/api/profile/erase/route
 */

import type { NextRequest, NextResponse } from 'next/server';

import { handleProfileRequest } from '@/lib/buyer-profile-route';

/** @see handleProfileRequest */
export function POST(req: NextRequest): Promise<NextResponse> {
  return handleProfileRequest(req, 'erase');
}
