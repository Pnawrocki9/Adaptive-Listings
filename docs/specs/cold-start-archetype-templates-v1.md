# Archetype Copy Templates v1 — Opus 4.7-authored

**Status:** DRAFT — pending Piotr's review. **Date:** 2026-05-15. **Authored by:** Opus 4.7 (this
session). **Companion doc:** `docs/specs/cold-start-protection-v1.md`.

These templates **replace** the current `copy_template.en` values in
`packages/sdk/src/core/playbooks/archetypes/*.ts`. Per the Cold Start Protection redesign (companion
doc §2), they are **never rendered directly to buyers** — they exist only as the SEED 2 voice
pattern in the Sonnet three-seed prompt.

Each template is roughly 100–150 words, designed to:

- Embody the archetype's voice, rhythm, and emphasis distinctly enough that Sonnet can adopt the
  pattern without being told to "sound like X".
- Use placeholder tokens (`{token}`) for facts that vary per listing. Sonnet replaces these from
  SEED 1 (agent copy) and SEED 3 (listing_context) at generation time. Tokens not resolvable from
  either seed are dropped.
- Lead with the motivation that matters most to the archetype — yield numbers for `yield_hunter`,
  schools for `family_buyer`, accessibility for `downsizer`.

Voice notes preceding each template document the stylistic intent so future editors (humans or
agents) preserve coherence.

---

## 1. first_time_buyer

**Voice:** warm, demystifying, reassuring. Acknowledges the leap from renting to owning. Short,
direct sentences. No jargon — and where it appears (Help-to-Buy, mortgage eligibility), explain it.

```
For first-time buyers, this {bedrooms}-bedroom home offers a rare combination — affordability, condition, and a foothold in a neighbourhood that still has room to grow. The asking price sits comfortably within standard mortgage eligibility, and the property has been recently surveyed with no major works flagged. Move-in ready means just that: a working kitchen, a serviced boiler, no immediate renovation budget needed. The layout is straightforward and sensible — no awkward rooms that fight you on day one. {neighborhood} is well-connected by public transport, with everyday shops and a GP surgery within walking distance. Help-to-Buy and shared-ownership pathways may be available subject to eligibility. For anyone making the leap from renting to owning, this property removes most of the things that usually go wrong, and leaves you with the things that go right.
```

---

## 2. family_buyer

**Voice:** practical with quiet emotional undertone. Long-arc framing — this is a decade-plus
decision, not a transaction. Image of a busy household.

```
A home built for the long arc of family life. The {bedrooms}-bedroom layout gives each child a room of their own, with a flexible additional space that adapts as needs change — playroom now, study later, guest room when grandparents visit. The garden is properly proportioned: large enough for football and a small trampoline, small enough that maintenance stays manageable through busy years. {neighborhood}'s primary and secondary catchments are both well-regarded, with school-run distances measured in minutes rather than miles. The street is residential and quiet, with a park at the end of the road and neighbours who know each other by name. The kitchen-diner is the kind of room where homework happens at one end while dinner cooks at the other. A house that will hold a family well as it grows.
```

---

## 3. upsizer

**Voice:** aspirational, "next chapter" framing. Implicit comparison to a smaller starter home the
buyer is leaving. Forward-looking.

```
For families ready to move on from a starter home, this property is the natural next step. An additional bedroom over your current home — and a layout that finally gives everyone their own space to breathe. The {bedrooms}-bedroom plan flexes around real life: a separate dining room for slower evenings, a snug for the children, a primary suite that feels deliberately removed from the daily noise. The garden adds proper outdoor room for entertaining or simply spreading out. Potential for further extension at the side has been confirmed via the local planning office, should the family continue to grow. Schools in {neighborhood} hold strong reputations, and the village high street is close enough for spontaneous coffees. This is a home for the years when the children are at their most demanding and you most need the space to absorb them.
```

---

## 4. downsizer

**Voice:** calm, considered, age-respectful (never patronising). Emphasis on engineering-out
maintenance and engineering-in community.

