-- Hand-written: drizzle-kit doesn't model triggers. See D48.
-- A job and its usage keep one funding source for life (MAINNET_PLAN section 5). Without this, a paid
-- job could be switched to free and then deleted past turn_jobs_keep_paid (D46). Writing the same
-- value is allowed, so a full-row UPDATE from an ORM still works.
-- Rollback note: old code never updates funding, so it keeps working after this migration.
CREATE FUNCTION "funding_refuse_change"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."funding" IS DISTINCT FROM OLD."funding" THEN
    RAISE EXCEPTION 'UPDATE of funding on % refused: % stays %', TG_TABLE_NAME, OLD."id", OLD."funding" USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "turn_jobs_funding_fixed" BEFORE UPDATE OF "funding" ON "turn_jobs" FOR EACH ROW EXECUTE FUNCTION "funding_refuse_change"();
--> statement-breakpoint
CREATE TRIGGER "usage_events_funding_fixed" BEFORE UPDATE OF "funding" ON "usage_events" FOR EACH ROW EXECUTE FUNCTION "funding_refuse_change"();
