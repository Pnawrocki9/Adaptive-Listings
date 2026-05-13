-- Seed 18 canonical archetypes into archetype_embeddings.
-- embedding is NULL — the 1024-dim vector is filled in by the Modal daily job.
-- ON CONFLICT DO NOTHING makes this idempotent.

INSERT INTO archetype_embeddings (archetype_name, description, embedding, confidence_threshold, sample_count, is_active)
VALUES
  (
    'yield_hunter',
    'Investor focused on maximizing rental yield and cash flow. Responds to gross yield %, cap rate, rent-to-price ratio, and tenant vacancy data. ROI analysis is the primary decision driver.',
    NULL,
    0.600,
    0,
    true
  ),
  (
    'vacation_rental_investor',
    'Buys properties in tourist areas for short-term rental platforms like Airbnb/Vrbo. Attracted by occupancy rates, seasonal demand, proximity to attractions, and licensing permissibility.',
    NULL,
    0.600,
    0,
    true
  ),
  (
    'flip_investor',
    'Purchases undervalued properties to renovate and resell for capital gain. Prioritizes below-market price, renovation potential, and local price appreciation trends.',
    NULL,
    0.600,
    0,
    true
  ),
  (
    'portfolio_builder',
    'Accumulates a diversified property portfolio for long-term wealth building. Values stable markets, consistent yields, portfolio diversification, and low correlation to equities.',
    NULL,
    0.600,
    0,
    true
  ),
  (
    'golden_visa_buyer',
    'International buyer seeking residency or citizenship through property investment. Driven by investment threshold requirements, holding period rules, and immigration programme details.',
    NULL,
    0.600,
    0,
    true
  ),
  (
    'commercial_investor',
    'Focuses on commercial real estate including office, retail, and logistics. Key metrics are lease term, tenant quality, WAULT, and net initial yield.',
    NULL,
    0.600,
    0,
    true
  ),
  (
    'family_buyer',
    'Purchasing a primary home for family living. Prioritises school catchment, park proximity, bedroom count, garden, and neighbourhood safety.',
    NULL,
    0.600,
    0,
    true
  ),
  (
    'first_time_buyer',
    'Entering the property market for the first time. Sensitive to price, mortgage eligibility, help-to-buy schemes, and realistic move-in timelines.',
    NULL,
    0.600,
    0,
    true
  ),
  (
    'upsizer',
    'Moving to a larger home due to family growth or lifestyle upgrade. Needs more space (bedrooms, storage, garden), proximity to current location, and manageable price uplift.',
    NULL,
    0.600,
    0,
    true
  ),
  (
    'downsizer',
    'Transitioning to a smaller property, often post-children or post-retirement. Values low maintenance, single-storey access, proximity to amenities, and capital release.',
    NULL,
    0.600,
    0,
    true
  ),
  (
    'luxury_buyer',
    'Buying premium residential property. Motivated by specification quality, privacy, views, branded services, and exclusivity of the development or location.',
    NULL,
    0.600,
    0,
    true
  ),
  (
    'remote_worker',
    'Location-independent professional seeking lifestyle and workspace quality. Prioritises home office space, fast internet, quiet environment, and access to nature or co-working.',
    NULL,
    0.600,
    0,
    true
  ),
  (
    'lifestyle_expat',
    'International relocator seeking quality of life in a new country. Values weather, language, healthcare, international schools, and expat community.',
    NULL,
    0.600,
    0,
    true
  ),
  (
    'retiree_relocator',
    'Retiring and relocating, often internationally. Driven by climate, healthcare quality, low cost of living, cultural fit, and proximity to airports.',
    NULL,
    0.600,
    0,
    true
  ),
  (
    'diaspora_buyer',
    'Member of a diaspora purchasing property in their country of origin. Motivated by family connection, investment in home market, and retirement planning.',
    NULL,
    0.600,
    0,
    true
  ),
  (
    'second_home_buyer',
    'Buying a holiday or weekend retreat to complement their main residence. Values scenic location, travel time from primary home, rental income potential, and property management availability.',
    NULL,
    0.600,
    0,
    true
  ),
  (
    'student_parent',
    'Parent purchasing near a university for a student child, often as an investment. Key factors: proximity to campus, student rental demand, and resale liquidity.',
    NULL,
    0.600,
    0,
    true
  ),
  (
    'neutral',
    'No strong archetype signal detected. Default experience with no directional adaptation applied.',
    NULL,
    0.600,
    0,
    true
  )
ON CONFLICT (archetype_name) DO NOTHING;