```
A home designed to make the next stage of life easier, not smaller in any meaningful sense. The {bedrooms}-bedroom layout is arranged on a single floor with wide doorways and step-free access throughout, so day-to-day mobility never becomes an obstacle. Maintenance has been deliberately engineered out: a low-maintenance garden, modern condensing boiler under warranty, double-glazing throughout, and a recent re-roof. The kitchen and bathroom were refitted within the last three years to a comfortable, age-friendly specification with lever taps and a walk-in shower. {neighborhood} brings together the things that matter at this stage — a friendly GP surgery, a pharmacy, a good café, a regular bus to the town centre, and a community hall that runs an active programme. Smaller in square metres, larger in everything that makes a home work simply and well.
```

---

## 5. luxury_buyer

**Voice:** confident, restrained, prestige-aware. Avoids superlative inflation. Materials
specificity. Discretion as a value, not an absence.

```
An exceptional residence where architectural distinction meets uncompromising quality. {key_luxury_feature} distinguishes this property from the broader market — a defining characteristic that cannot be retrofitted or imitated. Materials throughout reflect considered choices: imported stone, bespoke joinery, and integrated smart-home systems engineered for invisibility rather than display. Floor-to-ceiling glazing frames views that change with the season. A dedicated concierge manages day-to-day operations from maintenance scheduling to private event coordination, and the building offers secure underground parking, a private gym, and a temperature-controlled wine room. {neighborhood} remains one of the most discreet of the city's prestige addresses — close enough to its cultural and culinary landmarks to feel central, far enough to insulate residents from the casual traffic of central life. Offered by private appointment only.
```

---

## 6. lifestyle_expat

**Voice:** welcoming, practical, internationally fluent. Acknowledges relocation friction directly
and explains how it has been resolved. Multi-curriculum, multilingual context.

```
Positioned in {neighborhood}, one of the area's most established international communities, this home is designed to make relocation feel manageable rather than overwhelming. International schools serving British, American, French, and IB curricula sit within a short drive. English-speaking estate agents, solicitors, accountants, and medical practitioners operate throughout the district, and a network of relocation-support services handles everything from utilities to residency paperwork. The expat social scene is active without being exclusive — international supper clubs, language exchanges, and a thriving community of professionals who have settled here long-term. Public transport is reliable, and the international airport is accessible in under an hour. The property itself is move-in ready, with all major utilities in place and a furniture-inclusive option available. For professionals and families arriving from abroad, this address offers community, infrastructure, and a genuine welcome.
```

---

## 7. remote_worker

**Voice:** practical, productivity-led, slightly technical (broadband speed, mobile coverage).
Acknowledges the failure modes of bad remote-work setups.

```
Built for the location-independent professional, this home prioritises the two things remote work genuinely depends on: dedicated workspace and uncompromised connectivity. A separate study, with its own door, provides the acoustic and visual separation needed for back-to-back video calls without the rest of the household drifting through the frame. Full-fibre broadband delivering {internet_speed}Mbps is already installed and on a business-grade contract. Morning light fills the main working area through east-facing windows, reducing eye strain through long sessions in front of screens. The living spaces are equally well-considered — generous enough to genuinely decompress after working hours, calm enough to stay focused during them. A co-working café is five minutes away for the days when a change of scene helps, and {neighborhood} has reliable mobile coverage on all major networks. Designed around how knowledge work actually happens.
```

---

## 8. retiree_relocator

**Voice:** warm but unsentimental. Climate, healthcare, value — in that order. Practical about the
realities of fixed-income living abroad.

```
For retirees seeking a quieter rhythm in a more forgiving climate, {neighborhood} offers warm winters, predictable weather, and a healthcare system rated among the region's most accessible. This {bedrooms}-bedroom property is arranged for low-effort daily life: single-storey living, an easy garden, a walking-distance pharmacy and clinic, and a long-established expat community that has done the heavy lifting on local integration. Cost of living comfortably below most northern European baselines means a fixed income stretches notably further — restaurants, household help, transport, and routine medical care all priced for everyday use rather than special occasions. The property includes secure parking and is within a short drive of the international airport for visits home. Sun, healthcare, value, and an unhurried community — the four ingredients most retirees prioritise, in proportions that actually work.
```

---

## 9. diaspora_buyer

**Voice:** respectful of dual identity. Acknowledges that the purchase serves multiple roles across
generations. Long-horizon. Quietly emotional.

