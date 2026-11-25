-- D177: GoodBuild's AI provider accounts. While paused_at is set, new builds wait in the queue instead of failing
-- against an empty account. The other timestamps claim the periodic probe and balance check and record alerts.
CREATE TABLE "provider_status" (
	"provider" text PRIMARY KEY NOT NULL,
	"paused_at" timestamp with time zone,
	"reason" text,
	"resumed_at" timestamp with time zone,
	"last_probe_at" timestamp with time zone,
	"last_balance_check_at" timestamp with time zone,
	"last_balance" numeric,
	"balance_currency" text,
	"low_alert_sent_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_status_known" CHECK ("provider_status"."provider" in ('deepseek', 'anthropic'))
);
