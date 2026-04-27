# Terragrunt Parent Configuration
# This file defines shared backend and provider configuration for all Terraform modules.

# Remote state backend configuration (Cloudflare R2, S3-compatible)
# We use R2 instead of AWS S3 because:
#   - Already in Cloudflare ecosystem
#   - 10x cheaper egress ($0.00/GB vs. $0.09/GB for S3)
#   - S3-compatible API (drop-in replacement)
#
# Prerequisites:
#   1. Create R2 bucket "estalara-tfstate" in Cloudflare dashboard
#   2. Generate R2 API token (S3-compatible credentials)
#   3. Store in Doppler:
#        CLOUDFLARE_R2_ACCESS_KEY_ID
#        CLOUDFLARE_R2_SECRET_ACCESS_KEY
#        CLOUDFLARE_ACCOUNT_ID
#
remote_state {
  backend = "s3"
  config = {
    bucket   = "estalara-tfstate"
    key      = "${path_relative_to_include()}/terraform.tfstate"
    region   = "auto"  # R2 uses "auto" region
    endpoint = "https://${get_env("CLOUDFLARE_ACCOUNT_ID", "PLACEHOLDER")}.r2.cloudflarestorage.com"

    # R2-specific settings (disable AWS-specific validation)
    skip_credentials_validation = true
    skip_region_validation      = true
    skip_metadata_api_check     = true

    # Authentication (via environment variables or Doppler)
    # AWS_ACCESS_KEY_ID = CLOUDFLARE_R2_ACCESS_KEY_ID
    # AWS_SECRET_ACCESS_KEY = CLOUDFLARE_R2_SECRET_ACCESS_KEY
  }

  generate = {
    path      = "_backend.tf"
    if_exists = "overwrite_terragrunt"
  }
}

# Generate provider version constraints for all modules
generate "provider_versions" {
  path      = "_versions.tf"
  if_exists = "overwrite"
  contents  = <<EOF
terraform {
  required_version = ">= 1.5"

  # Common providers used across modules (each module adds their own)
  required_providers {
    # Example: if we had a shared provider config, it would go here
    # In practice, each module declares its own providers
  }
}
EOF
}

# Inputs available to all child modules (override per module as needed)
inputs = {
  # Environment (dev, staging, production)
  environment = get_env("TF_VAR_environment", "dev")

  # Region (eu, us, uk, uae)
  region = get_env("TF_VAR_region", "eu")

  # Common tags for all resources
  tags = {
    project     = "estalara-adaptive-listings"
    managed_by  = "terraform"
    repository  = "github.com/estalara/adaptive-listings"
  }
}

# Terraform configuration
terraform {
  # Use Terraform 1.5+ for all modules
  extra_arguments "common_vars" {
    commands = get_terraform_commands_that_need_vars()

    # Load environment-specific variables
    optional_var_files = [
      "${get_parent_terragrunt_dir()}/terraform.tfvars",
      "${get_parent_terragrunt_dir()}/${get_env("TF_VAR_environment", "dev")}.tfvars",
    ]
  }

  # Retry on transient errors (network, rate limits)
  extra_arguments "retry_lock" {
    commands = get_terraform_commands_that_need_locking()

    arguments = [
      "-lock-timeout=5m",
    ]
  }
}
