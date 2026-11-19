CREATE TABLE "build_deliveries" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"plan" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "build_drafts" (
	"job_id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"base_version" integer NOT NULL,
	"files" jsonb NOT NULL,
	"diagnostics" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "build_sponsorships" (
	"job_id" uuid PRIMARY KEY NOT NULL,
	"allowance_key" text NOT NULL,
	"limit_micro" bigint NOT NULL,
	"spent_micro" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "build_sponsorships_allowance_key_unique" UNIQUE("allowance_key"),
	CONSTRAINT "build_sponsorship_amounts" CHECK ("build_sponsorships"."limit_micro" >= 0 AND "build_sponsorships"."spent_micro" >= 0)
);
--> statement-breakpoint
ALTER TABLE "turn_jobs" ADD COLUMN "retry_of_job_id" uuid;--> statement-breakpoint
ALTER TABLE "turn_jobs" ADD COLUMN "base_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "turn_jobs" ADD COLUMN "delivery_index" integer;--> statement-breakpoint
ALTER TABLE "build_deliveries" ADD CONSTRAINT "build_deliveries_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build_drafts" ADD CONSTRAINT "build_drafts_job_id_turn_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."turn_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build_drafts" ADD CONSTRAINT "build_drafts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "turn_jobs_retry_idx" ON "turn_jobs" USING btree ("retry_of_job_id");