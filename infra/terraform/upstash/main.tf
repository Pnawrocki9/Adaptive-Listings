terraform {
  required_providers {
    upstash = {
      source  = "upstash/upstash"
      version = "~> 1.0"
    }
  }
  required_version = ">= 1.5"
}

provider "upstash" {
  email   = var.upstash_email
  api_key = var.upstash_api_key
}

# Redis database resources commented out until we're ready to provision.
# Uncomment in Sprint 2 (TICKET-024: JWT signing + tenant scoping middleware).
#
# resource "upstash_redis_database" "estalara_session_eu" {
#   database_name = "estalara-session-eu"
#   region        = "eu-central-1"
#   tls           = true
#   multi_zone    = true  # High availability (2x cost but 99.99% SLA)
#
#   # Free tier: 10,000 commands/day
#   # Pay-as-you-go: $0.20 per 100k commands
#   # See: https://upstash.com/pricing
# }
#
# output "redis_endpoint" {
#   value       = upstash_redis_database.estalara_session_eu.endpoint
#   description = "Upstash Redis endpoint (redis-12345.upstash.io)"
#   sensitive   = true
# }
#
# output "redis_port" {
#   value       = upstash_redis_database.estalara_session_eu.port
#   description = "Upstash Redis port (default: 6379 for TLS)"
# }
#
# output "redis_password" {
#   value       = upstash_redis_database.estalara_session_eu.password
#   description = "Upstash Redis password (store in Doppler)"
#   sensitive   = true
# }
#
# # Intent cache database (separate from session cache for cost visibility)
# resource "upstash_redis_database" "estalara_intent_cache_eu" {
#   database_name = "estalara-intent-cache-eu"
#   region        = "eu-central-1"
#   tls           = true
#   multi_zone    = false  # Single-zone OK for cache (not critical, can rebuild)
#
#   # Eviction policy: allkeys-lru (cache use case)
#   eviction = true
# }
#
# output "intent_cache_endpoint" {
#   value       = upstash_redis_database.estalara_intent_cache_eu.endpoint
#   description = "Intent cache Redis endpoint"
#   sensitive   = true
# }
