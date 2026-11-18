CREATE TABLE "hackathon_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_id" uuid NOT NULL,
	"goodid_root" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hackathon_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hackathon" text NOT NULL,
	"user_id" uuid NOT NULL,
	"alias" text NOT NULL,
	"title" text NOT NULL,
	"pitch" text NOT NULL,
	"live_url" text DEFAULT '' NOT NULL,
	"source_url" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hackathon_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hackathon" text NOT NULL,
	"user_id" uuid NOT NULL,
	"email" text NOT NULL,
	"flowstate" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "hackathon_approvals" ADD CONSTRAINT "hackathon_approvals_entry_id_hackathon_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."hackathon_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hackathon_entries" ADD CONSTRAINT "hackathon_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hackathon_participants" ADD CONSTRAINT "hackathon_participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "hackathon_approvals_human_unique" ON "hackathon_approvals" USING btree ("entry_id","goodid_root");--> statement-breakpoint
CREATE UNIQUE INDEX "hackathon_entries_user_unique" ON "hackathon_entries" USING btree ("hackathon","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "hackathon_participants_user_unique" ON "hackathon_participants" USING btree ("hackathon","user_id");