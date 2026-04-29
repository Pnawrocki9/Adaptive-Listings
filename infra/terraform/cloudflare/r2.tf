# R2 bucket for SDK CDN
# Hosts compiled SDK bundles (@estalara/sdk) served via cdn.estalara.io

resource "cloudflare_r2_bucket" "sdk_cdn" {
  account_id = var.cloudflare_account_id
  name       = "estalara-cdn-sdk-${var.environment}"
  location   = "EEUR" # Eastern Europe region for EU data residency
}

# R2 bucket for tenant-uploaded assets
# Stores images, documents, PDFs uploaded by tenants

resource "cloudflare_r2_bucket" "tenant_assets" {
  account_id = var.cloudflare_account_id
  name       = "estalara-assets-${var.environment}"
  location   = "EEUR"
}
