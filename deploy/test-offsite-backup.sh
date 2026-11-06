#!/usr/bin/env bash
# Tests offsite-backup.sh and restore-drill.sh end to end (D47), with real Postgres 16 in a throwaway
# compose project (goodbuild-o2test), real age encryption and MinIO as the S3-compatible bucket.
# Every key and password here is made up for the run. It never touches a real GoodBuild container
# or bucket. CI runs it. Needs docker, age, curl, openssl, flock and python3.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
dir="$(mktemp -d)"
project=goodbuild-o2test
compose=(docker compose -f "$dir/docker-compose.yml" --env-file "$dir/.env.production")
hc_pid=""

cleanup() {
  set +e
  [ -z "$hc_pid" ] || kill "$hc_pid" 2>/dev/null
  "${compose[@]}" down -v --remove-orphans >/dev/null 2>&1
  rm -rf "$dir"
}
trap cleanup EXIT

fail() { echo "FAIL: $*" >&2; [ -f "$dir/out.log" ] && sed 's/^/  | /' "$dir/out.log" >&2; exit 1; }
pass() { echo "ok - $*"; }

minio_user="o2test$(openssl rand -hex 4)"
minio_secret="$(openssl rand -hex 20)"
bucket=goodbuild-o2test

cat >"$dir/docker-compose.yml" <<YAML
name: $project
services:
  goodbuild-postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: goodbuild
      POSTGRES_PASSWORD: o2test
      POSTGRES_DB: goodbuild
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -h 127.0.0.1 -U goodbuild -d goodbuild"]
      interval: 2s
      timeout: 5s
      retries: 30
  minio:
    # MinIO's own images left Docker Hub and quay.io refuses anonymous pulls, so Bitnami's archived build.
    image: bitnamilegacy/minio:2025.7.23-debian-12-r5
    environment:
      MINIO_ROOT_USER: $minio_user
      MINIO_ROOT_PASSWORD: $minio_secret
    ports: ["127.0.0.1:19000:9000"]
YAML
touch "$dir/.env.production"
mkdir "$dir/tmp"

"${compose[@]}" up -d --wait --quiet-pull >/dev/null
for _ in $(seq 1 60); do
  curl -fsS -o /dev/null http://127.0.0.1:19000/minio/health/live && break
  sleep 1
done

# Test-only helper. The real scripts pass keys on stdin; argv is fine for made-up ones.
s3() { curl -sS -f --aws-sigv4 "aws:amz:us-east-1:s3" --user "$minio_user:$minio_secret" "$@"; }
s3 -X PUT "http://127.0.0.1:19000/$bucket" -o /dev/null || fail "couldn't create the test bucket"
count_objects() { s3 "http://127.0.0.1:19000/$bucket?list-type=2&prefix=$1" | grep -o '<Key>' | wc -l | tr -d ' '; }

psql_test() { "${compose[@]}" exec -T goodbuild-postgres psql -X -q -v ON_ERROR_STOP=1 -U goodbuild -d goodbuild "$@"; }
# A copy of the ledger's shape and triggers from drizzle/0010 (append-only, deferred balance check),
# plus values a dump must keep: tabs, newlines, backslashes, binary and JSON.
psql_test <<'SQL' >/dev/null
CREATE TABLE users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text, notes text, avatar bytea, meta jsonb);
CREATE TABLE balances (user_id uuid PRIMARY KEY REFERENCES users(id), balance_micro bigint NOT NULL DEFAULT 0);
CREATE TABLE ledger_entries (
  seq bigint GENERATED ALWAYS AS IDENTITY, user_id uuid NOT NULL REFERENCES users(id),
  amount_micro bigint NOT NULL, idempotency_key text NOT NULL UNIQUE);