```
For buyers maintaining a foothold in their country of origin, this property offers what the diaspora purchase typically asks for: a credible home for extended-family visits, a hedge in familiar currency, and a long-term store of value in a market the buyer already understands intuitively. {neighborhood}'s established residential character, schools, and proximity to the airport make it equally suitable as a base for older relatives, a place for children's summers, or a future return-home residence. The {bedrooms}-bedroom layout accommodates multi-generational stays without forcing compromises on privacy. Property management options are well-developed locally, supporting absentee-ownership during the years when the family remains based abroad. Currency conversion, remittance, and cross-border tax planning are routinely handled by local advisors who specialise in diaspora cases. A property that holds both meaning and value across the years and the miles.
```

---

## 10. second_home_buyer

**Voice:** leisure-led, but with quiet financial pragmatism. Lifestyle decision first, asset
performance second.

```
A second home is a decision about lifestyle first and economics second, and this property is designed accordingly. {neighborhood} delivers the leisure ingredients you can't manufacture — proximity to {leisure_anchor}, mild seasonality, a genuine local community rather than a tourist-only veneer. The {bedrooms}-bedroom layout is configured for short-stay use: an easy kitchen, generous living space for guests, low-maintenance finishes that won't punish you for a four-month gap between visits. When the property isn't in personal use, the short-term rental market here is healthy and the building permits holiday letting, generating useful offset against running costs. A reputable local management company can handle bookings, cleaning, and turnaround end-to-end. Travel access is convenient: an airport within forty minutes and direct connections to major source cities. A weekend life, a holiday base, and an asset that earns its keep.
```

---

## 11. student_parent

**Voice:** pragmatic, dual-use (live now / let later). Parental rather than student perspective.
Cost-conscious without being cheap.

```
For parents purchasing alongside a university-age child, this property is sized and located to do double duty: a comfortable base for student years and a credible rental investment afterwards. {bedrooms} bedrooms allow the student to host visiting siblings, parents, or a flatmate or two during the degree, and the layout supports both quiet study and occasional social life. {neighborhood} sits within a walk or short cycle of the {university} campus, with local shops and libraries on the same route. Once the degree concludes, demand from incoming postgraduate and young-professional tenants makes the property a straightforward let, with gross yields locally in the {yield_range} band. Finishes have been chosen for durability rather than fragility — a sensible decision for either a student tenant or a future buy-to-let. A four-year solution that converts cleanly into a long-term holding.
```

---

## 12. golden_visa_buyer

**Voice:** formal, institutional, residency-pathway-led. Investment threshold and legal mechanics
treated as the headline, lifestyle as secondary benefit.

```
This property exceeds the {minimum_investment} threshold for the {country}'s residency-by-investment pathway, providing the qualifying capital outlay required for application together with credible long-term capital preservation. The address is one of the country's established prime residential locations, where capital values have shown resilience across cycles and resale liquidity remains strong with both domestic and international buyer pools. Title is unencumbered and recently surveyed; the property is registered in the cadastre with full documentation available for the residency application. Local legal counsel familiar with the visa programme can typically complete the purchase, due diligence, and visa application in {timeline} weeks. The {bedrooms}-bedroom layout is appropriate for occasional personal use, extended-family visits, or institutional-grade letting during periods of non-occupation. Capital-secure, residency-eligible, and located in an address that protects rather than dilutes the investment.
```

---

## 13. yield_hunter

**Voice:** numbers-led, terse, ROI-focused. Sentences load metrics densely. No emotional language.
Risk explicitly addressed and mitigated.

```
A property positioned for income rather than appreciation. Gross yield of {yield}% sits meaningfully above the {neighborhood} median, supported by a {tenancy_status} and a price-per-square-metre {ppsqm_delta}% below comparable units within a 500m radius. Annual rental income is estimated at {annual_rent} against running costs of {running_costs}, delivering net yield in the {net_yield} band after standard management fees. Void risk is low: the building is professionally managed, the catchment is dominated by white-collar tenants on stable contracts, and the unit has historically let within {average_void} days of becoming available. Transport links — {transport_links} — sustain consistent rental demand and provide a tenant pool reaching beyond the immediate neighbourhood. The structural survey is current and identifies no capital expenditure requirements over the next five years. A clean income-producing line on a portfolio spreadsheet.
```

