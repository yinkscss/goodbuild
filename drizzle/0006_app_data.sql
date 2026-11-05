CREATE TABLE "app_data_nonces" (
	"nonce" text PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "app_data_records" (
	"id" bigserial NOT NULL,
	"project_id" uuid NOT NULL,
	"collection" text NOT NULL,
	"owner_wallet" text NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL,
	"is_public" boolean DEFAULT false NOT NULL,
	"size_bytes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_data_records_project_id_collection_owner_wallet_key_pk" PRIMARY KEY("project_id","collection","owner_wallet","key")
);
--> statement-breakpoint
CREATE TABLE "app_data_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"wallet" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_data_usage" (
	"project_id" uuid NOT NULL,
	"wallet" text NOT NULL,
	"rows" integer DEFAULT 0 NOT NULL,
	"bytes" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "app_data_usage_project_id_wallet_pk" PRIMARY KEY("project_id","wallet")
);
--> statement-breakpoint
ALTER TABLE "publications" ADD COLUMN "client_id" text DEFAULT 'gbc_' || replace(gen_random_uuid()::text, '-', '') NOT NULL;--> statement-breakpoint
ALTER TABLE "publications" ADD COLUMN "data_rules" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "app_data_nonces" ADD CONSTRAINT "app_data_nonces_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_data_records" ADD CONSTRAINT "app_data_records_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_data_sessions" ADD CONSTRAINT "app_data_sessions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_data_usage" ADD CONSTRAINT "app_data_usage_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "app_data_nonces_expiry_idx" ON "app_data_nonces" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "app_data_records_list_idx" ON "app_data_records" USING btree ("project_id","collection","id");--> statement-breakpoint
CREATE INDEX "app_data_records_owner_idx" ON "app_data_records" USING btree ("project_id","owner_wallet");--> statement-breakpoint
CREATE UNIQUE INDEX "app_data_sessions_token_idx" ON "app_data_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "app_data_sessions_wallet_idx" ON "app_data_sessions" USING btree ("project_id","wallet");--> statement-breakpoint
CREATE INDEX "app_data_sessions_expiry_idx" ON "app_data_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "publications_client_idx" ON "publications" USING btree ("client_id");