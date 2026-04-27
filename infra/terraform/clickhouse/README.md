# ClickHouse Cloud Terraform Module

**Status:** Skeleton only. Resources are commented out until ready to provision.

## Overview

This module manages ClickHouse Cloud services for the Estalara Adaptive Listings platform. We use
ClickHouse for:

- **Event store** (all user behavioral events: pageview, listing_view, chat_message, etc.)
- **High-volume writes** (60k events per 1k visits, ~5-10M events/day at MVP scale)
- **Fast aggregation queries** for analytics dashboard and archetype computation
- **Partitioned by tenant_id + date** for efficient data retention and cost control

## Architecture

Multi-region deployment:

| Region | ClickHouse Cloud Region                            | Purpose                    | Launched  |
| ------ | -------------------------------------------------- | -------------------------- | --------- |
| EU     | `eu-central-1` (AWS)                               | GDPR primary               | Sprint 1  |
| US     | `us-east-1` (AWS)                                  | CCPA tenants               | Sprint 10 |
| UK     | EU instance (logical)                              | UK data residency fallback | Sprint 10 |
| UAE    | Self-hosted on AWS me-central-1 or use EU instance | UAE PDPL                   | Sprint 10 |

**MVP:** Only EU region provisioned in Sprint 1. UAE might use self-hosted ClickHouse on AWS Bahrain
region if ClickHouse Cloud doesn't support it yet.

## Why ClickHouse?

- **Append-only workload:** Events are immutable, perfect for columnar storage
- **Compression:** 10-100x compression for time-series event data
- **Fast aggregations:** `GROUP BY tenant_id, date` queries complete in <500ms on 100M rows
- **Cost-effective:** ~$500-$2k/month for 10M events/day vs. $5k+ for equivalent PostgreSQL setup
- **Native JSON:** `JSON` type for flexible event payloads

**Alternative considered:** TimescaleDB (Cloudflare uses it for small-batch writes). We chose
ClickHouse because:

- Our writes are batched (5-second windows on edge)
- Read-heavy aggregation queries (dashboard, archetype computation) benefit from columnar format
- Lower cost at scale (ClickHouse charges ~$50/TB/month storage vs. Timescale ~$200/TB/month)

See
[Cloudflare blog on ClickHouse vs TimescaleDB](https://blog.cloudflare.com/http-analytics-for-6m-requests-per-second-using-clickhouse/).

## Prerequisites

1. **ClickHouse Cloud account**
   - Signup: https://console.clickhouse.cloud/
   - Free trial: $300 credit (lasts 1-3 months depending on usage)
   - Production tier: starts ~$500/month, scales with storage + compute

2. **Organization created**
   - Create in dashboard (automatic on first login)
   - Note the Organization ID (UUID)

3. **API Key (Token Key + Token Secret)**
   - Generate: https://console.clickhouse.cloud/organizations/`<org-id>`/keys
   - Scope: `Admin` (or minimum: `Services: Write`, `Organizations: Read`)
   - **Important:** Token secret shown only once — store immediately in Doppler

## Usage

### Initialize provider

```bash
cd infra/terraform/clickhouse
terraform init
```

### Validate credentials (dry-run)

```bash
terraform plan \
  -var="clickhouse_organization_id=$(doppler secrets get CLICKHOUSE_ORG_ID --plain)" \
  -var="clickhouse_api_key=$(doppler secrets get CLICKHOUSE_API_KEY --plain)" \
  -var="clickhouse_api_secret=$(doppler secrets get CLICKHOUSE_API_SECRET --plain)"
```

### Apply (when ready to provision in Sprint 1)

Uncomment the `resource "clickhouse_service"` block in `main.tf`, then:

```bash
terraform apply \
  -var="clickhouse_organization_id=$(doppler secrets get CLICKHOUSE_ORG_ID --plain)" \
  -var="clickhouse_api_key=$(doppler secrets get CLICKHOUSE_API_KEY --plain)" \
  -var="clickhouse_api_secret=$(doppler secrets get CLICKHOUSE_API_SECRET --plain)"
```

## Cost Estimation

| Tier        | Base Cost   | Storage           | Compute (per hour) | Idle Scaling                  |
| ----------- | ----------- | ----------------- | ------------------ | ----------------------------- |
| Development | ~$50/month  | 10 GB             | ~$0.20/hour        | Yes (auto-pause after 15 min) |
| Production  | ~$500/month | 100 GB+ autoscale | ~$2/hour           | Optional                      |

**MVP estimate (100M events/month, 50 GB compressed):**

- Base: $500/month (production tier, EU region)
- Storage overage: ~$50/month (ClickHouse charges ~$0.03/GB beyond included)
- Compute: ~$200/month (8 hours/day query load)
- **Total:** ~$750-$1,000/month for EU region

At scale (1B events/month, 4 regions):

- ~$2,000-$4,000/month total

See https://clickhouse.com/pricing for latest pricing.

## Performance Budget

- **Write latency:** <50ms p95 from edge ingest to ClickHouse (batched, 5-second windows)
- **Query latency:** <500ms p95 for dashboard aggregations (1M-10M rows)
- **Retention:** 90 days hot, 365 days cold (S3 archival), then delete (compliance-driven)

## Security Notes

- **Network access:** Whitelist IP ranges or use ClickHouse Cloud private links (production)
- **Authentication:** API key (token_key + token_secret) for Terraform; service password for query
  clients
- **Encryption:** All data encrypted at rest (AES-256) and in transit (TLS 1.2+)
- **Per-tenant isolation:** Partition key `tenant_id` + column-level encryption for PII fields (see
  TICKET-014)

## Terraform Provider Docs

- Provider: https://registry.terraform.io/providers/ClickHouse/clickhouse/latest/docs
- Resource `clickhouse_service`:
  https://registry.terraform.io/providers/ClickHouse/clickhouse/latest/docs/resources/service

## Next Steps

1. **TICKET-014:** ClickHouse table DDL + first migration (events table partitioned by tenant_id)
2. **TICKET-015:** Stream consumer Modal scaffold (Redpanda → ClickHouse insert)
3. Uncomment resources in this module once account setup is complete
