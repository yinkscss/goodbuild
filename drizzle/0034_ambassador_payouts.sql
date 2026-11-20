CREATE TABLE "ambassador_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid NOT NULL,
	"payout_id" uuid,
	"action" text NOT NULL,
	"detail" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ambassador_earnings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"referral_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"root" text NOT NULL,
	"amount_g" integer DEFAULT 5000 NOT NULL,
	"qualified_at" timestamp with time zone DEFAULT now() NOT NULL,
	"vote_hash" text,
	"payout_id" uuid,
	CONSTRAINT "ambassador_earnings_referral_id_unique" UNIQUE("referral_id"),
	CONSTRAINT "ambassador_earnings_root_unique" UNIQUE("root")
);
--> statement-breakpoint
CREATE TABLE "ambassador_payouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"wallet" text NOT NULL,
	"amount_g" integer NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"reason" text,
	"tx_hash" text,
	"log_index" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone,
	CONSTRAINT "ambassador_payout_status" CHECK ("ambassador_payouts"."status" in ('requested', 'processing', 'paid', 'rejected')),
	CONSTRAINT "ambassador_positive_payout" CHECK ("ambassador_payouts"."amount_g" >= 25000)
);
--> statement-breakpoint
ALTER TABLE "ambassador_audit" ADD CONSTRAINT "ambassador_audit_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ambassador_audit" ADD CONSTRAINT "ambassador_audit_payout_id_ambassador_payouts_id_fk" FOREIGN KEY ("payout_id") REFERENCES "public"."ambassador_payouts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ambassador_earnings" ADD CONSTRAINT "ambassador_earnings_referral_id_referrals_id_fk" FOREIGN KEY ("referral_id") REFERENCES "public"."referrals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ambassador_earnings" ADD CONSTRAINT "ambassador_earnings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ambassador_earnings" ADD CONSTRAINT "ambassador_earnings_payout_id_ambassador_payouts_id_fk" FOREIGN KEY ("payout_id") REFERENCES "public"."ambassador_payouts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ambassador_payouts" ADD CONSTRAINT "ambassador_payouts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ambassador_one_open_request" ON "ambassador_payouts" USING btree ("user_id") WHERE "ambassador_payouts"."status" in ('requested', 'processing');--> statement-breakpoint
CREATE UNIQUE INDEX "ambassador_transfer_once" ON "ambassador_payouts" USING btree ("tx_hash","log_index");