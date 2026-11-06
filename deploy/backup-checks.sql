-- Figures a restore must reproduce exactly (docs/DEPLOY.md, "Off-site backups", D47).
-- offsite-backup.sh runs this inside the same snapshot that pg_dump reads, and puts the output in the
-- backup as manifest.tsv. restore-drill.sh runs the copy from the backup on the restored database and
-- compares line by line. One line per figure: key, a tab, value. Keep it read-only.
--
-- Ledger lines (D46) appear only once the ledger tables exist. The string queries run only for rows
-- that pass the WHERE, so a missing table is never parsed. "ledger:balance_mismatches" reuses the
-- invariant of balance_must_match_ledger() in drizzle/0010 and must be 0.
SELECT key || E'\t' || value FROM (
  SELECT 'rows:' || n.nspname || '.' || c.relname AS key,
         (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I.%I', n.nspname, c.relname), false, true, '')))[1]::text AS value
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE c.relkind IN ('r', 'p')
     AND n.nspname NOT IN ('pg_catalog', 'information_schema')
     AND n.nspname NOT LIKE 'pg_toast%'
     AND n.nspname NOT LIKE 'pg_temp%'
  UNION ALL
  SELECT q.key, (xpath('/row/v/text()', query_to_xml(q.sql, false, true, '')))[1]::text
    FROM (VALUES
      ('ledger:entries_sum_micro', 'SELECT coalesce(sum(amount_micro), 0) AS v FROM public.ledger_entries', 'public.ledger_entries'),
      ('ledger:entries_max_seq', 'SELECT coalesce(max(seq), 0) AS v FROM public.ledger_entries', 'public.ledger_entries'),
      ('ledger:balances_sum_micro', 'SELECT coalesce(sum(balance_micro), 0) AS v FROM public.balances', 'public.balances'),
      ('ledger:balance_mismatches',
       'SELECT count(*) AS v FROM (SELECT user_id, sum(amount_micro) AS s FROM public.ledger_entries GROUP BY user_id) e
          FULL JOIN public.balances b USING (user_id) WHERE coalesce(e.s, 0) <> coalesce(b.balance_micro, 0)',
       'public.ledger_entries')
    ) AS q(key, sql, needs)
   WHERE to_regclass(q.needs) IS NOT NULL
     AND (q.key <> 'ledger:balance_mismatches' OR to_regclass('public.balances') IS NOT NULL)
) figures
ORDER BY key;
