variable "cloudflare_api_token" {
  description = "Cloudflare API token with Workers and DNS edit permissions"
  type        = string
  sensitive   = true
}

variable "cloudflare_account_id" {
  description = "Cloudflare account ID"
  type        = string
}

variable "cloudflare_zone_id" {
  description = "Cloudflare zone ID for estalara.com domain"
  type        = string
}

variable "environment" {
  # NOTE (FOLLOW-878, 2026-08-07 / ESC-052 RESOLVED, CEO option 2): "staging" is NOT
  # an environment — Doppler `stg` was byte-identical to `prd` and the `*-staging`
  # hostnames have no DNS record. The `default = "staging"` below therefore makes a
  # bare `terraform plan` plan a plane that does not exist: ALWAYS pass
  # -var="environment=...". Changing the default and the enum is entangled with the
  # unresolved `api` vs `decision` record-naming decision (FOLLOW-810) and is filed
  # as FOLLOW-896 rather than changed blind here.
  description = "Deployment environment: dev, staging, or production"
  type        = string
  default     = "staging"
  validation {
    condition     = contains(["dev", "staging", "production"], var.environment)
    error_message = "Environment must be dev, staging, or production."
  }
}
