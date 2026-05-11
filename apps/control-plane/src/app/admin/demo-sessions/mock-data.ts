export interface MockDemoSession {
  id: string;
  tenant_name: string;
  scope: 'mockup' | 'live';
  visibility: 'self' | 'public' | 'team';
  duration: 'session' | '24h' | '7d';
  status: 'active' | 'revoked' | 'expired';
  created_at: string;
  expires_at: string;
}

export const MOCK_DEMO_SESSIONS: MockDemoSession[] = [
  {
    id: 'dsess-001',
    tenant_name: 'Costa Sol Properties',
    scope: 'mockup',
    visibility: 'public',
    duration: '24h',
    status: 'active',
    created_at: '2026-05-10T10:00:00Z',
    expires_at: '2026-05-11T10:00:00Z',
  },
  {
    id: 'dsess-002',
    tenant_name: 'Dubai Prime Real Estate',
    scope: 'live',
    visibility: 'self',
    duration: 'session',
    status: 'active',
    created_at: '2026-05-10T14:30:00Z',
    expires_at: '2026-05-10T22:30:00Z',
  },
  {
    id: 'dsess-003',
    tenant_name: 'Algarve Luxury Homes',
    scope: 'mockup',
    visibility: 'team',
    duration: '7d',
    status: 'revoked',
    created_at: '2026-05-05T09:00:00Z',
    expires_at: '2026-05-12T09:00:00Z',
  },
];
