terraform {
  required_providers {
    clickhouse = {
      source  = "ClickHouse/clickhouse"
      version = "~> 1.0"
    }
  }
  required_version = ">= 1.5"
}

provider "clickhouse" {
  organization_id = var.clickhouse_organization_id
  token_key       = var.clickhouse_api_key
  token_secret    = var.clickhouse_api_secret
}

# Organization data source (read-only, validates credentials work)
# Uncomment when credentials are available
#
# data "clickhouse_organization" "estalara" {
#   id = var.clickhouse_organization_id
# }
#
# output "organization_name" {
#   value       = data.clickhouse_organization.estalara.name
#   description = "ClickHouse Cloud organization name"
# }

# Service resources commented out until we're ready to provision.
# Uncomment in TICKET-014 (ClickHouse table DDL + first migration).
#
# resource "clickhouse_service" "estalara_eu" {
#   name             = "estalara-events-eu"
#   cloud_provider   = "aws"
#   region           = "eu-central-1"
#   tier             = "production"
#   idle_scaling     = true
#   idle_timeout_minutes = 15
#
#   # Production tier starts at ~$500/mo, scales with usage
#   # Development tier (~$50/mo) available for non-prod
#   # See: https://clickhouse.com/pricing
# }
#
# output "service_id" {
#   value       = clickhouse_service.estalara_eu.id
#   description = "ClickHouse service ID (UUID)"
# }
#
# output "service_endpoint" {
#   value       = clickhouse_service.estalara_eu.endpoints[0].host
#   description = "ClickHouse HTTPS endpoint (e.g., abc123.eu-central-1.aws.clickhouse.cloud)"
#   sensitive   = true
# }
#
# # Generate service password (managed by ClickHouse Cloud)
# resource "clickhouse_service_password" "estalara_eu_default" {
#   service_id = clickhouse_service.estalara_eu.id
#   user       = "default"
# }
#
# output "service_password" {
#   value       = clickhouse_service_password.estalara_eu_default.password
#   description = "ClickHouse service password (store in Doppler)"
#   sensitive   = true
# }
