export interface MockRegistration {
  id: string;
  agency_name: string;
  website_url: string;
  contact_email: string;
  contact_name: string;
  country: string;
  listings_volume: string;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
}

export const MOCK_REGISTRATIONS: MockRegistration[] = [
  {
    id: 'reg-001',
    agency_name: 'Costa Sol Properties',
    website_url: 'https://costasolproperties.es',
    contact_email: 'maria@costasolproperties.es',
    contact_name: 'María García',
    country: 'Spain',
    listings_volume: '100-1000',
    status: 'pending',
    created_at: '2026-05-10T09:14:00Z',
  },
  {
    id: 'reg-002',
    agency_name: 'Algarve Luxury Homes',
    website_url: 'https://algarvehomes.pt',
    contact_email: 'joao@algarvehomes.pt',
    contact_name: 'João Silva',
    country: 'Portugal',
    listings_volume: '<100',
    status: 'pending',
    created_at: '2026-05-09T14:22:00Z',
  },
  {
    id: 'reg-003',
    agency_name: 'Dubai Prime Real Estate',
    website_url: 'https://dubaiprime.ae',
    contact_email: 'ahmed@dubaiprime.ae',
    contact_name: 'Ahmed Al-Rashid',
    country: 'UAE',
    listings_volume: '1000+',
    status: 'pending',
    created_at: '2026-05-08T11:05:00Z',
  },
];
