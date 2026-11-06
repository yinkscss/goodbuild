CREATE TABLE "app_data_email_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"email" text NOT NULL,
	"code_hash" text NOT NULL,
	"ip_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_data_email_identities" (
	"project_id" uuid NOT NULL,
	"email" text NOT NULL,
	"subject" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_data_email_identities_project_id_email_pk" PRIMARY KEY("project_id","email")
);
--> statement-breakpoint
ALTER TABLE "publications" ADD COLUMN "email_sign_in" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "app_data_sessions" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "app_data_email_codes" ADD CONSTRAINT "app_data_email_codes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_data_email_identities" ADD CONSTRAINT "app_data_email_identities_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "app_data_email_codes_lookup_idx" ON "app_data_email_codes" USING btree ("project_id","email","created_at");--> statement-breakpoint
CREATE INDEX "app_data_email_codes_created_idx" ON "app_data_email_codes" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "app_data_email_codes_ip_idx" ON "app_data_email_codes" USING btree ("ip_hash","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "app_data_email_identities_subject_idx" ON "app_data_email_identities" USING btree ("subject");