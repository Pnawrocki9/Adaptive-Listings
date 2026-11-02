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
