/**
 * Hand-crafted mock listings for Demo Mode.
 * 12 listings across 4 regions × 3 price segments.
 * Used by /dashboard/demo/mockup to demonstrate personalization.
 *
 * @module apps/control-plane/src/lib/mockup-listings
 */

export type ListingRegion = 'costa-del-sol' | 'algarve' | 'tuscany' | 'dubai-marina';
export type ListingType =
  | 'villa'
  | 'apartment'
  | 'townhouse'
  | 'farmhouse'
  | 'penthouse'
  | 'studio';
export type PriceSegment = 'budget' | 'mid' | 'luxury';

export interface MockupListing {
  slug: string;
  title: string;
  region: ListingRegion;
  type: ListingType;
  price: number;
  price_segment: PriceSegment;
  bedrooms: number;
  bathrooms: number;
  area_m2: number;
  description: string;
  tags: string[];
  yield_pct?: number;
  schools_nearby?: number;
  image_query: string;
  /** Unsplash photo ID (without 'photo-' prefix) for the hero image */
  unsplash_id: string;
  features: string[];
}

export const MOCKUP_LISTINGS: MockupListing[] = [
  // ─── Costa del Sol ──────────────────────────────────────────────────────────
  {
    slug: 'villa-marbella-golden-mile',
    title: 'Frontline Beach Villa — Marbella Golden Mile',
    region: 'costa-del-sol',
    type: 'villa',
    price: 1_250_000,
    price_segment: 'luxury',
    bedrooms: 4,
    bathrooms: 4,
    area_m2: 380,
    description:
      "Exquisite villa on Marbella's famous Golden Mile with direct sea access and stunning panoramic views. Recently renovated to the highest specification, featuring an infinity pool and mature tropical gardens.",
    tags: ['sea_view', 'pool', 'investment', 'private_garden', 'beachfront'],
    yield_pct: 5.2,
    unsplash_id: '1613977257363-707ba9348227',
    image_query: 'marbella luxury villa sea',
    features: [
      'Infinity pool with direct sea views',
      'Private access to sandy beach',
      'Fully equipped designer kitchen',
      'Home cinema & wine cellar',
      'Heated garage for 3 vehicles',
      '24/7 security and concierge service',
    ],
  },
  {
    slug: 'apt-marbella-centro',
    title: 'Modern Apartment — Marbella Centro',
    region: 'costa-del-sol',
    type: 'apartment',
    price: 520_000,
    price_segment: 'mid',
    bedrooms: 2,
    bathrooms: 2,
    area_m2: 95,
    description:
      "Beautifully appointed apartment in the heart of Marbella's old town. Walking distance to Puerto Banús and the famous Paseo Marítimo. Perfect as a holiday home or rental investment.",
    tags: ['walking_distance_beach', 'city_centre', 'rental_potential', 'terrace'],
    yield_pct: 6.1,
    unsplash_id: '1560448204-e02f11c3d0e2',
    image_query: 'marbella apartment terrace',
    features: [
      'Private terrace with sea glimpses',
      'Fully furnished and equipped',
      'Community pool and gardens',
      'Underground parking space',
      'Strong rental history',
    ],
  },
  {
    slug: 'townhouse-estepona',
    title: 'Golf Front Townhouse — Estepona',
    region: 'costa-del-sol',
    type: 'townhouse',
    price: 680_000,
    price_segment: 'mid',
    bedrooms: 3,
    bathrooms: 3,
    area_m2: 210,
    description:
      'Elegant townhouse on the first line of an award-winning golf course in Estepona. Exceptional family home with spacious terraces and mature gardens. Close to international schools.',
    tags: ['golf_nearby', 'family_friendly', 'garden', 'quiet_area'],
    schools_nearby: 4,
    unsplash_id: '1570129477492-45c003edd2be',
    image_query: 'spain townhouse golf course garden',
    features: [
      'Panoramic golf and sea views',
      'Private garden with outdoor kitchen',
      'Spacious master suite with dressing room',
      'Separate guest apartment',
      '5 minutes to beach and town',
    ],
  },

  // ─── Algarve ────────────────────────────────────────────────────────────────
  {
    slug: 'villa-vale-do-lobo',
    title: 'Oceanfront Villa — Vale do Lobo',
    region: 'algarve',
    type: 'villa',
    price: 1_800_000,
    price_segment: 'luxury',
    bedrooms: 5,
    bathrooms: 5,
    area_m2: 520,
    description:
      'Exceptional oceanfront villa in the prestigious Vale do Lobo resort. This architectural masterpiece offers breathtaking Atlantic views with a private pool and direct beach access via a scenic cliff path.',
    tags: ['sea_view', 'pool', 'private_beach', 'investment', 'resort'],
    yield_pct: 4.8,
    unsplash_id: '1558618666-fcd25c85cd64',
    image_query: 'algarve luxury villa ocean cliff',
    features: [
      'Direct cliff path to private beach',
      'Heated infinity pool overlooking Atlantic',
      'Smart home automation throughout',
      'Professional-grade kitchen',
      'Access to resort amenities: golf, tennis, spa',
      'Staff quarters included',
    ],
  },
  {
    slug: 'apt-lagos-old-town',
    title: 'Charming Apartment — Lagos Old Town',
    region: 'algarve',
    type: 'apartment',
    price: 320_000,
    price_segment: 'budget',
    bedrooms: 1,
    bathrooms: 1,
    area_m2: 58,
    description:
      'Tastefully renovated apartment in the historic heart of Lagos. The perfect buy-to-let investment, consistently achieving excellent seasonal rental returns thanks to its central location and charm.',
    tags: ['investment', 'rental_potential', 'historic_centre', 'walking_distance_beach'],
    yield_pct: 7.4,
    unsplash_id: '1566073771259-f9c821d6c3e2',
    image_query: 'lagos portugal old town apartment',
    features: [
      'Original stone walls and traditional tiles',
      'Modern kitchen and bathroom',
      'Roof terrace with old town views',
      'Steps from Praia Ana beach',
      'Proven rental income: €2,100/month peak season',
    ],
  },
  {
    slug: 'townhouse-quinta-do-lago',
    title: 'Golf & Lake Townhouse — Quinta do Lago',
    region: 'algarve',
    type: 'townhouse',
    price: 520_000,
    price_segment: 'mid',
    bedrooms: 3,
    bathrooms: 2,
    area_m2: 175,
    description:
      "Stylish three-bedroom townhouse in the exclusive Quinta do Lago estate. Overlooking the serene lagoon and championship golf course, this is an ideal family retreat in one of Europe's finest resorts.",
    tags: ['golf_nearby', 'lake_view', 'family_friendly', 'resort', 'quiet_area'],
    schools_nearby: 3,
    unsplash_id: '1600585154526-990dced4db0d',
    image_query: 'quinta do lago golf townhouse portugal',
    features: [
      'Unobstructed golf and lagoon views',
      'Private patio and landscaped garden',
      'Resort pool and sports facilities access',
      'Concierge and property management available',
      'Close to international schools and beaches',
    ],
  },

  // ─── Tuscany ────────────────────────────────────────────────────────────────
  {
    slug: 'villa-chianti',
    title: 'Historic Estate — Chianti Classico',
    region: 'tuscany',
    type: 'villa',
    price: 2_400_000,
    price_segment: 'luxury',
    bedrooms: 6,
    bathrooms: 6,
    area_m2: 780,
    description:
      'A magnificent 16th-century estate at the heart of the Chianti Classico wine region. With 8 hectares of vineyards and olive groves, this iconic property combines historic grandeur with modern luxury.',
    tags: [
      'vineyard_view',
      'historic',
      'investment',
      'pool',
      'countryside',
      'agriturismo_potential',
    ],
    yield_pct: 4.1,
    unsplash_id: '1567784177951-6fa58317e16b',
    image_query: 'tuscany chianti villa vineyard historic',
    features: [
      '8 hectares of producing Chianti Classico vines',
      'Olive grove yielding 500+ litres/year',
      'Swimming pool with panoramic valley views',
      'Wine cellar and tasting room',
      'Original frescoes and stone fireplaces',
      'Fully licensed agriturismo operation',
    ],
  },
  {
    slug: 'farmhouse-siena',
    title: 'Restored Farmhouse — Siena Hills',
    region: 'tuscany',
    type: 'farmhouse',
    price: 850_000,
    price_segment: 'mid',
    bedrooms: 4,
    bathrooms: 3,
    area_m2: 320,
    description:
      'A lovingly restored 18th-century stone farmhouse with sweeping views across the Crete Senesi landscape. Retaining all its original character while offering every modern comfort.',
    tags: ['countryside', 'renovation_potential', 'stone_building', 'views', 'peaceful'],
    unsplash_id: '1500382017468-9049fed747ef',
    image_query: 'tuscany stone farmhouse siena hills',
    features: [
      'Original stone construction throughout',
      'Large open-plan kitchen with fireplace',
      'Private 1.2-hectare grounds',
      'Swimming pool with countryside views',
      'Workshop and barn for conversion',
      '30 minutes from Siena city centre',
    ],
  },
  {
    slug: 'apt-florence-centre',
    title: 'Classic Apartment — Florence Historic Centre',
    region: 'tuscany',
    type: 'apartment',
    price: 290_000,
    price_segment: 'budget',
    bedrooms: 1,
    bathrooms: 1,
    area_m2: 62,
    description:
      "Beautifully presented apartment in a historic palazzo steps from the Ponte Vecchio. An outstanding investment opportunity benefiting from Florence's world-class tourist appeal and perennial rental demand.",
    tags: ['historic_centre', 'rental_potential', 'investment', 'city_centre', 'cultural'],
    yield_pct: 6.8,
    unsplash_id: '1541370976299-4d24ebbc9077',
    image_query: 'florence italy apartment historic palazzo',
    features: [
      'Original terracotta floors and high ceilings',
      'Steps from Ponte Vecchio and Uffizi',
      'Fully furnished for short-let rental',
      'Strong rental income: €1,800/month average',
      'Palazzo with lift access',
    ],
  },

  // ─── Dubai Marina ───────────────────────────────────────────────────────────
  {
    slug: 'penthouse-marina-gate',
    title: 'Ultra-Luxury Penthouse — Marina Gate',
    region: 'dubai-marina',
    type: 'penthouse',
    price: 3_200_000,
    price_segment: 'luxury',
    bedrooms: 4,
    bathrooms: 5,
    area_m2: 490,
    description:
      'Spectacular full-floor penthouse crowning the iconic Marina Gate tower. Three levels of pure luxury with a private rooftop pool, panoramic views of the Arabian Gulf and the Dubai skyline.',
    tags: ['sea_view', 'concierge', 'investment', 'pool', 'skyline_view', 'premium_finishes'],
    yield_pct: 5.5,
    unsplash_id: '1512453979798-5ea266f8880c',
    image_query: 'dubai marina penthouse luxury skyline',
    features: [
      'Private rooftop pool on 3rd level',
      'Panoramic 270° views: sea, marina, skyline',
      'Home automation and smart climate control',
      'Private elevator access',
      'Dedicated concierge and valet parking',
      'Access to 5-star hotel amenities',
    ],
  },
  {
    slug: 'apt-jumeirah-lake',
    title: 'Lake View Apartment — Jumeirah Lake Towers',
    region: 'dubai-marina',
    type: 'apartment',
    price: 720_000,
    price_segment: 'mid',
    bedrooms: 2,
    bathrooms: 2,
    area_m2: 125,
    description:
      'Stunning two-bedroom apartment with unobstructed lake views in the vibrant Jumeirah Lake Towers community. State-of-the-art facilities and excellent connectivity to the metro and business districts.',
    tags: ['lake_view', 'gym', 'pool', 'metro_access', 'business_district'],
    yield_pct: 6.3,
    unsplash_id: '1582640952593-3b7c2e5e0e5a',
    image_query: 'dubai jumeirah lake towers apartment view',
    features: [
      'Full-width lake-facing balcony',
      'Fully fitted kitchen with premium appliances',
      'Residents gym, pool and spa',
      '2 minutes walk to JLT Metro station',
      'Pet-friendly building',
    ],
  },
  {
    slug: 'studio-business-bay',
    title: 'High-Yield Studio — Business Bay',
    region: 'dubai-marina',
    type: 'studio',
    price: 380_000,
    price_segment: 'budget',
    bedrooms: 0,
    bathrooms: 1,
    area_m2: 48,
    description:
      "Smart studio apartment in the thriving Business Bay district — Dubai's fastest-growing commercial hub. An ideal entry-level investment with consistently strong corporate rental demand.",
    tags: ['investment', 'high_yield', 'corporate_rental', 'canal_view', 'business_district'],
    yield_pct: 8.1,
    unsplash_id: '1545566130-6eb27b99f7ea',
    image_query: 'dubai business bay studio canal apartment',
    features: [
      'Canal views from floor-to-ceiling windows',
      'Fully furnished and appliance-equipped',
      'Hotel-style amenities: pool, gym, concierge',
      'Direct access to Dubai Canal waterfront',
      'Highest rental yield in our Dubai portfolio',
    ],
  },
];

/** Look up a listing by slug. Returns undefined if not found. */
export function getListingBySlug(slug: string): MockupListing | undefined {
  return MOCKUP_LISTINGS.find((l) => l.slug === slug);
}

/** Return the display name for a region. */
export function regionLabel(region: ListingRegion): string {
  const labels: Record<ListingRegion, string> = {
    'costa-del-sol': 'Costa del Sol',
    algarve: 'Algarve',
    tuscany: 'Tuscany',
    'dubai-marina': 'Dubai Marina',
  };
  return labels[region];
}

/** Format a price as currency string. */
export function formatPrice(price: number): string {
  if (price >= 1_000_000) {
    return `€${(price / 1_000_000).toFixed(price % 1_000_000 === 0 ? 0 : 1)}M`;
  }
  return `€${(price / 1_000).toFixed(0)}k`;
}
