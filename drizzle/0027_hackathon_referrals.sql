CREATE TABLE "hackathon_referrals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hackathon" text NOT NULL,
	"referrer_user_id" uuid NOT NULL,
	"referee_user_id" uuid NOT NULL,
	"referee_root" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone,
	"referee_entry_id" uuid,
	"referee_micro" bigint DEFAULT 0 NOT NULL,
	"referrer_entry_id" uuid,
	"referrer_micro" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "hackathon_registrations" ADD COLUMN "referral_code" text;--> statement-breakpoint
ALTER TABLE "hackathon_referrals" ADD CONSTRAINT "hackathon_referrals_referrer_user_id_users_id_fk" FOREIGN KEY ("referrer_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hackathon_referrals" ADD CONSTRAINT "hackathon_referrals_referee_user_id_users_id_fk" FOREIGN KEY ("referee_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "hackathon_referrals_referee_root" ON "hackathon_referrals" USING btree ("hackathon","referee_root");--> statement-breakpoint
CREATE UNIQUE INDEX "hackathon_referrals_referee_user" ON "hackathon_referrals" USING btree ("hackathon","referee_user_id");--> statement-breakpoint
CREATE INDEX "hackathon_referrals_referrer" ON "hackathon_referrals" USING btree ("hackathon","referrer_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "hackathon_registrations_referral_code" ON "hackathon_registrations" USING btree ("referral_code");