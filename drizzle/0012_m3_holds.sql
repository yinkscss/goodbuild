ALTER TABLE "balances" ADD COLUMN "reserved_micro" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "turn_jobs" ADD COLUMN "hold_micro" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "turn_jobs" ADD COLUMN "released_micro" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "balances" ADD CONSTRAINT "balances_reserved_check" CHECK ("balances"."reserved_micro" >= 0);--> statement-breakpoint
ALTER TABLE "turn_jobs" ADD CONSTRAINT "turn_jobs_hold_check" CHECK ("turn_jobs"."hold_micro" >= 0 AND "turn_jobs"."released_micro" >= 0 AND ("turn_jobs"."funding" = 'paid' OR ("turn_jobs"."hold_micro" = 0 AND "turn_jobs"."released_micro" = 0)));--> statement-breakpoint
-- Hand-written below this line: drizzle-kit doesn't model triggers. See D49.
-- A paid build's hold lives on its job (hold_micro). This trigger is the only thing that changes
-- balances.reserved_micro in normal running, so the cached total always equals the open jobs' holds,
-- whichever code path, or hand-written SQL, moves a job. When a job leaves queued or running, its hold
-- moves to released_micro and becomes 0, so it is returned exactly once, and a finished job's hold can
-- never change again. A hold can't grow past the balance. Lock order: the job row first, then the
-- user's balances row (D49).
-- Rollback note: old code never writes hold_micro, never creates a paid job, and refuses to start one,
-- which ends it through this trigger, so its hold is still returned.
CREATE FUNCTION "turn_job_hold_sync"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  was_open boolean := TG_OP = 'UPDATE' AND OLD."status" IN ('queued', 'running');
  old_hold bigint := CASE WHEN TG_OP = 'UPDATE' THEN OLD."hold_micro" ELSE 0 END;
  delta bigint;
  now_reserved bigint;
  now_balance bigint;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW."released_micro" IS DISTINCT FROM OLD."released_micro" THEN
      RAISE EXCEPTION 'released_micro of turn job % is set only when it ends', OLD."id" USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW."user_id" IS DISTINCT FROM OLD."user_id" AND (OLD."hold_micro" > 0 OR NEW."hold_micro" > 0) THEN
      RAISE EXCEPTION 'turn job % holds credit and can''t change user', OLD."id" USING ERRCODE = 'restrict_violation';
    END IF;
    IF NOT was_open AND NEW."hold_micro" IS DISTINCT FROM OLD."hold_micro" THEN
      RAISE EXCEPTION 'hold of finished turn job % can''t change', OLD."id" USING ERRCODE = 'restrict_violation';
    END IF;
  ELSE
    IF NEW."released_micro" <> 0 THEN
      RAISE EXCEPTION 'released_micro of a new turn job must be 0' USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW."status" NOT IN ('queued', 'running') AND NEW."hold_micro" > 0 THEN
      RAISE EXCEPTION 'a finished turn job can''t be created holding credit' USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  -- Ending: whatever is left of the hold goes back, once.
  IF was_open AND NEW."status" NOT IN ('queued', 'running') AND NEW."hold_micro" > 0 THEN
    NEW."released_micro" := NEW."released_micro" + NEW."hold_micro";
    NEW."hold_micro" := 0;
  END IF;
  delta := NEW."hold_micro" - old_hold;
  IF delta <> 0 THEN
    UPDATE "balances" SET "reserved_micro" = "reserved_micro" + delta, "updated_at" = now() WHERE "user_id" = NEW."user_id"
      RETURNING "reserved_micro", "balance_micro" INTO now_reserved, now_balance;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'turn job % holds credit but user % has no balance', NEW."id", NEW."user_id" USING ERRCODE = 'foreign_key_violation';
    END IF;
    -- Charges may take the balance below what's reserved. Nothing may reserve more than there is.
    IF delta > 0 AND now_reserved > now_balance THEN
      RAISE EXCEPTION 'turn job % would reserve % with a balance of % (more than the user has)', NEW."id", now_reserved, now_balance USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "turn_jobs_hold_sync" BEFORE INSERT OR UPDATE OF "status", "hold_micro", "released_micro", "user_id" ON "turn_jobs" FOR EACH ROW EXECUTE FUNCTION "turn_job_hold_sync"();
