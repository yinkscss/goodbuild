CREATE TABLE "turn_events" (
	"job_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"event" jsonb NOT NULL,
	CONSTRAINT "turn_events_job_id_seq_pk" PRIMARY KEY("job_id","seq")
);
--> statement-breakpoint
CREATE TABLE "turn_job_calls" (
	"job_id" uuid NOT NULL,
	"idx" integer NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "turn_job_calls_job_id_idx_pk" PRIMARY KEY("job_id","idx")
);
--> statement-breakpoint
CREATE TABLE "turn_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"mode" text NOT NULL,
	"prompt" text NOT NULL,
	"user_message_id" uuid NOT NULL,
	"assistant_message_id" uuid,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"stop_requested" boolean DEFAULT false NOT NULL,
	"setup" jsonb,
	"next_seq" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "turn_events" ADD CONSTRAINT "turn_events_job_id_turn_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."turn_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turn_job_calls" ADD CONSTRAINT "turn_job_calls_job_id_turn_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."turn_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turn_jobs" ADD CONSTRAINT "turn_jobs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turn_jobs" ADD CONSTRAINT "turn_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "turn_jobs_status_idx" ON "turn_jobs" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "turn_jobs_project_idx" ON "turn_jobs" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "turn_jobs_one_running_idx" ON "turn_jobs" USING btree ("project_id") WHERE status = 'running';--> statement-breakpoint
CREATE UNIQUE INDEX "turn_jobs_user_message_idx" ON "turn_jobs" USING btree ("user_message_id");