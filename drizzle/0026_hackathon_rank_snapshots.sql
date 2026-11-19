CREATE TABLE "hackathon_rank_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hackathon" text NOT NULL,
	"day" text NOT NULL,
	"entry_id" uuid NOT NULL,
	"rank" integer NOT NULL,
	"approvals" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "hackathon_rank_snapshots" ADD CONSTRAINT "hackathon_rank_snapshots_entry_id_hackathon_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."hackathon_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "hackathon_rank_snapshots_day_entry" ON "hackathon_rank_snapshots" USING btree ("hackathon","day","entry_id");