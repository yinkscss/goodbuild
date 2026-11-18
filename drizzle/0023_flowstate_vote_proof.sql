ALTER TABLE "hackathon_participants" ADD COLUMN "flowstate_claim_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "hackathon_participants" ADD COLUMN "flowstate_tx_hash" text;--> statement-breakpoint
ALTER TABLE "hackathon_participants" ADD COLUMN "flowstate_voted_at" timestamp with time zone;