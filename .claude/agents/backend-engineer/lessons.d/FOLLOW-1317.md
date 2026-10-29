- **2026-10-29 / FOLLOW-1317** · Grounding reader now takes the price from `price` + `currency`
  (then `priceEur`, `priceUsd`, bare `price`) and the location from `publicLocationLabel` +
  `district` + `city` + `region`; the fixture server/page dropped `streetAddress`; grounding-source
  test now asserts both the fixture and the reader stay inside the backend DTO's field set. · Risks
  weighed: recovered WIP kept `streetAddress` as "tolerance" — a reader branch for a field no
  backend sends is a mapping bug pinned as an exception, so it went; the WIP's substring dedupe
  would drop a true city ("Lodz") named inside a street ("Lodzka") — whole-word match instead; the
  ticket's premise (backend sends only `priceUsd`/`priceEur`) was wrong against both the core-master
  source and prod (`price` + `currency` present, FX columns absent on the prod list endpoint); never
  GET prod `/listing/details` — it calls `recordView`, a prod write. · Guardrail I'd add: a ticket
  that names an external field must cite the DTO file and one live payload before code; a "localhost
  observation" alone is not a field contract.
