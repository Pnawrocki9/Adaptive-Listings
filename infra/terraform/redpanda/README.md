# Redpanda Cloud Terraform Module

**Status:** Skeleton only. Resources are commented out until ready to provision.

## Overview

This module manages Redpanda Cloud clusters for the Estalara Adaptive Listings platform. We use
Redpanda for:

- **Event bus** (Kafka-compatible) between edge ingest (Cloudflare Workers) and stream consumers
  (Modal)
- **Decoupling:** Ingest ACKs immediately (latency <50ms), consumers process asynchronously
- **Replay:** Keep events for 7 days in Redpanda for reprocessing (if ClickHouse write fails, or
  schema migration)
- **Multi-region:** One cluster per region (eu, us, uk, uae)

## Why Redpanda?

- **Kafka-compatible API:** Drop-in replacement for Apache Kafka (same protocol, same clients)
- **10x faster than Kafka:** C++ implementation, no JVM overhead, no Zookeeper
- **Lower cost:** ~$500/month vs. ~$1,500/month for equivalent Confluent Kafka cluster
- **Simpler ops:** Managed service with 99.95% SLA, no tuning

**Alternatives considered:**

- Apache Kafka (MSK): Complex, expensive (~$2k/month minimum), overkill for our scale
- Confluent Cloud: 2-3x cost of Redpanda, enterprise-focused
- Pub/Sub (GCP) / EventBridge (AWS): Not Kafka-compatible, vendor lock-in
- NATS JetStream: Simpler but less mature ecosystem for our use case

See [Redpanda vs Kafka benchmark](https://redpanda.com/blog/redpanda-vs-kafka-performance).

## Architecture

Multi-region deployment:

| Region | Redpanda Region      | Purpose                          | Launched  |
| ------ | -------------------- | -------------------------------- | --------- |
| EU     | `eu-central-1` (AWS) | GDPR primary                     | Sprint 1  |
| US     | `us-east-1` (AWS)    | CCPA tenants                     | Sprint 10 |
| UK     | EU cluster (logical) | UK data residency (same cluster) | Sprint 10 |
| UAE    | AWS me-central-1     | UAE PDPL                         | Sprint 10 |

**MVP:** Only EU region provisioned in Sprint 1.

## Prerequisites

1. **Redpanda Cloud account**
   - Signup: https://console.redpanda.com
   - Free trial: 30 days (cluster with 10 MBps throughput)
   - Production: starts ~$500/month (Tier 1: 50 MBps ingress, 150 MBps egress)

2. **API credentials (OAuth2 client ID + secret)**
   - Generate: https://console.redpanda.com/settings/api
   - Scope: `cluster:write`, `topic:write`, `acl:write`
   - **Important:** Client secret shown only once — store immediately in Doppler

## Usage

### Initialize provider

```bash
cd infra/terraform/redpanda
terraform init
```

### Plan (dry-run, will show no resources since they're commented)

```bash
terraform plan \
  -var="redpanda_client_id=$(doppler secrets get REDPANDA_CLIENT_ID --plain)" \
  -var="redpanda_client_secret=$(doppler secrets get REDPANDA_CLIENT_SECRET --plain)"
```

### Apply (when ready to provision in Sprint 1)

Uncomment the `resource "redpanda_cluster"` block in `main.tf`, then:

```bash
terraform apply \
  -var="redpanda_client_id=$(doppler secrets get REDPANDA_CLIENT_ID --plain)" \
  -var="redpanda_client_secret=$(doppler secrets get REDPANDA_CLIENT_SECRET --plain)"
```

## Topics Design

We create 3 topics:

| Topic Name        | Partitions | Replication | Retention | Purpose                           |
| ----------------- | ---------- | ----------- | --------- | --------------------------------- |
| `events`          | 12         | 3           | 7 days    | All behavioral events (main bus)  |
| `events-dlq`      | 3          | 3           | 30 days   | Dead letter queue (failed writes) |
| `archetype-batch` | 1          | 3           | 24 hours  | Nightly archetype computation     |

**Partitioning strategy:** Hash by `tenant_id` (ensures events from same tenant go to same
partition, preserving order).

## Cost Estimation

| Tier   | Ingress  | Egress     | Monthly Cost | Suitable For                        |
| ------ | -------- | ---------- | ------------ | ----------------------------------- |
| Tier 1 | 50 MBps  | 150 MBps   | ~$500        | MVP (10k tenants, 10M events/day)   |
| Tier 2 | 150 MBps | 450 MBps   | ~$1,200      | Scale (50k tenants, 50M events/day) |
| Tier 3 | 600 MBps | 1,800 MBps | ~$4,500      | Enterprise (200k+ tenants)          |

**MVP estimate (10M events/day, avg 2 KB per event):**

- Ingress: 10M × 2 KB = 20 GB/day = ~2.3 MBps avg (10 MBps peak)
- Egress: 2x (one consumer reads, one retry) = 4.6 MBps avg (20 MBps peak)
- **Fits Tier 1:** $500/month (EU region)

At scale (100M events/day, 4 regions):

- Tier 2 × 4 regions = ~$4,800/month

See https://redpanda.com/pricing for latest pricing.

## Performance Budget

- **Write latency:** <10ms p95 (from Cloudflare Worker ACK to Redpanda)
- **Consumer lag:** <5 seconds p95 (event produced → consumed by Modal)
- **Retention:** 7 days (events replayed if ClickHouse insert fails)

## Security Notes

- **Authentication:** SASL/SCRAM (username/password) for producers/consumers
- **Encryption:** TLS 1.3 in transit (all clusters)
- **ACLs:** Per-topic, per-service-account ACLs (producer can only write, consumer can only read)
- **Network:** Redpanda Cloud is public by default; use IP allowlists or AWS PrivateLink for
  production

## Monitoring

Redpanda Console (built-in):

- Topic lag, throughput, partition balance
- Consumer group status (Modal stream consumer lag)
- Message inspection (debug failed events)

Access: https://console.redpanda.com/clusters/`<cluster-id>`

## Terraform Provider Docs

- Provider: https://registry.terraform.io/providers/redpanda-data/redpanda/latest/docs
- Resource `redpanda_cluster`:
  https://registry.terraform.io/providers/redpanda-data/redpanda/latest/docs/resources/cluster
- Resource `redpanda_topic`:
  https://registry.terraform.io/providers/redpanda-data/redpanda/latest/docs/resources/topic

## Next Steps

1. **TICKET-012:** Cloudflare Worker ingest MVP (validate + auth + push to Redpanda)
2. **TICKET-015:** Stream consumer Modal scaffold (Redpanda subscribe → ClickHouse insert)
3. Uncomment resources in this module once account setup is complete