--> statement-breakpoint
-- The balance check from D46, made cheaper without weakening it (D49). It summed a user's whole history
-- at every commit, more than once per post, while holding the balance lock, and every call of every paid
-- build now posts. Entries can't be changed or deleted, so a running total proves the sum by induction:
-- each entry's balance_after must be its predecessor's plus its amount, and the balance must equal the
-- latest. That reads two index rows however long the history is. Checking the next entry too means an
-- entry slipped in earlier than the latest can't pass. Changing only reserved_micro now runs no check.
-- Fails the migration if history isn't already a correct chain (no code has posted entries before M3).
DO $$
DECLARE
  bad uuid;
BEGIN
  SELECT "user_id" INTO bad FROM (
    SELECT "user_id", "balance_after_micro", sum("amount_micro") OVER (PARTITION BY "user_id" ORDER BY "seq") AS running FROM "ledger_entries"
  ) e WHERE "balance_after_micro" <> running LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'ledger history of user % is not a correct running total', bad USING ERRCODE = 'check_violation';
  END IF;
END;
$$;
--> statement-breakpoint
DROP TRIGGER "ledger_entries_match_balance" ON "ledger_entries";
--> statement-breakpoint
DROP TRIGGER "balances_match_ledger" ON "balances";
--> statement-breakpoint
DROP FUNCTION "balance_must_match_ledger"();
--> statement-breakpoint
CREATE FUNCTION "balance_must_match_latest_entry"(for_user uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  latest bigint;
  cached bigint;
BEGIN
  SELECT "balance_after_micro" INTO latest FROM "ledger_entries" WHERE "user_id" = for_user ORDER BY "seq" DESC LIMIT 1;
  SELECT "balance_micro" INTO cached FROM "balances" WHERE "user_id" = for_user;
  IF coalesce(cached, 0) <> coalesce(latest, 0) THEN
    RAISE EXCEPTION 'balance % differs from ledger total % for user %', coalesce(cached, 0), coalesce(latest, 0), for_user USING ERRCODE = 'check_violation';
  END IF;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION "ledger_entry_must_chain"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  before_total bigint;
  later record;
BEGIN
  SELECT "balance_after_micro" INTO before_total FROM "ledger_entries" WHERE "user_id" = NEW."user_id" AND "seq" < NEW."seq" ORDER BY "seq" DESC LIMIT 1;
  IF NEW."balance_after_micro" <> coalesce(before_total, 0) + NEW."amount_micro" THEN
    RAISE EXCEPTION 'running total % of entry % should be %', NEW."balance_after_micro", NEW."id", coalesce(before_total, 0) + NEW."amount_micro" USING ERRCODE = 'check_violation';
  END IF;
  SELECT "balance_after_micro", "amount_micro", "id" INTO later FROM "ledger_entries" WHERE "user_id" = NEW."user_id" AND "seq" > NEW."seq" ORDER BY "seq" LIMIT 1;
  IF FOUND AND later."balance_after_micro" <> NEW."balance_after_micro" + later."amount_micro" THEN
    RAISE EXCEPTION 'running total % of entry % should be %', later."balance_after_micro", later."id", NEW."balance_after_micro" + later."amount_micro" USING ERRCODE = 'check_violation';
  END IF;
  PERFORM "balance_must_match_latest_entry"(NEW."user_id");
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION "balance_row_must_match"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM "balance_must_match_latest_entry"(NEW."user_id");
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "ledger_entries_must_chain" AFTER INSERT ON "ledger_entries" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "ledger_entry_must_chain"();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "balances_match_ledger" AFTER INSERT OR UPDATE OF "balance_micro", "user_id" ON "balances" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "balance_row_must_match"();
