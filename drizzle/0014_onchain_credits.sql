CREATE TABLE "onchain_credit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chain_id" integer NOT NULL,
	"tx_hash" text NOT NULL,
	"log_index" integer NOT NULL,
	"block_number" bigint NOT NULL,
	"wallet" text NOT NULL,
	"amount_micro" bigint NOT NULL,
	"user_id" uuid,
	"ledger_entry_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"credited_at" timestamp with time zone,
	CONSTRAINT "onchain_credit_events_amount_check" CHECK ("onchain_credit_events"."amount_micro" > 0)
);
--> statement-breakpoint
ALTER TABLE "onchain_credit_events" ADD CONSTRAINT "onchain_credit_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "onchain_credit_events_log_unique" ON "onchain_credit_events" USING btree ("chain_id","tx_hash","log_index");--> statement-breakpoint
CREATE INDEX "onchain_credit_events_wallet_idx" ON "onchain_credit_events" USING btree ("wallet");--> statement-breakpoint
CREATE INDEX "onchain_credit_events_block_idx" ON "onchain_credit_events" USING btree ("chain_id","block_number");