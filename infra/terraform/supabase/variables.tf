variable "supabase_access_token" {
  description = "Supabase Personal Access Token (PAT) from https://supabase.com/dashboard/account/tokens"
  type        = string
  sensitive   = true

  # Store in Doppler under `dev` config as SUPABASE_ACCESS_TOKEN
  # Retrieve via: doppler secrets get SUPABASE_ACCESS_TOKEN --plain
}

variable "organization_id" {
  description = "Supabase organization ID (found in org settings)"
  type        = string
  default     = ""

  # Required when creating projects. Find via:
  # https://supabase.com/dashboard/org/<slug>/general
}

variable "db_password" {
  description = "PostgreSQL database password (min 16 chars, alphanumeric)"
  type        = string
  sensitive   = true
  default     = ""

  # Generate strong password and store in Doppler as SUPABASE_DB_PASSWORD
  # Example: openssl rand -base64 32
}
