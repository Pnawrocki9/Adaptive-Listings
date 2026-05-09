CREATE TABLE "demo_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"visibility" text NOT NULL,
	"duration" text NOT NULL,
	"token_hash" text NOT NULL,
	"shareable_link" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoke_reason" text,
	"production_domain" text,
	"persona_id" text,
	CONSTRAINT "demo_sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE INDEX "demo_sessions_tenant_id_idx" ON "demo_sessions" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "demo_sessions_token_hash_idx" ON "demo_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "demo_sessions_created_at_idx" ON "demo_sessions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "demo_sessions_active_idx" ON "demo_sessions" USING btree ("tenant_id","revoked_at") WHERE "demo_sessions"."revoked_at" IS NULL;