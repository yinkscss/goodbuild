CREATE TABLE "ambassador_cashouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payout_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"wallet" text NOT NULL,
	"goodcash_id" text NOT NULL,
	"mode" text NOT NULL,
	"amount_g" integer NOT NULL,
	"naira" integer DEFAULT 0 NOT NULL,
	"naira_per_dollar" text,
	"status" text DEFAULT 'awaiting_signature' NOT NULL,
	"bank_name" text NOT NULL,
	"account_name" text NOT NULL,
	"account_last4" text NOT NULL,
	"tx_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone,
	CONSTRAINT "ambassador_cashouts_goodcash_id_unique" UNIQUE("goodcash_id"),
	CONSTRAINT "ambassador_cashout_status" CHECK ("ambassador_cashouts"."status" in ('awaiting_signature', 'sent', 'processing', 'paid', 'failed', 'refunded', 'expired'))
);
--> statement-breakpoint
ALTER TABLE "ambassador_cashouts" ADD CONSTRAINT "ambassador_cashouts_payout_id_ambassador_payouts_id_fk" FOREIGN KEY ("payout_id") REFERENCES "public"."ambassador_payouts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ambassador_cashouts" ADD CONSTRAINT "ambassador_cashouts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ambassador_cashout_one_active" ON "ambassador_cashouts" USING btree ("payout_id") WHERE "ambassador_cashouts"."status" in ('awaiting_signature', 'sent', 'processing', 'paid');--> statement-breakpoint
CREATE INDEX "ambassador_cashouts_user" ON "ambassador_cashouts" USING btree ("user_id");