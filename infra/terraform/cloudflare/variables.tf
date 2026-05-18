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
  description = "Deployment environment: dev, staging, or production"
  type        = string
  default     = "staging"
  validation {
    condition     = contains(["dev", "staging", "production"], var.environment)
    error_message = "Environment must be dev, staging, or production."
  }
}
