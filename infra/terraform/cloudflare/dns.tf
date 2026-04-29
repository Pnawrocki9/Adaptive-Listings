# DNS records for Cloudflare Workers and R2
# These route traffic to the deployed Workers and R2 buckets

# Ingest Worker endpoint
resource "cloudflare_record" "ingest" {
  zone_id = var.cloudflare_zone_id
  name    = var.environment == "production" ? "ingest" : "ingest-${var.environment}"
  type    = "CNAME"
  content = "${var.cloudflare_account_id}.workers.dev"
  proxied = true
  comment = "Routes ingest traffic to estalara-ingest-${var.environment} Worker"
}

# Decision API endpoint
resource "cloudflare_record" "decision_api" {
  zone_id = var.cloudflare_zone_id
  name    = var.environment == "production" ? "api" : "api-${var.environment}"
  type    = "CNAME"
  content = "${var.cloudflare_account_id}.workers.dev"
  proxied = true
  comment = "Routes decision API traffic to estalara-decision-api-${var.environment} Worker"
}

# CDN endpoint for SDK bundles
resource "cloudflare_record" "cdn" {
  zone_id = var.cloudflare_zone_id
  name    = var.environment == "production" ? "cdn" : "cdn-${var.environment}"
  type    = "CNAME"
  content = "${var.cloudflare_account_id}.r2.cloudflarestorage.com"
  proxied = true
  comment = "Serves SDK bundles from R2 bucket estalara-cdn-sdk-${var.environment}"
}