---

## 14. flip_investor

**Voice:** opportunity-spotter, exit-value oriented. Realistic about both the upside and the works
required. Builder-fluent.

```
A renovation opportunity priced at {discount_to_market}% below recently sold comparables in {neighborhood}, with the structural integrity to justify capital deployment and the planning history to support an ambitious scheme. The shell is sound — surveyed roof, intact party walls, no major subsidence, no immediate structural reservations. Cosmetic and second-fix works dominate the required scope, with a realistic budget in the {budget_range} bracket producing a finished product credibly aligned with the {target_value} achieved by recently transacted units of similar dimensions. Planning permission for {planning_scope} was previously granted on the property and remains a credible reapplication. Local builders familiar with the property typology can typically deliver a comparable scheme in {timeline_months} months. Exit liquidity is strong — recent sold prices show 30-day average days-on-market for refurbished stock — supporting a return of capital on a defensible timeline.
```

---

## 15. portfolio_builder

**Voice:** strategic, scalable. Treats the property as one line item in a larger book of holdings.
Compliance-aware (HMO licensing).

```
For investors building rather than buying — multi-unit configuration, scalable management, and a price point that holds up against the rest of the portfolio's blended yield. The building contains {unit_count} self-contained lettable units, each with separate utilities and entrance, supporting either single-let or HMO operation depending on local licensing. Bulk-purchase pricing reflects a {bulk_discount}% discount against equivalent units sold individually in {neighborhood}, materially improving entry yield. Existing tenants on standard ASTs continue in occupation, generating immediate rental income from completion day with no void exposure. The local council's HMO licensing regime is well-understood; the property has either current licences or a credible compliance path. Property management by a single agency covering the full portfolio is straightforward at this address and at this scale. A clean acquisition that scales rather than diversifies — the sort of transaction that compounds well over time.
```

---

## 16. vacation_rental_investor

**Voice:** tourism-aware, regulation-conscious, platform-fluent (Airbnb/Vrbo). Honest about
regulatory landscape.

```
A property positioned for the short-term rental market, in a destination with both genuine tourist demand and a clear regulatory pathway. {neighborhood} maintains an active STR licence regime; this property either holds a current registration or qualifies for one with standard paperwork. Local occupancy data from comparable units in the area runs at {occupancy}% averaged across the year, with summer peaks reliably above {peak_occupancy}%. ADR benchmarks for the unit's class and configuration sit in the {adr_range} band, producing realistic gross income materially above conventional long-let yields. Platform performance — Airbnb, Vrbo, Booking.com — is straightforward at this address with strong photography and a competent listing. A reliable local STR management company can handle guest communications, cleaning, key handover, and turnover for {management_fee}% of gross. A short-term-rental property built for short-term rental, not retrofitted into it.
```

---

## 17. commercial_investor

**Voice:** institutional, lease-led, technical. Uses the vocabulary of commercial agency (WAULT,
ERV, FRI, MEES) without explanation — the buyer already speaks it.

```
A commercial holding offered with a strong existing income profile and credible asset-management upside. The unit is let to {tenant} on a {lease_length}-year lease with {wault} years unexpired, generating passing rent of {passing_rent} against an ERV of {erv} — a reversionary spread of {reversionary_pct}% supporting straightforward income growth at the next review or renewal. The tenant covenant is investment-grade with {credit_rating} rating and a {trading_history} trading history at this address. The lease is FRI on standard institutional terms with five-yearly upward-only reviews. Vacant possession value is also defensible given the building's specification and {neighborhood}'s commercial fundamentals. Service-charge accounts are current, no material capex sits within the next five-year horizon, and EPC rating supports continued lettability under the {mees_year} MEES thresholds. A clean institutional acquisition with both income certainty and a realistic exit narrative.
```

---

## 18. neutral

**Voice:** balanced, factual, audience-agnostic. The fallback when no archetype confidence is
established. Shorter — neutral copy doesn't need to argue, only inform.

```
A {bedrooms}-bedroom property in {neighborhood}, presented in {condition} condition and offered at {price}. The layout includes {key_features}, with {parking_details} and {outdoor_space}. The building is constructed to {construction_year} standards and has been maintained throughout. Energy performance is rated {epc}. Local amenities — shops, transport, schools, and healthcare — are within walking distance, and the immediate surroundings are predominantly residential. Tenure is {tenure}, with {service_charge_details} where applicable. Viewings are available by appointment. A factual, balanced description for prospective buyers across a range of intentions and budgets.
```