CREATE FUNCTION money_record_refuse_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION '% on % refused', TG_OP, TG_TABLE_NAME; END; $$;
CREATE TRIGGER ledger_entries_append_only BEFORE UPDATE OR DELETE ON ledger_entries FOR EACH ROW EXECUTE FUNCTION money_record_refuse_change();
CREATE FUNCTION balance_must_match_ledger() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE t numeric; c bigint;
BEGIN
  SELECT coalesce(sum(amount_micro), 0) INTO t FROM ledger_entries WHERE user_id = NEW.user_id;
  SELECT balance_micro INTO c FROM balances WHERE user_id = NEW.user_id;
  IF coalesce(c, 0) <> t THEN RAISE EXCEPTION 'balance % differs from ledger %', c, t; END IF;
  RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER ledger_entries_match_balance AFTER INSERT ON ledger_entries DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION balance_must_match_ledger();
CREATE CONSTRAINT TRIGGER balances_match_ledger AFTER INSERT OR UPDATE ON balances DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION balance_must_match_ledger();
CREATE SCHEMA drizzle;
CREATE TABLE drizzle.__drizzle_migrations (id serial PRIMARY KEY, hash text);
INSERT INTO drizzle.__drizzle_migrations (hash) VALUES ('a'), ('b');
INSERT INTO users (email, notes, avatar, meta)
SELECT 'u' || i || '@example.test', E'line one\nline\ttwo \\ end', decode('00ff10', 'hex'), jsonb_build_object('i', i)
  FROM generate_series(1, 250) i;
BEGIN;
INSERT INTO ledger_entries (user_id, amount_micro, idempotency_key) SELECT id, 5000000, 'dep-' || id FROM users;
INSERT INTO ledger_entries (user_id, amount_micro, idempotency_key) SELECT id, -1234, 'use-' || id FROM users LIMIT 100;
INSERT INTO balances (user_id, balance_micro) SELECT user_id, sum(amount_micro) FROM ledger_entries GROUP BY user_id;
COMMIT;
SQL

age-keygen -o "$dir/owner.agekey" 2>/dev/null
age-keygen -y "$dir/owner.agekey" >"$dir/recipients.txt"
age-keygen -o "$dir/wrong.agekey" 2>/dev/null

