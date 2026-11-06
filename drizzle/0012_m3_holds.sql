ALTER TABLE "balances" ADD COLUMN "reserved_micro" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "turn_jobs" ADD COLUMN "hold_micro" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "turn_jobs" ADD COLUMN "released_micro" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "balances" ADD CONSTRAINT "balances_reserved_check" CHECK ("balances"."reserved_micro" >= 0);--> statement-breakpoint
ALTER TABLE "turn_jobs" ADD CONSTRAINT "turn_jobs_hold_check" CHECK ("turn_jobs"."hold_micro" >= 0 AND "turn_jobs"."released_micro" >= 0 AND ("turn_jobs"."funding" = 'paid' OR ("turn_jobs"."hold_micro" = 0 AND "turn_jobs"."released_micro" = 0)));--> statement-breakpoint
-- Hand-written below this line: drizzle-kit doesn't model triggers. See D49.
-- A paid build's hold lives on its job (hold_micro). This trigger is the only thing that changes
-- balances.reserved_micro, so the cached total always equals the open jobs' holds, whichever code
-- path, or hand-written SQL, moves a job. When a job leaves queued or running, its hold moves to
-- released_micro and becomes 0, so it is returned exactly once, and a finished job's hold can never
-- change again. Lock order: the job row first, then the user's balances row (D49).
-- Rollback note: old code never writes hold_micro, and any paid job it ends still goes through this
-- trigger, so its hold is still returned.
CREATE FUNCTION "turn_job_hold_sync"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  was_open boolean := TG_OP = 'UPDATE' AND OLD."status" IN ('queued', 'running');
  old_hold bigint := CASE WHEN TG_OP = 'UPDATE' THEN OLD."hold_micro" ELSE 0 END;
  delta bigint;
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
  ELSIF NEW."status" NOT IN ('queued', 'running') AND NEW."hold_micro" > 0 THEN
    RAISE EXCEPTION 'a finished turn job can''t be created holding credit' USING ERRCODE = 'restrict_violation';
  END IF;
  -- Ending: whatever is left of the hold goes back, once.
  IF was_open AND NEW."status" NOT IN ('queued', 'running') AND NEW."hold_micro" > 0 THEN
    NEW."released_micro" := NEW."released_micro" + NEW."hold_micro";
    NEW."hold_micro" := 0;
  END IF;
  delta := NEW."hold_micro" - old_hold;
  IF delta <> 0 THEN
    UPDATE "balances" SET "reserved_micro" = "reserved_micro" + delta, "updated_at" = now() WHERE "user_id" = NEW."user_id";
    IF NOT FOUND THEN
      RAISE EXCEPTION 'turn job % holds credit but user % has no balance', NEW."id", NEW."user_id" USING ERRCODE = 'foreign_key_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "turn_jobs_hold_sync" BEFORE INSERT OR UPDATE OF "status", "hold_micro", "released_micro", "user_id" ON "turn_jobs" FOR EACH ROW EXECUTE FUNCTION "turn_job_hold_sync"();
