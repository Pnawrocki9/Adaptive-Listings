- **2026-11-02 / FOLLOW-1339, FOLLOW-1340** · Signed `live.signup` / `inquiry.completed` and the
  listing webhook from `core-master` (Kotlin, delivered as a patch); `channel: conversation` and
  `event_kind` in the shared schemas; a vector shared with the ingest test. · Risks weighed: the
  ticket's site (`LivestreamServiceImpl`) is only the first-join path, the buyer's register button
  is `CalendarServiceImpl`, so wiring the named class alone would have emitted nothing at K5; the
  plan's `channel: 'conversation'` was never in the enum and ingest answers 200 `accepted: 0`, so
  the client treats that as a lost conversion; a session id exists on the consent-DENIAL path too,
  so its presence proves nothing about consent; an async failure handler prints event objects, so
  the id's `toString` is redacted. The live run found a real duplicate: the Worker's own ClickHouse
  retry after a client timeout wrote one event twice (`attempts: 2`, same `event_id`). · Guardrail
  I'd add: _a ticket naming a class as "the place" gets a grep for the enum or event it writes
  before the code is written; in this repo the name was right for one of two writers_.
- **2026-11-02 / FOLLOW-1339 review round** · The webhook moved to a durable job in the save's own
  transaction; bounded executor; 429 retries; recipient and manager checks. · Risks weighed: I gave
  the only change signal of a permanent cache one second of retries, because I weighed the failure
  against the save and not against what the cache then serves. "Bumps on status ACTIVE" read
  literally would have bumped on every photo reorder, since `status` is mandatory on a PATCH, so
  only the transition counts. A review premise did not reproduce: `HttpRequest.timeout` bounded a
  stalled body on JDK 21.0.12, measured on a raw socket, so my new test cannot go red against the
  old code. · Guardrail I'd add: _for any outbound call, write down who else depends on it arriving
  before choosing how hard it retries_.
