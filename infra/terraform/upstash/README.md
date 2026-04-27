# Upstash Redis Terraform Module

**Status:** Skeleton only. Resources are commented out until ready to provision.

## Overview

This module manages Upstash Redis databases for the Estalara Adaptive Listings platform. We use
Upstash Redis for:

- **Session cache** (JWT tokens, tenant configs, rate limit counters)
- **Intent vector cache** (real-time intent updates, read from Decision API)
- **Behavioral fingerprints** (session-scoped, ephemeral, Mode A privacy)
- **WebSocket state** (live chat sessions, active adaptations)

## Why Upstash?

- **Serverless Redis:** Pay per request ($0.20 per 100k commands), no idle cost
- **Multi-region:** Global replication with <50ms cross-region latency
- **Cloudflare Workers integration:** Native support via REST API (no TCP connection pool)
- **Durable:** Data persisted to S3 every minute (vs. traditional Redis in-memory only)

**Alternatives considered:**

- Redis Cloud (Redis Labs): More expensive (~$10/month minimum), overkill for serverless
- ElastiCache: AWS-only, requires VPC, slower provisioning
- Cloudflare KV: Eventually consistent, not suitable for session/rate-limit use case
- Cloudflare Durable Objects: Expensive for high-volume reads ($5/M reads vs. Upstash $0.20/M)

See
[Cloudflare Workers + Upstash guide](https://upstash.com/docs/redis/tutorials/cloudflare-workers-with-redis).

## Architecture

Multi-region deployment:

| Region | Upstash Region     | Purpose                      | Databases       | Launched  |
| ------ | ------------------ | ---------------------------- | --------------- | --------- |
| EU     | `eu-central-1`     | GDPR primary                 | session, intent | Sprint 2  |
| US     | `us-east-1`        | CCPA tenants                 | session, intent | Sprint 10 |
| UK     | EU region (shared) | UK data residency fallback   | session, intent | Sprint 10 |
| UAE    | `ap-southeast-1`   | Middle East (closest region) | session, intent | Sprint 10 |

**MVP:** Only EU region provisioned in Sprint 2. Cross-region replication added in Sprint 10.

## Prerequisites

1. **Upstash account**
   - Signup: https://console.upstash.com
   - Free tier: 10,000 commands/day (enough for local dev + testing)
   - Pay-as-you-go: $0.20 per 100k commands

2. **API Key**
   - Generate: https://console.upstash.com/account/api
   - **Important:** Store immediately in Doppler (cannot be retrieved again)

## Usage

### Initialize provider

```bash
cd infra/terraform/upstash
terraform init
```

### Plan (dry-run, will show no resources since they're commented)

```bash
terraform plan \
  -var="upstash_email=$(doppler secrets get UPSTASH_EMAIL --plain)" \
  -var="upstash_api_key=$(doppler secrets get UPSTASH_API_KEY --plain)"
```

### Apply (when ready to provision in Sprint 2)

Uncomment the `resource "upstash_redis_database"` blocks in `main.tf`, then:

```bash
terraform apply \
  -var="upstash_email=$(doppler secrets get UPSTASH_EMAIL --plain)" \
  -var="upstash_api_key=$(doppler secrets get UPSTASH_API_KEY --plain)"
```

## Databases Design

We create 2 databases per region:

| Database Name              | Purpose                           | Eviction  | Multi-Zone | TTL Strategy                     |
| -------------------------- | --------------------------------- | --------- | ---------- | -------------------------------- |
| `estalara-session-eu`      | Session cache, JWT, rate limits   | No        | Yes (HA)   | 1h (session), 1m (rate limit)    |
| `estalara-intent-cache-eu` | Intent vectors, real-time updates | Yes (LRU) | No         | 24h (intent), no TTL (archetype) |

**Why separate databases:**

- Cost visibility (track session vs. intent cache usage separately)
- Different eviction policies (session = no eviction, intent = LRU)
- Different SLA requirements (session = 99.99% HA, intent = 99.9% single-zone OK)

## Cost Estimation

| Usage Level         | Commands/Day | Commands/Month | Monthly Cost | Use Case                     |
| ------------------- | ------------ | -------------- | ------------ | ---------------------------- |
| Free Tier           | 10k          | 300k           | $0           | Dev + testing                |
| MVP (10k tenants)   | 5M           | 150M           | ~$300        | 50 req/s avg, 200 req/s peak |
| Scale (50k tenants) | 25M          | 750M           | ~$1,500      | 250 req/s avg, 1k req/s peak |

**MVP estimate (10k tenants, 50 req/s):**

- Session reads: 30 req/s × 86,400s = 2.6M/day
- Intent cache reads: 20 req/s × 86,400s = 1.7M/day
- Writes: 10% of reads = 430k/day
- **Total:** ~5M commands/day = 150M/month = ~$300/month (EU region)

At scale (100k tenants, 4 regions):

- ~$1,200-$1,500/month total

See https://upstash.com/pricing for latest pricing.

## Performance Budget

- **Read latency:** <5ms p95 (from Cloudflare Worker to Upstash)
- **Write latency:** <10ms p95
- **Availability:** 99.99% SLA (multi-zone), 99.9% SLA (single-zone)
- **TTL:** Automatic expiration (no manual cleanup jobs)

## Access Patterns

### Session cache (from Cloudflare Workers)

```javascript
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: env.UPSTASH_REDIS_URL,
  token: env.UPSTASH_REDIS_TOKEN,
});

// JWT session lookup (1h TTL)
const session = await redis.get(`session:${sessionId}`);
await redis.setex(`session:${sessionId}`, 3600, JSON.stringify(sessionData));

// Rate limit (1-minute rolling window)
const key = `ratelimit:${tenantId}:${minute}`;
const count = await redis.incr(key);
await redis.expire(key, 60);
if (count > 1000) {
  throw new Error('Rate limit exceeded');
}
```

### Intent cache (from Next.js Decision API)

```javascript
// Intent vector (24h TTL)
const intentVector = await redis.get(`intent:${sessionId}`);
await redis.setex(`intent:${sessionId}`, 86400, JSON.stringify(vector));

// Archetype mapping (no TTL, updated nightly)
const archetype = await redis.get(`archetype:${archetypeId}`);
await redis.set(`archetype:${archetypeId}`, JSON.stringify(archetypeData));
```

## Security Notes

- **TLS:** All connections use TLS 1.3 (enforce in Cloudflare Workers)
- **Authentication:** REST API token (rotated every 90 days via Doppler)
- **Network:** Upstash is public by default; use Cloudflare Workers origin validation
- **Data residency:** EU region stores EU tenant data only (GDPR compliance)

## Monitoring

Upstash Console metrics (built-in):

- Commands per second (read/write split)
- Latency percentiles (p50, p95, p99)
- Memory usage (MB)
- Hit rate (cache efficiency)

Access: https://console.upstash.com/redis/`<database-id>`

## Terraform Provider Docs

- Provider: https://registry.terraform.io/providers/upstash/upstash/latest/docs
- Resource `upstash_redis_database`:
  https://registry.terraform.io/providers/upstash/upstash/latest/docs/resources/redis_database

## Next Steps

1. **TICKET-024:** JWT signing + tenant scoping middleware (Hono + Next.js)
2. **Sprint 4:** Intent Engine caching (real-time intent vector updates)
3. Uncomment resources in this module once account setup is complete
