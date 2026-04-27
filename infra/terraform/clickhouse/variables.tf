variable "clickhouse_organization_id" {
  description = "ClickHouse Cloud organization ID (UUID from dashboard)"
  type        = string

  # Find in: https://console.clickhouse.cloud/organizations
  # Store in Doppler as CLICKHOUSE_ORG_ID
}

variable "clickhouse_api_key" {
  description = "ClickHouse Cloud API key ID"
  type        = string
  sensitive   = true

  # Generate via: https://console.clickhouse.cloud/organizations/<org-id>/keys
  # Store in Doppler as CLICKHOUSE_API_KEY
}

variable "clickhouse_api_secret" {
  description = "ClickHouse Cloud API key secret"
  type        = string
  sensitive   = true

  # Generated together with API key (shown only once during creation)
  # Store in Doppler as CLICKHOUSE_API_SECRET
}
