terraform {
  required_providers {
    supabase = {
      source  = "supabase/supabase"
      version = "~> 1.0"
    }
  }
  required_version = ">= 1.5"
}

provider "supabase" {
  access_token = var.supabase_access_token
}

# Project resources commented out until we're ready to actually create them.
# Uncomment + apply in TICKET-020 (Drizzle ORM setup) or TICKET-021 (tenant schema).
#
# resource "supabase_project" "estalara_eu" {
#   organization_id   = var.organization_id
#   name              = "estalara-eu"
#   region            = "eu-central-1"
#   database_password = var.db_password
#
#   # Free tier starts with 500MB storage, 2GB egress
#   # Pro tier ($25/mo) unlocks 8GB storage, 100GB egress, daily backups
# }
#
# output "project_id" {
#   value       = supabase_project.estalara_eu.id
#   description = "Supabase project ID for EU region"
# }
#
# output "api_url" {
#   value       = supabase_project.estalara_eu.api_url
#   description = "Supabase API URL (https://<project-ref>.supabase.co)"
# }
#
# output "db_host" {
#   value       = supabase_project.estalara_eu.database_host
#   description = "PostgreSQL connection host"
#   sensitive   = true
# }
