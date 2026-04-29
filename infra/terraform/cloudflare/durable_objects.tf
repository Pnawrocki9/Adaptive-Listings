# Durable Objects configuration
# DOs are managed via wrangler.toml [[migrations]] and [[durable_objects.bindings]]

# Durable Objects for ingest rate limiting
# Each tenant gets a DO instance that tracks requests per minute
# Class: RateLimiter (defined in apps/ingest/src/rate-limiter.ts)
# Binding name: RATE_LIMITER (referenced in apps/ingest/wrangler.toml)

# Note: Durable Objects are tied to the Worker script and deployed via wrangler
# This file documents the infrastructure setup but DOs are not Terraform-managed resources
# See apps/ingest/wrangler.toml for the actual DO binding configuration
