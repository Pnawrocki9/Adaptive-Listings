CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"type" text NOT NULL,
	"prefix" text NOT NULL,
	"hashed_key" text NOT NULL,
	"last_4" text NOT NULL,
	"scopes" text[] DEFAULT '{}' NOT NULL,
	"allowed_origins" text[],
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"rotated_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoke_reason" text,
	CONSTRAINT "api_keys_hashed_key_unique" UNIQUE("hashed_key")
);
--> statement-breakpoint
CREATE TABLE "consent_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"session_id" text NOT NULL,
	"profile_id" uuid,
	"consent_type" text NOT NULL,
	"granted" boolean NOT NULL,
	"tos_version" text NOT NULL,
	"consent_text_hash" text,
	"ip_address" text,
	"user_agent" text,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"plan" text DEFAULT 'free' NOT NULL,
	"allowed_origins" text[] DEFAULT '{}' NOT NULL,
	"brand_config" jsonb DEFAULT '{}'::jsonb,
	"quiz_config" jsonb DEFAULT '{}'::jsonb,
	"profile_mode_enabled" boolean DEFAULT false NOT NULL,
	"profile_mode_enabled_at" timestamp with time zone,
	"profile_mode_enabled_by" uuid,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"registration_id" uuid,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "tenants_slug_unique" UNIQUE("slug"),
	CONSTRAINT "tenants_stripe_customer_id_unique" UNIQUE("stripe_customer_id"),
	CONSTRAINT "tenants_stripe_subscription_id_unique" UNIQUE("stripe_subscription_id")
);
--> statement-breakpoint
CREATE TABLE "tenant_registrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_name" text NOT NULL,
	"website_url" text NOT NULL,
	"contact_name" text NOT NULL,
	"contact_email" text NOT NULL,
	"contact_phone" text,
	"country" text NOT NULL,
	"listings_volume" text,
	"referral_source" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"tenant_id" uuid,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"rejection_reason" text,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"full_name" text,
	"tenant_id" uuid,
	"agency_role" text,
	"estalara_staff" boolean DEFAULT false NOT NULL,
	"estalara_role" text,
	"mfa_enabled" boolean DEFAULT false NOT NULL,
	"mfa_verified_at" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"last_login_ip" text,
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_sudo_auth_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "staff_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_user_id" uuid NOT NULL,
	"action" text NOT NULL,
	"target_tenant_id" uuid,
	"target_user_id" uuid,
	"payload" jsonb,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "api_keys_tenant_id_idx" ON "api_keys" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_hashed_key_idx" ON "api_keys" USING btree ("hashed_key");--> statement-breakpoint
CREATE INDEX "api_keys_active_idx" ON "api_keys" USING btree ("revoked_at") WHERE "api_keys"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "consent_records_tenant_session_idx" ON "consent_records" USING btree ("tenant_id","session_id");--> statement-breakpoint
CREATE INDEX "consent_records_type_idx" ON "consent_records" USING btree ("consent_type");--> statement-breakpoint
CREATE INDEX "consent_records_granted_at_idx" ON "consent_records" USING btree ("granted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tenants_slug_idx" ON "tenants" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "tenants_status_idx" ON "tenants" USING btree ("status");--> statement-breakpoint
CREATE INDEX "tenants_plan_idx" ON "tenants" USING btree ("plan");--> statement-breakpoint
CREATE UNIQUE INDEX "tenants_stripe_customer_idx" ON "tenants" USING btree ("stripe_customer_id");--> statement-breakpoint
CREATE INDEX "tenant_registrations_status_idx" ON "tenant_registrations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "tenant_registrations_email_idx" ON "tenant_registrations" USING btree ("contact_email");--> statement-breakpoint
CREATE INDEX "tenant_registrations_created_at_idx" ON "tenant_registrations" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "users_tenant_id_idx" ON "users" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "users_estalara_staff_idx" ON "users" USING btree ("estalara_staff") WHERE "users"."estalara_staff" = true;--> statement-breakpoint
CREATE INDEX "staff_audit_log_admin_idx" ON "staff_audit_log" USING btree ("admin_user_id");--> statement-breakpoint
CREATE INDEX "staff_audit_log_tenant_idx" ON "staff_audit_log" USING btree ("target_tenant_id");--> statement-breakpoint
CREATE INDEX "staff_audit_log_action_idx" ON "staff_audit_log" USING btree ("action");--> statement-breakpoint
CREATE INDEX "staff_audit_log_created_at_idx" ON "staff_audit_log" USING btree ("created_at");