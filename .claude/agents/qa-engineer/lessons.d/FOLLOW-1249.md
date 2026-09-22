- **2026-09-22 / FOLLOW-1249** · Tested: that the `:8081` fixture grounding source serves the same
  listing fields the production `/api/adapt` prompt reader (`fetchListingTextFields()`) reads. The
  read set is derived at runtime by handing the real reader a recording `Proxy`, once with every
  field a string and once with every field a number, because `currency` is read only when `price` is
  a finite number. A second check drives the real reader over HTTP so that a field with the right
  name but the wrong type fails too. Two mutants (drop `region`, serve `price` as a string) were
  both killed. · Where a test could have passed over a dead wire: a hand-typed list of "the
  production fields" would have been green today and stale the day the reader changed. A key-set
  check alone would have passed a `price` served as `"385000"`, which the reader silently drops. · A
  guardrail I'd add: when a stand-in server imitates a production upstream, its test must compare
  against the consumer's OBSERVED reads, typed as the consumer requires them, not against the
  upstream's documented shape.
