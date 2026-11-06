CREATE TABLE "balances" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"balance_micro" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "ledger_entries_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"amount_micro" bigint NOT NULL,
	"balance_after_micro" bigint NOT NULL,
	"allow_negative" boolean DEFAULT false NOT NULL,
	"ref_type" text,
	"ref_id" text,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_entries_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "ledger_entries_kind_sign_check" CHECK (("ledger_entries"."kind" = 'deposit' AND "ledger_entries"."amount_micro" > 0) OR ("ledger_entries"."kind" IN ('usage', 'refund') AND "ledger_entries"."amount_micro" < 0) OR ("ledger_entries"."kind" = 'adjust' AND "ledger_entries"."amount_micro" <> 0)),
	CONSTRAINT "ledger_entries_key_check" CHECK (length("ledger_entries"."idempotency_key") > 0),
	CONSTRAINT "ledger_entries_negative_check" CHECK ("ledger_entries"."balance_after_micro" >= 0 OR "ledger_entries"."amount_micro" > 0 OR "ledger_entries"."allow_negative"),
	CONSTRAINT "ledger_entries_allow_negative_check" CHECK (NOT "ledger_entries"."allow_negative" OR "ledger_entries"."kind" IN ('usage', 'adjust'))
);
--> statement-breakpoint
ALTER TABLE "usage_events" DROP CONSTRAINT "usage_events_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "turn_jobs" ADD COLUMN "funding" text DEFAULT 'free' NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_events" ADD COLUMN "funding" text DEFAULT 'free' NOT NULL;--> statement-breakpoint
ALTER TABLE "balances" ADD CONSTRAINT "balances_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ledger_entries_user_idx" ON "ledger_entries" USING btree ("user_id","seq");--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turn_jobs" ADD CONSTRAINT "turn_jobs_funding_check" CHECK ("turn_jobs"."funding" IN ('free', 'paid', 'exempt', 'platform'));--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_funding_check" CHECK ("usage_events"."funding" IN ('free', 'paid', 'exempt', 'platform'));--> statement-breakpoint
-- Hand-written below this line: drizzle-kit doesn't model triggers. See D45.
-- Rollback note: old code never writes the new tables, takes the funding default and never deletes a user, so it keeps working after this migration.
CREATE FUNCTION "money_record_refuse_change"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% on % refused: money records are append-only', TG_OP, TG_TABLE_NAME USING ERRCODE = 'restrict_violation';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "ledger_entries_append_only" BEFORE UPDATE OR DELETE ON "ledger_entries" FOR EACH ROW EXECUTE FUNCTION "money_record_refuse_change"();
--> statement-breakpoint
CREATE TRIGGER "ledger_entries_no_truncate" BEFORE TRUNCATE ON "ledger_entries" FOR EACH STATEMENT EXECUTE FUNCTION "money_record_refuse_change"();
--> statement-breakpoint
CREATE TRIGGER "balances_no_delete" BEFORE DELETE ON "balances" FOR EACH ROW EXECUTE FUNCTION "money_record_refuse_change"();
--> statement-breakpoint
CREATE TRIGGER "balances_no_truncate" BEFORE TRUNCATE ON "balances" FOR EACH STATEMENT EXECUTE FUNCTION "money_record_refuse_change"();
--> statement-breakpoint
CREATE FUNCTION "balance_must_match_ledger"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  entries_total numeric;
  cached bigint;
BEGIN
  SELECT coalesce(sum("amount_micro"), 0) INTO entries_total FROM "ledger_entries" WHERE "user_id" = NEW."user_id";
  SELECT "balance_micro" INTO cached FROM "balances" WHERE "user_id" = NEW."user_id";
  IF coalesce(cached, 0) <> entries_total THEN
    RAISE EXCEPTION 'balance % differs from ledger total % for user %', coalesce(cached, 0), entries_total, NEW."user_id" USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "ledger_entries_match_balance" AFTER INSERT ON "ledger_entries" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "balance_must_match_ledger"();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "balances_match_ledger" AFTER INSERT OR UPDATE ON "balances" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "balance_must_match_ledger"();
--> statement-breakpoint
CREATE FUNCTION "turn_job_keep_paid"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."funding" = 'paid' THEN
    RAISE EXCEPTION 'DELETE of paid turn job % refused: it is a money record', OLD."id" USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN OLD;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "turn_jobs_keep_paid" BEFORE DELETE ON "turn_jobs" FOR EACH ROW EXECUTE FUNCTION "turn_job_keep_paid"();
