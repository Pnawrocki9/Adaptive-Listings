terraform {
  required_providers {
    redpanda = {
      source  = "redpanda-data/redpanda"
      version = "~> 1.0"
    }
  }
  required_version = ">= 1.5"
}

provider "redpanda" {
  client_id     = var.redpanda_client_id
  client_secret = var.redpanda_client_secret
}

# Cluster resources commented out until we're ready to provision.
# Uncomment in TICKET-012 (Cloudflare Worker ingest MVP).
#
# resource "redpanda_cluster" "estalara_eu" {
#   name               = "estalara-eu"
#   cloud_provider     = "aws"
#   region             = "eu-central-1"
#   throughput_tier    = "tier-1-aws-v2-arm"  # 50 MBps ingress + 150 MBps egress
#   zones              = ["euc1-az1", "euc1-az2", "euc1-az3"]
#
#   # Tier 1: ~$500/month (50 MBps ingress, 150 MBps egress)
#   # Tier 2: ~$1200/month (150 MBps ingress, 450 MBps egress)
#   # See https://redpanda.com/pricing
# }
#
# output "cluster_id" {
#   value       = redpanda_cluster.estalara_eu.id
#   description = "Redpanda cluster ID"
# }
#
# output "bootstrap_servers" {
#   value       = redpanda_cluster.estalara_eu.bootstrap_servers
#   description = "Kafka bootstrap servers (comma-separated, SASL_SSL://...)"
#   sensitive   = true
# }
#
# # Topics are managed via `redpanda_topic` resource
# # We create topics in TICKET-012 (ingest) and TICKET-015 (stream consumer)
# #
# # resource "redpanda_topic" "events" {
# #   cluster_id         = redpanda_cluster.estalara_eu.id
# #   name               = "events"
# #   partition_count    = 12  # 12 partitions for horizontal scaling
# #   replication_factor = 3   # 3x replication for durability
# #
# #   config = {
# #     "retention.ms"              = "604800000"  # 7 days (events → ClickHouse < 5 min, keep 7d for replay)
# #     "compression.type"          = "zstd"       # Best compression for event payloads
# #     "max.message.bytes"         = "1048576"    # 1 MB max per event (plenty for JSON)
# #   }
# # }
#
# # Service account for producers (Cloudflare Workers)
# # resource "redpanda_service_account" "ingest_producer" {
# #   cluster_id = redpanda_cluster.estalara_eu.id
# #   name       = "ingest-producer"
# # }
# #
# # output "producer_username" {
# #   value       = redpanda_service_account.ingest_producer.username
# #   description = "Kafka producer username (store in Doppler)"
# # }
# #
# # output "producer_password" {
# #   value       = redpanda_service_account.ingest_producer.password
# #   description = "Kafka producer password (store in Doppler)"
# #   sensitive   = true
# # }
