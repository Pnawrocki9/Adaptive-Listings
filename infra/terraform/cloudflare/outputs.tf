output "ingest_url" {
  description = "URL for the ingest Worker"
  value       = "https://${cloudflare_record.ingest.hostname}"
}

output "decision_api_url" {
  description = "URL for the decision API Worker"
  value       = "https://${cloudflare_record.decision_api.hostname}"
}

output "cdn_url" {
  description = "URL for the SDK CDN"
  value       = "https://${cloudflare_record.cdn.hostname}"
}

output "sdk_cdn_bucket" {
  description = "R2 bucket name for SDK CDN"
  value       = cloudflare_r2_bucket.sdk_cdn.name
}

output "tenant_assets_bucket" {
  description = "R2 bucket name for tenant assets"
  value       = cloudflare_r2_bucket.tenant_assets.name
}
