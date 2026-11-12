CREATE TABLE "hackathon_registrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hackathon" text NOT NULL,
	"user_id" uuid NOT NULL,
	"goodid_root" text NOT NULL,
	"wallet" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"start_entry_id" uuid,
	"start_micro" bigint DEFAULT 0 NOT NULL,
	"deploy_entry_id" uuid,
	"deploy_micro" bigint DEFAULT 0 NOT NULL,
	"deploy_granted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "hackathon_registrations" ADD CONSTRAINT "hackathon_registrations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "hackathon_registrations_root_unique" ON "hackathon_registrations" USING btree ("hackathon","goodid_root");--> statement-breakpoint
CREATE UNIQUE INDEX "hackathon_registrations_user_unique" ON "hackathon_registrations" USING btree ("hackathon","user_id");