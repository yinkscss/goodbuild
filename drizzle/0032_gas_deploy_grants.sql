ALTER TABLE "gas_grants" DROP CONSTRAINT "gas_grants_goodid_root_unique";--> statement-breakpoint
ALTER TABLE "app_settings" DROP CONSTRAINT "app_settings_key_known";--> statement-breakpoint
ALTER TABLE "gas_grants" ADD COLUMN "plan_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "gas_grants_vote_root_unique" ON "gas_grants" USING btree ("goodid_root") WHERE "gas_grants"."reason" = 'hackathon_vote';--> statement-breakpoint
CREATE UNIQUE INDEX "gas_grants_plan_unique" ON "gas_grants" USING btree ("goodid_root","plan_key") WHERE "gas_grants"."plan_key" is not null;--> statement-breakpoint
CREATE INDEX "gas_grants_root_day_idx" ON "gas_grants" USING btree ("goodid_root","created_at");--> statement-breakpoint
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_key_known" CHECK ("app_settings"."key" in ('mainnet_access', 'gas_grants', 'gas_deploy_grants'));--> statement-breakpoint
ALTER TABLE "gas_grants" ADD CONSTRAINT "gas_grants_plan_key_check" CHECK (("gas_grants"."reason" = 'deploy') = ("gas_grants"."plan_key" is not null));