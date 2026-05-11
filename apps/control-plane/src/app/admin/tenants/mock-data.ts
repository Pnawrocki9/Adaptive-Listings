export interface MockTenant {
  id: string;
  name: string;
  plan: 'starter' | 'growth' | 'enterprise';
  status: 'active' | 'suspended' | 'trial';
  sdk_status: 'installed' | 'pending' | 'not_installed';
  demo_mode: boolean;
  profile_mode: boolean;
  created_at: string;
}

export const MOCK_TENANTS: MockTenant[] = [
  {
    id: 'tenant-001',
    name: 'Costa Sol Properties',
    plan: 'growth',
    status: 'active',
    sdk_status: 'installed',
    demo_mode: true,
    profile_mode: false,
    created_at: '2026-04-15T10:00:00Z',
  },
  {
    id: 'tenant-002',
    name: 'Algarve Luxury Homes',
    plan: 'starter',
    status: 'trial',
    sdk_status: 'pending',
    demo_mode: false,
    profile_mode: false,
    created_at: '2026-05-01T08:30:00Z',
  },
  {
    id: 'tenant-003',
    name: 'Dubai Prime Real Estate',
    plan: 'enterprise',
    status: 'active',
    sdk_status: 'installed',
    demo_mode: true,
    profile_mode: false,
    created_at: '2026-03-20T14:00:00Z',
  },
];
