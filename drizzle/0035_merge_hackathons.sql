-- D170: the FUTMinna (futminna-2026) and Kadpoly (kadpoly-2026) hackathons are merged into the main
-- one (million-2027). Safe to run again: on a second run there are no campus rows left to move.
-- Each builder could enter only one hackathon (D160), so entries can't clash. Stop if one somehow does.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "hackathon_entries"
    WHERE "hackathon" IN ('million-2027', 'futminna-2026', 'kadpoly-2026')
    GROUP BY "user_id" HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'D170 merge: a builder has entries in more than one hackathon. Remove the extra entry first.';
  END IF;
END $$;
--> statement-breakpoint
-- Signups are one per person per hackathon. Someone signed up only on a campus keeps their earliest
-- campus signup, now under the main hackathon.
UPDATE "hackathon_participants" SET "hackathon" = 'million-2027'
WHERE "id" IN (
  SELECT DISTINCT ON ("user_id") "id" FROM "hackathon_participants"
  WHERE "hackathon" IN ('futminna-2026', 'kadpoly-2026')
    AND "user_id" NOT IN (SELECT "user_id" FROM "hackathon_participants" WHERE "hackathon" = 'million-2027')
  ORDER BY "user_id", "created_at", "id"
);
--> statement-breakpoint
-- A FlowState vote recorded only on a campus signup carries over to the main one.
UPDATE "hackathon_participants" AS m SET
  "flowstate" = 'voted',
  "flowstate_tx_hash" = coalesce(m."flowstate_tx_hash", c."flowstate_tx_hash"),
  "flowstate_voted_at" = coalesce(m."flowstate_voted_at", c."flowstate_voted_at")
FROM (
  SELECT DISTINCT ON ("user_id") "user_id", "flowstate_tx_hash", "flowstate_voted_at" FROM "hackathon_participants"
  WHERE "hackathon" IN ('futminna-2026', 'kadpoly-2026') AND "flowstate" = 'voted'
  ORDER BY "user_id", "flowstate_voted_at" NULLS LAST
) AS c
WHERE m."hackathon" = 'million-2027' AND m."user_id" = c."user_id" AND m."flowstate" <> 'voted';
--> statement-breakpoint
DELETE FROM "hackathon_participants" WHERE "hackathon" IN ('futminna-2026', 'kadpoly-2026');
--> statement-breakpoint
-- Projects join the one leaderboard. Approvals belong to their project, so they move with it.
UPDATE "hackathon_entries" SET "hackathon" = 'million-2027' WHERE "hackathon" IN ('futminna-2026', 'kadpoly-2026');
--> statement-breakpoint
-- Daily ranks (arrows and Rising Star). Entry ids are unique, so these can't clash either.
UPDATE "hackathon_rank_snapshots" SET "hackathon" = 'million-2027' WHERE "hackathon" IN ('futminna-2026', 'kadpoly-2026');
