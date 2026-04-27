variable "redpanda_client_id" {
  description = "Redpanda Cloud API client ID (OAuth2)"
  type        = string
  sensitive   = true

  # Generate via: https://console.redpanda.com/settings/api
  # Store in Doppler as REDPANDA_CLIENT_ID
}

variable "redpanda_client_secret" {
  description = "Redpanda Cloud API client secret (OAuth2)"
  type        = string
  sensitive   = true

  # Generated together with client ID (shown only once during creation)
  # Store in Doppler as REDPANDA_CLIENT_SECRET
}
