# Auto-Detection Reference Corpus

24 real-world platforms, manually validated by Piotr Nawrocki (May 2026).

## Ground-truth format

Each fixture directory contains `index-ground-truth.json` and `detail-ground-truth.json`.

### index-ground-truth.json fields

- `listing_card_selector` — primary CSS selector for listing cards
- `listing_count_expected` — expected number of cards on a typical index page
- `card_field_mappings` — selectors for headline, price, image, area, bedrooms
- `data_extractors_per_card` — per-card data extraction for re-ranking (Sprint 8 hook)
- `container_selector` — grid container selector (for ReorderDirective in Sprint 8)
- `detection_technique` — which technique should detect this platform
- `detection_confidence` — expected confidence threshold

### detail-ground-truth.json fields

- `slot_selectors` — headline, description, cta_primary adaptation slots
- `data_extractors` — price, bedrooms, area, year_built, etc.
- `similar_listings_section` — selector for similar listings section (Sprint 8 re-ranking target)

## CI gate thresholds

- Precision >= 95% (correct detections / total detections)
- Recall >= 80% (detected fields / total expected fields)
- `000-app-estalara`: 100% precision required (we own the code)

## Corpus platforms

| ID  | Platform         | Technique       | Market       |
| --- | ---------------- | --------------- | ------------ |
| 000 | app.estalara.com | data_estalara   | Internal     |
| 001 | Otodom           | data_attributes | PL           |
| 002 | Rightmove        | data_attributes | UK           |
| 003 | Zoopla           | data_attributes | UK           |
| 004 | Idealista        | article_tag     | ES           |
| 005 | OnTheMarket      | article_tag     | UK           |
| 006 | Habitaclia       | article_tag     | ES           |
| 007 | Kyero            | json_ld         | ES expat     |
| 008 | Zillow           | data_attributes | US           |
| 009 | RE/MAX           | mui             | Global       |
| 010 | Realtor.com      | data_attributes | US           |
| 011 | OLX PL           | data_attributes | PL           |
| 012 | Bayut            | data_attributes | AE           |
| 013 | Coldwell Banker  | mui             | Global       |
| 014 | Foxtons          | mui             | UK           |
| 015 | Engelvoelkers    | css_in_js       | Global       |
| 016 | Knight Frank     | angular         | Global       |
| 017 | Redfin           | css_modules     | US           |
| 018 | Houzez (WP)      | wordpress       | Global theme |
| 019 | RealHomes (WP)   | wordpress       | Global theme |
| 020 | Zyprus           | drupal_php      | CY           |
| 021 | Bazaraki         | drupal_php      | CY           |
| 022 | Lucas Fox        | css_in_js       | ES/UK        |
| 023 | Kyero (detail)   | json_ld         | ES expat     |