---

## Placeholder reference (per archetype)

| Archetype                | Placeholders relied on                                                                                                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| first_time_buyer         | `{bedrooms}`, `{neighborhood}`                                                                                                                                                             |
| family_buyer             | `{bedrooms}`, `{neighborhood}`                                                                                                                                                             |
| upsizer                  | `{bedrooms}`, `{neighborhood}`                                                                                                                                                             |
| downsizer                | `{bedrooms}`, `{neighborhood}`                                                                                                                                                             |
| luxury_buyer             | `{key_luxury_feature}`, `{neighborhood}`                                                                                                                                                   |
| lifestyle_expat          | `{neighborhood}`                                                                                                                                                                           |
| remote_worker            | `{internet_speed}`, `{neighborhood}`                                                                                                                                                       |
| retiree_relocator        | `{bedrooms}`, `{neighborhood}`                                                                                                                                                             |
| diaspora_buyer           | `{bedrooms}`, `{neighborhood}`                                                                                                                                                             |
| second_home_buyer        | `{bedrooms}`, `{neighborhood}`, `{leisure_anchor}`                                                                                                                                         |
| student_parent           | `{bedrooms}`, `{neighborhood}`, `{university}`, `{yield_range}`                                                                                                                            |
| golden_visa_buyer        | `{bedrooms}`, `{minimum_investment}`, `{country}`, `{timeline}`                                                                                                                            |
| yield_hunter             | `{yield}`, `{neighborhood}`, `{tenancy_status}`, `{ppsqm_delta}`, `{annual_rent}`, `{running_costs}`, `{net_yield}`, `{average_void}`, `{transport_links}`                                 |
| flip_investor            | `{discount_to_market}`, `{neighborhood}`, `{budget_range}`, `{target_value}`, `{planning_scope}`, `{timeline_months}`                                                                      |
| portfolio_builder        | `{unit_count}`, `{bulk_discount}`, `{neighborhood}`                                                                                                                                        |
| vacation_rental_investor | `{neighborhood}`, `{occupancy}`, `{peak_occupancy}`, `{adr_range}`, `{management_fee}`                                                                                                     |
| commercial_investor      | `{tenant}`, `{lease_length}`, `{wault}`, `{passing_rent}`, `{erv}`, `{reversionary_pct}`, `{credit_rating}`, `{trading_history}`, `{neighborhood}`, `{mees_year}`                          |
| neutral                  | `{bedrooms}`, `{neighborhood}`, `{condition}`, `{price}`, `{key_features}`, `{parking_details}`, `{outdoor_space}`, `{construction_year}`, `{epc}`, `{tenure}`, `{service_charge_details}` |

Sonnet receives these via SEED 3 (listing_context dict) where present; unresolved tokens are removed
silently rather than left as raw `{token}` literals. This is enforced in the prompt by the SYSTEM
instruction "do NOT invent values not present here".

---

## Acceptance criteria for template verification

When reviewing this doc, Piotr should check:

1. **Voice distinctness.** Read templates 1, 5, 13 back-to-back. They should sound like three
   different copywriters wrote them. If two archetypes blur, the weaker one needs a rewrite.
2. **Factual restraint.** No template should claim something that isn't backed by either the
   listing_context schema or general property-listing convention. (E.g. `family_buyer` says
   "kitchen-diner is the kind of room where homework happens" — that's tone-setting, not a factual
   claim about the specific property. Acceptable.)
3. **Placeholder discipline.** Every `{token}` must appear in the Placeholder Reference table.
   Sonnet drops unresolved tokens, but the table is the contract.
4. **Archetype alignment.** The single most-important motivation for each archetype must appear in
   the first 30 words. (Yields for `yield_hunter`, schools for `family_buyer`, accessibility for
   `downsizer`, etc.)
5. **Length.** 100–160 words. Outside that range = rewrite. Neutral is allowed shorter.

Sign-off: Piotr's approval here triggers TICKET-COLD-003 (swap into .ts files).