# Stands in for healthchecks.io: records each ping's path.
python3 -I -c '
import http.server, sys
class H(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        self.rfile.read(int(self.headers.get("Content-Length", 0)))
        if self.path == "/__ready":  # readiness probe from this script; not a ping, so not recorded
            self.send_response(200); self.end_headers(); return
        open(sys.argv[1], "a").write(self.path + "\n"); self.send_response(200); self.end_headers()
    do_GET = do_POST
    def log_message(self, *a): pass
http.server.HTTPServer(("127.0.0.1", 19001), H).serve_forever()
' "$dir/pings.log" 2>"$dir/hc.err" &
hc_pid=$!
touch "$dir/pings.log"
# The server starts in the background, so wait until it answers before anything pings it. Without this
# the first backup could ping before the port was open and fail with "missing start or success ping".
hc_ready=""
for _ in $(seq 1 100); do
  kill -0 "$hc_pid" 2>/dev/null || fail "the test ping server exited (is port 19001 already in use?): $(cat "$dir/hc.err")"
  curl -fsS -m 2 -o /dev/null http://127.0.0.1:19001/__ready 2>/dev/null && { hc_ready=1; break; }
  sleep 0.1
done
[ -n "$hc_ready" ] || fail "the test ping server never started listening on 127.0.0.1:19001"

write_config() { # write_config <file> <secret>
  cat >"$1" <<EOF
S3_ENDPOINT=http://127.0.0.1:19000
S3_REGION=us-east-1
S3_BUCKET=$bucket
S3_ACCESS_KEY_ID=$minio_user
S3_SECRET_ACCESS_KEY=$2
AGE_RECIPIENTS_FILE=$dir/recipients.txt
HEALTHCHECK_URL=http://127.0.0.1:19001/ping/o2test
COMPOSE_FILE=$dir/docker-compose.yml
COMPOSE_ENV_FILE=$dir/.env.production
OFFSITE_BACKUP_LOCK=$dir/backup.lock
EOF
  chmod 600 "$1"
}
write_config "$dir/backup.env" "$minio_secret"
cp "$dir/backup.env" "$dir/restore.env"
wrong_secret="WRONG$(openssl rand -hex 16)"
write_config "$dir/bad-secret.env" "$wrong_secret"

backup() { # backup <config>; leaves the exit code in $rc
  rc=0
  TMPDIR="$dir/tmp" OFFSITE_BACKUP_CONFIG="$1" "$here/offsite-backup.sh" >"$dir/out.log" 2>&1 || rc=$?
}
restore() { # restore <args...>; leaves the exit code in $rc
  rc=0
  RESTORE_CONFIG="$dir/restore.env" TMPDIR="$dir/tmp" "$here/restore-drill.sh" "$@" >"$dir/out.log" 2>&1 || rc=$?
}
tmp_empty() { [ -z "$(ls -A "$dir/tmp")" ] || fail "files left in the temporary folder: $(ls -A "$dir/tmp")"; }
no_secret_in_log() { ! grep -qF "$1" "$dir/out.log" || fail "a secret appeared in the output"; }
no_drill_left() {
  [ -z "$(docker ps -aq --filter label=goodbuild.restore-drill=1)" ] || fail "a restore container was left running"
}

# 1. A backup goes up as an hourly and a daily copy, and pings start and success.
backup "$dir/backup.env"
[ "$rc" = 0 ] || fail "backup exited $rc"
[ "$(count_objects hourly/)" = 1 ] && [ "$(count_objects daily/)" = 1 ] || fail "expected one hourly and one daily object"
grep -qx '/ping/o2test/start' "$dir/pings.log" && grep -qx '/ping/o2test' "$dir/pings.log" || fail "missing start or success ping"
tmp_empty; no_secret_in_log "$minio_secret"
s3 "http://127.0.0.1:19000/$bucket/$(s3 "http://127.0.0.1:19000/$bucket?list-type=2&prefix=hourly/" | grep -o '<Key>[^<]*' | sed 's/<Key>//')" -o "$dir/first.tar.age"
head -c 40 "$dir/first.tar.age" | grep -q 'age-encryption.org/v1' || fail "the uploaded object isn't age-encrypted"
! grep -qa 'example.test' "$dir/first.tar.age" || fail "plain text found in the uploaded object"
pass "backup uploaded, encrypted, pinged, left nothing behind"

# 2. The restore drill brings it back and every figure matches.
restore --identity "$dir/owner.agekey" --latest
[ "$rc" = 0 ] && grep -q '^PASS: 4 tables, 852 rows' "$dir/out.log" || fail "restore drill didn't pass"
grep -q 'ledger:entries_sum_micro	1249876600' "$dir/out.log" || fail "ledger total missing from the restored figures"
no_secret_in_log "$minio_secret"; tmp_empty; no_drill_left
pass "restore drill: rows per table and ledger totals match"

# 3. A newer backup is the one --latest picks, and the daily copy is replaced, not added.
psql_test <<'SQL' >/dev/null
BEGIN;
INSERT INTO users (email) SELECT 'new' || i || '@example.test' FROM generate_series(1, 5) i;
INSERT INTO ledger_entries (user_id, amount_micro, idempotency_key) SELECT id, 7, 'new-' || id FROM users WHERE email LIKE 'new%';
INSERT INTO balances (user_id, balance_micro) SELECT id, 7 FROM users WHERE email LIKE 'new%';
COMMIT;
SQL
sleep 1
backup "$dir/backup.env"
[ "$rc" = 0 ] || fail "second backup exited $rc"
[ "$(count_objects hourly/)" = 2 ] && [ "$(count_objects daily/)" = 1 ] || fail "expected two hourly objects and still one daily"
restore --identity "$dir/owner.agekey" --latest
[ "$rc" = 0 ] && grep -q 'rows:public.users	255' "$dir/out.log" || fail "--latest didn't restore the newer backup"
pass "newest backup restored; daily copy overwritten"

# 4. The wrong private key can't decrypt.
restore --identity "$dir/wrong.agekey" --latest
[ "$rc" != 0 ] && grep -q "can't decrypt" "$dir/out.log" || fail "the wrong key wasn't refused"
tmp_empty; no_drill_left
pass "wrong key refused"

# 5. A damaged or cut-short file is refused before anything is restored.
cp "$dir/first.tar.age" "$dir/corrupt.tar.age"
size=$(wc -c <"$dir/corrupt.tar.age")
printf '\x00\x01\x02\x03' | dd of="$dir/corrupt.tar.age" bs=1 seek=$((size / 2)) conv=notrunc 2>/dev/null
restore --identity "$dir/owner.agekey" --file "$dir/corrupt.tar.age"
[ "$rc" != 0 ] && grep -q "can't decrypt" "$dir/out.log" || fail "a corrupted file wasn't refused"
head -c $((size - 100)) "$dir/first.tar.age" >"$dir/short.tar.age"
restore --identity "$dir/owner.agekey" --file "$dir/short.tar.age"
[ "$rc" != 0 ] && grep -q "can't decrypt" "$dir/out.log" || fail "a truncated file wasn't refused"
restore --identity "$dir/owner.agekey" --file "$dir/first.tar.age"
[ "$rc" = 0 ] || fail "the undamaged file didn't restore from --file"
tmp_empty; no_drill_left
pass "corrupted and truncated files refused; --file works"

# 6. A failed upload fails the run, pings /fail, uploads nothing and leaves no plain dump.
: >"$dir/pings.log"
backup "$dir/bad-secret.env"
[ "$rc" != 0 ] && grep -q 'upload of hourly/.* failed: 403' "$dir/out.log" || fail "a refused upload didn't fail the run"
grep -qx '/ping/o2test/fail' "$dir/pings.log" || fail "no /fail ping after a failed upload"
[ "$(count_objects hourly/)" = 2 ] || fail "an object appeared despite the failure"
tmp_empty; no_secret_in_log "$wrong_secret"
pass "upload failure reported"

# 7. A second run while one holds the lock does nothing and exits 75, without pinging.
: >"$dir/pings.log"
# Held by this shell on its own descriptor, so closing it releases the lock with no child left holding it.
exec 8>"$dir/backup.lock"
flock -n 8 || fail "couldn't take the test lock"
backup "$dir/backup.env"
exec 8>&-
[ "$rc" = 75 ] && grep -q 'still running' "$dir/out.log" || fail "a held lock didn't stop the run (exit $rc)"
[ ! -s "$dir/pings.log" ] || fail "a locked-out run pinged"
[ "$(count_objects hourly/)" = 2 ] || fail "a locked-out run uploaded"
pass "lock held: run skipped"

# 8. Unsafe setups are refused: a readable config, a private key where the public key belongs.
cp "$dir/backup.env" "$dir/open.env"; chmod 644 "$dir/open.env"
backup "$dir/open.env"
[ "$rc" != 0 ] && grep -q 'must be mode 600' "$dir/out.log" || fail "a world-readable config was accepted"
cp "$dir/owner.agekey" "$dir/recipients.txt.bad"; cat "$dir/recipients.txt" >>"$dir/recipients.txt.bad"
sed "s#^AGE_RECIPIENTS_FILE=.*#AGE_RECIPIENTS_FILE=$dir/recipients.txt.bad#" "$dir/backup.env" >"$dir/privkey.env"; chmod 600 "$dir/privkey.env"
backup "$dir/privkey.env"
[ "$rc" != 0 ] && grep -q 'PRIVATE key' "$dir/out.log" || fail "a private key on the server was accepted"
no_secret_in_log "AGE-SECRET-KEY"
pass "unsafe config and private key refused"

# 9. The checks run cleanly on a database without the ledger tables (main before D46).
"${compose[@]}" exec -T goodbuild-postgres psql -X -q -A -t -v ON_ERROR_STOP=1 -U goodbuild -d postgres <"$here/backup-checks.sql" >"$dir/noledger.tsv"
! grep -q '^ledger:' "$dir/noledger.tsv" || fail "ledger lines without ledger tables"
pass "checks work without the ledger tables"

# 10. Postgres down: the run fails, pings /fail and leaves nothing behind.
: >"$dir/pings.log"
"${compose[@]}" stop goodbuild-postgres >/dev/null 2>&1
backup "$dir/backup.env"
[ "$rc" != 0 ] || fail "a backup with Postgres down succeeded"
grep -qx '/ping/o2test/fail' "$dir/pings.log" || fail "no /fail ping with Postgres down"
tmp_empty
pass "database down reported"

echo "All off-site backup tests passed."
