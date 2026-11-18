CREATE TABLE "gas_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"goodid_root" text NOT NULL,
	"user_id" uuid NOT NULL,
	"wallet" text NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'claimed' NOT NULL,
	"amount_wei" text,
	"nonce" integer,
	"tx_hash" text,
	"raw_tx" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	CONSTRAINT "gas_grants_goodid_root_unique" UNIQUE("goodid_root"),
	CONSTRAINT "gas_grants_status_known" CHECK ("gas_grants"."status" in ('claimed', 'signed', 'confirmed', 'needs_review')),
	CONSTRAINT "gas_grants_reason_known" CHECK ("gas_grants"."reason" in ('hackathon_vote', 'deploy'))
);
--> statement-breakpoint
ALTER TABLE "app_settings" DROP CONSTRAINT "app_settings_key_known";--> statement-breakpoint
ALTER TABLE "gas_grants" ADD CONSTRAINT "gas_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gas_grants_created_idx" ON "gas_grants" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_key_known" CHECK ("app_settings"."key" in ('mainnet_access', 'gas_grants'));