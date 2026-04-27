variable "upstash_email" {
  description = "Upstash account email (used for API authentication)"
  type        = string

  # Email associated with Upstash account
  # Store in Doppler as UPSTASH_EMAIL
}

variable "upstash_api_key" {
  description = "Upstash API key (from console)"
  type        = string
  sensitive   = true

  # Generate via: https://console.upstash.com/account/api
  # Store in Doppler as UPSTASH_API_KEY
}
