# @estalara/platform-templates

Pre-built platform fingerprints for Auto-Onboarding Layer 3 (Master Design sections B.4.2, B.5.1).

## Purpose

This package provides pre-validated CSS selectors for 50+ known real estate platforms (Idealista,
Rightmove, Otodom, Zillow, Bayut, WordPress themes), enabling zero-cost platform detection before
falling back to expensive AI Vision calls.

## Layered Detection Strategy

Part of the 5-layer detection pipeline (Master Design B.5.1):

| Layer  | Method                   | Coverage | Cost   |
| ------ | ------------------------ | -------- | ------ |
| L1     | Schema.org JSON-LD       | ~40%     | $0     |
| L2     | Microdata                | ~10%     | $0     |
| **L3** | **Platform fingerprint** | **~25%** | **$0** |
| L4     | Heuristic detection      | ~15%     | $0     |
| L5     | AI Vision (Claude)       | 100%     | $0.33  |

Layer 3 (this package) handles ~25% of sites for free, significantly reducing dependency on
expensive AI Vision API calls.

## Status

**This is a placeholder package (TICKET-006).**

- Real platform templates ship in TICKET-032 (15 starter templates)
- Validation pipeline in TICKET-035
- `matchPlatform()` currently always returns `null`

## API

```typescript
import { matchPlatform, templates, type PlatformTemplate } from '@estalara/platform-templates';

// Match a URL + HTML against the platform registry
const result = matchPlatform('https://idealista.com/inmueble/12345', htmlContent);

if (result) {
  console.log(`Matched: ${result.templateName}`);
  console.log(`Confidence: ${result.confidence}`);
  console.log(`Signatures: ${result.matchedSignatures.join(', ')}`);
}

// Access the template registry
console.log(`${templates.length} templates available`);
```

## Roadmap

- **MVP**: 15 templates (top 3 platforms per region: ES/UK/PL/US/UAE)
- **M6**: 30 templates
- **Y2**: 80+ templates (community-contributed)

### Platforms to Cover

- **Spain**: Idealista, Fotocasa, Pisos.com
- **UK**: Rightmove, Zoopla, OnTheMarket
- **Poland**: Otodom, Gratka, OLX
- **US**: Zillow, Realtor.com, Redfin
- **UAE**: Bayut, Property Finder, Dubizzle
- **WordPress themes**: Houzez, Realtyna, Estatik, WP-Residence, RealHomes

## Related Documentation

- [Master Design B.4.2](../../docs/MASTER_DESIGN.md) — Magic Link Onboarding
- [Master Design B.5.1](../../docs/MASTER_DESIGN.md) — Schema Discovery Pipeline
- [TICKET-032](../../backlog/sprint-1/TICKET-032.md) — Real templates implementation
- [TICKET-035](../../backlog/sprint-2/TICKET-035.md) — Validation pipeline

## License

Proprietary — Estalara Adaptive Listings
