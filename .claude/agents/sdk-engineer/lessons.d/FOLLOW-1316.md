**2026-11-02 / FOLLOW-1316 (SDK half)** · **Built:** `readSendableXid` (read-only, one R2 condition
per send), the flag from `buyer_profile_enabled`, `archetype_source`, the recorded consent text
version, the withdrawal control in the toggle, and delete-then-erase on every denial path. ·
**Uncertain:** the budget, not the logic: the first cut was 385 B over. The bundle reached the limit
by dropping the tooltip strings and a client copy of a check the server already makes, and by
sharing one uuid fallback. The next SDK feature has about 10 B of room. · **Wiring trap:** two
rulings seemed to conflict (the xid must not leave with the flag off; withdrawal must work flag or
not). A `sent` marker on the stored record resolves it: an id that never left has no server profile
to delete. · **Guardrail I'd add:** a harness that seeds `estalara_consent` skips the grant, so it
also skips whatever the grant records; a new grant-time key must be checked against every seeder
first.
