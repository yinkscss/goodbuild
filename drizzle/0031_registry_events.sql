CREATE TABLE "registry_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"kind" integer NOT NULL,
	"builder" text NOT NULL,
	"app" text NOT NULL,
	"target" text NOT NULL,
	"tx_hash" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"batch_tx" text,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "registry_events_key_unique" UNIQUE("key"),
	CONSTRAINT "registry_events_status_known" CHECK ("registry_events"."status" in ('pending', 'sending', 'sent', 'failed')),
	CONSTRAINT "registry_events_kind_known" CHECK ("registry_events"."kind" between 0 and 5)
);
--> statement-breakpoint
CREATE INDEX "registry_events_status_idx" ON "registry_events" USING btree ("status","created_at");