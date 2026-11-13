CREATE TABLE "deploy_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"chain_id" integer NOT NULL,
	"source_hash" text NOT NULL,
	"wallet" text,
	"exploit_tests" text NOT NULL,
	"custody" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"owner_reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deploy_reviews" ADD CONSTRAINT "deploy_reviews_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "deploy_reviews_source_unique" ON "deploy_reviews" USING btree ("project_id","chain_id","source_hash");