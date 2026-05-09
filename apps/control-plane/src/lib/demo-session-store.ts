/**
 * Shared in-memory demo session store (MVP stub only).
 * TODO Sprint 5: replace with demo_sessions DB table via createAdminClient()
 */

import type { DemoDuration, DemoScope, DemoVisibility } from '@estalara/shared';

export interface StubSession {
  id: string;
  tenantId: string;
  scope: DemoScope;
  visibility: DemoVisibility;
  duration: DemoDuration;
  tokenHash: string;
  shareableLink: string | null;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  revokeReason: string | null;
  productionDomain: string | null;
}

export const sessionStore = new Map<string, StubSession>();
