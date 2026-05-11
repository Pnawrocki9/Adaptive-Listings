-- Enable pgvector extension (required for vector(N) columns)
CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE TABLE "archetype_embeddings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"archetype_name" text NOT NULL,
	"description" text NOT NULL,
	"embedding" vector(1024),
	"confidence_threshold" numeric(4, 3) DEFAULT '0.600',
	"sample_count" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "archetype_embeddings_archetype_name_unique" UNIQUE("archetype_name")
);
--> statement-breakpoint
CREATE TABLE "session_embeddings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"session_id" text NOT NULL,
	"embedding" vector(1024),
	"matched_archetype" text,
	"similarity_score" numeric(6, 5),
	"signal_count" integer DEFAULT 0 NOT NULL,
	"quiz_archetype" text,
	"final_archetype" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "session_embeddings_tenant_session_idx" ON "session_embeddings" USING btree ("tenant_id","session_id");--> statement-breakpoint
CREATE INDEX "session_embeddings_matched_archetype_idx" ON "session_embeddings" USING btree ("matched_archetype");--> statement-breakpoint
CREATE INDEX "session_embeddings_created_at_idx" ON "session_embeddings" USING btree ("created_at");