CREATE TABLE "referrals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"referrer_user_id" uuid NOT NULL,
	"referee_user_id" uuid NOT NULL,
	"referee_root" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"verified_at" timestamp with time zone,
	"voted_at" timestamp with time zone,
	"settled_at" timestamp with time zone,
	"referee_entry_id" uuid,
	"referee_micro" bigint DEFAULT 0 NOT NULL,
	"referrer_entry_id" uuid,
	"referrer_micro" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "referral_code" text;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referrer_user_id_users_id_fk" FOREIGN KEY ("referrer_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referee_user_id_users_id_fk" FOREIGN KEY ("referee_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "referrals_referee_user" ON "referrals" USING btree ("referee_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "referrals_referee_root" ON "referrals" USING btree ("referee_root");--> statement-breakpoint
CREATE INDEX "referrals_referrer" ON "referrals" USING btree ("referrer_user_id");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_referral_code_unique" UNIQUE("referral_code");