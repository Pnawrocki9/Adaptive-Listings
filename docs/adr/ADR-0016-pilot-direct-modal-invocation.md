# ADR-0016 — Pilot event delivery: direct Modal HTTPS invocation instead of Redpanda for the description + embed-seed flows

**Status:** Accepted (2026-07-03, CEO Piotr) · **Supersedes** the Redpanda HTTP-Proxy publish path
for these two flows at pilot scale · **References:** ESC-036, ADR-0005 (Modal apps disposition),
FOLLOW-458 (direct-path precedent), FOLLOW-485 (implementation)

---

## Context

The description-generation and embed-seed flows decouple the producers — control-plane
(`/api/adapt/description`, listing-embed-seed publisher; Vercel Node) and decision-api (Cloudflare
Workers) — from the Modal Python consumers via a Redpanda topic. Producers publish over Redpanda's
**HTTP Proxy (REST)** because edge/serverless runtimes cannot hold native Kafka TCP connections; the
Modal consumers poll via native Kafka (`confluent-kafka`, `REDPANDA_BROKERS` + SASL).

While standing up the never-deployed Modal layer (ESC-036) we found:

1. The prod Redpanda cluster is **Serverless**, and Redpanda's HTTP Proxy is **BYOC/Dedicated only**
   (Redpanda Cloud docs — "The HTTP Proxy API is supported for BYOC and Dedicated clusters only").
   So the edge producers cannot publish to the current cluster.
2. A **Dedicated** cluster (~$500/mo) is out of budget at pilot stage (CEO).
3. The bus's only job in these two flows is to carry a single request from the producer to Modal.
   **Modal natively supports authenticated HTTPS invocation** (web endpoints), and the consumer
   already dispatches work via `generate_description.spawn(...)`.

## Decision

For the pilot, **remove Redpanda from the description + embed-seed flows** and invoke Modal directly
over HTTPS:

- **Modal (llm-gateway):** expose one authenticated **web endpoint per flow** (`POST`,
  `Authorization: Bearer <shared secret>`) that validates the payload and calls
  `generate_description.spawn(event)` / the embed job's `.spawn(...)`. Retire the 30 s Redpanda
  pollers `consume_description_requests` / `consume_embed_seed_requests` from the deploy (code
  retained, no longer scheduled).
- **control-plane:** replace `publishDescriptionRequested` (Redpanda REST) with a `POST` to the
  Modal web endpoint URL (`MODAL_DESCRIPTION_URL`), keeping the `afterResponse()` fail-loud wrapper.
  Same for the listing-embed-seed publisher (`MODAL_EMBED_SEED_URL`).
- **Config:** add `MODAL_DESCRIPTION_URL` / `MODAL_EMBED_SEED_URL` in Vercel prod and reuse an
  existing shared secret (`INTERNAL_API_SECRET`) for endpoint auth. **Drop every `REDPANDA_*`
  requirement from the Phase-A critical path** — no Redpanda account is needed for the pilot.

### Explicitly out of scope (separate decision)

A/B assignment events (`ab-events.ts`) and the ingest Redpanda mirror still reference
`REDPANDA_REST_URL` and will **silently no-op** without it (the code already guards
`if (!redpandaUrl) return`). The measured-pilot metrics come from the control-plane's **direct**
ClickHouse/Postgres writes (`adaptation_decisions`, `conversion_labels`, `logDecisionAsync`), not
from these Redpanda events, so this is acceptable for the pilot. A follow-up decides whether to
route those directly to ClickHouse or reinstate a bus at scale.

## Consequences

**Positive** — removes the ~$500/mo Redpanda dependency and the HTTP-Proxy-on-Serverless blocker;
fewer moving parts; Modal handles async fan-out + retries via `.spawn()`; the Phase-A stand-up
runbook loses an entire vendor.

**Negative** — loses the durable buffer: if Modal is briefly unreachable, a dispatch is dropped
(same non-durability class as today's post-response `afterResponse` fire-and-forget). Couples the
control-plane directly to Modal's endpoint URL (a redeploy of Modal that changes the URL requires a
Vercel env update).

**Risks** — Modal cold-start on the web endpoint adds latency to the (already async, post-response)
dispatch — acceptable. A leaked endpoint secret would let anyone enqueue generation — mitigated by
the Bearer secret plus tenant-scoped payload validation on the Modal side.

**Reversibility** — high. The producers were already HTTP-based, so swapping the sink back to a bus
(Redpanda Dedicated for zero code change, or Upstash QStash for cheap durable delivery) is a
localized change behind the same publisher seam.

## Alternatives considered

- **Redpanda Dedicated / BYOC (~$500/mo):** has HTTP Proxy, zero code change — rejected on cost at
  pilot stage.
- **Redpanda Serverless + native-Kafka producers:** Serverless offers the Kafka API, but Cloudflare
  Workers (decision-api) cannot hold Kafka TCP and Vercel serverless connection-pooling is awkward —
  not viable.
- **Upstash QStash (HTTP queue, ~free tier, durable + retries):** a viable cheap middle-ground that
  adds a durable buffer without a Kafka cluster; deferred as the scale-up path because direct Modal
  is simpler and Modal already provides async + retry. The publisher seam makes adopting it later a
  small change.
