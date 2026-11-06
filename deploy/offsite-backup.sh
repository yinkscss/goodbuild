#!/usr/bin/env bash
# Hourly encrypted off-site database backup (D47). Runs on the server as root from
# goodbuild-offsite-backup.timer. Install steps and the restore drill: "Off-site backups" in docs/DEPLOY.md.
#
# 1. pg_dump (custom format) of the compose Postgres, inside one exported snapshot, and
#    backup-checks.sql run in that same snapshot, so a restore can be compared exactly.
# 2. dump + figures + the checks SQL go into one tar, encrypted with age to the owner's PUBLIC key.
#    The private key never comes to this server, so nothing here can read old backups.
# 3. Uploaded with curl (AWS SigV4) to an S3-compatible bucket as hourly/<time> and daily/<date>.
#    Bucket lifecycle rules delete old copies, so the server's key only needs to write.
# 4. A healthchecks-style ping on start, success and failure. The check alerts when no success
#    arrives for 2 hours, which also covers a dead server.
#
# Exit codes: 0 done, 75 another run holds the lock (nothing done, no ping), anything else failed.
# Secrets come from a root-only file, reach curl on stdin (never argv) and are never printed.
set -euo pipefail
umask 077

CONFIG="${OFFSITE_BACKUP_CONFIG:-/etc/goodbuild/offsite-backup.env}"
HERE="$(cd "$(dirname "$0")" && pwd)"

log() { printf '%s offsite-backup: %s\n' "$(date -u +%FT%TZ)" "$*" >&2; }
die() { log "error: $*"; exit 1; }

file_mode() { stat -c '%a' "$1" 2>/dev/null || stat -f '%Lp' "$1"; }
file_owner() { stat -c '%u' "$1" 2>/dev/null || stat -f '%u' "$1"; }

[ -f "$CONFIG" ] || die "no config at $CONFIG (template: deploy/offsite-backup.env.example)"
[ "$(file_owner "$CONFIG")" = "$(id -u)" ] || die "$CONFIG must be owned by the user running this"
case "$(file_mode "$CONFIG")" in
  600|400) ;;
  *) die "$CONFIG must be mode 600 (it holds the bucket key)" ;;
esac
# shellcheck source=/dev/null
. "$CONFIG"

for v in S3_ENDPOINT S3_REGION S3_BUCKET S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY AGE_RECIPIENTS_FILE; do
  [ -n "${!v:-}" ] || die "$v is not set in $CONFIG"
done
for v in S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY HEALTHCHECK_URL; do
  case "${!v:-}" in *'"'*|*'\'*|*$'\n'*) die "$v contains a quote, backslash or newline" ;; esac
done
[ -s "$AGE_RECIPIENTS_FILE" ] || die "no age public key in $AGE_RECIPIENTS_FILE"
grep -q '^age1' "$AGE_RECIPIENTS_FILE" || die "$AGE_RECIPIENTS_FILE has no age1... public key"
grep -q 'AGE-SECRET-KEY' "$AGE_RECIPIENTS_FILE" && die "$AGE_RECIPIENTS_FILE holds a PRIVATE key. Only the public key belongs on the server."
CHECKS_SQL="${CHECKS_SQL:-$HERE/backup-checks.sql}"
[ -s "$CHECKS_SQL" ] || die "missing $CHECKS_SQL"
for tool in age curl openssl tar flock; do
  command -v "$tool" >/dev/null || die "$tool is not installed"
done

S3_ENDPOINT="${S3_ENDPOINT%/}"
S3_PREFIX="${S3_PREFIX:-}"
PG_USER="${PG_USER:-goodbuild}"
PG_DB="${PG_DB:-goodbuild}"
if [ -n "${PG_EXEC:-}" ]; then
  # Tests only: a command prefix that runs the Postgres client tools somewhere else.
  read -r -a pg_prefix <<<"$PG_EXEC"
else
  pg_prefix=(docker compose -f "${COMPOSE_FILE:-/opt/goodbuild/deploy/docker-compose.yml}"
    --env-file "${COMPOSE_ENV_FILE:-/opt/goodbuild/deploy/.env.production}"
    exec -T "${PG_SERVICE:-goodbuild-postgres}")
fi
pg() { "${pg_prefix[@]}" "$@"; }

sha256() { openssl dgst -sha256 -r "$1" | cut -d' ' -f1; }
md5_b64() { openssl dgst -md5 -binary "$1" | openssl base64; }

ping_check() { # ping_check <suffix> [message]
  [ -n "${HEALTHCHECK_URL:-}" ] || return 0
  printf 'url = "%s%s"\n' "${HEALTHCHECK_URL%/}" "$1" |
    curl -sS -m 10 --retry 3 -o /dev/null -K - --data-raw "${2:-}" ||
    log "warning: the health check ping ($1) failed"
}

# s3_put <file> <key>: PUT with Content-MD5 so the provider rejects a corrupted upload.
s3_put() {
  local file="$1" key="$2" code
  code=$(printf 'user = "%s:%s"\naws-sigv4 = "aws:amz:%s:s3"\n' \
      "$S3_ACCESS_KEY_ID" "$S3_SECRET_ACCESS_KEY" "$S3_REGION" |
    curl -sS -m 600 --retry 3 -K - -o "$work/response" -w '%{http_code}' \
      -T "$file" -H "Content-MD5: $(md5_b64 "$file")" -H "x-amz-content-sha256: $(sha256 "$file")" \
      -H 'Content-Type: application/octet-stream' \
      "$S3_ENDPOINT/$S3_BUCKET/$key") || code="curl failed"
  if [ "$code" != 200 ]; then
    # S3 error bodies hold a code and message, never the secret.
    log "upload of $key failed: $code $(grep -o '<Code>[^<]*</Code>' "$work/response" 2>/dev/null | head -1)"
    return 1
  fi
}

# Only one run at a time. flock releases by itself if a run dies.
LOCK="${OFFSITE_BACKUP_LOCK:-/run/lock/goodbuild-offsite-backup.lock}"
exec 9>"$LOCK"
if ! flock -n 9; then
  log "another backup is still running (lock $LOCK), so this run does nothing"
  exit 75
fi

work="$(mktemp -d "${TMPDIR:-/tmp}/goodbuild-offsite.XXXXXX")" || die "couldn't make a temporary folder"
snap_pid=""
finish() {
  local status=$?
  set +e
  if [ -n "$snap_pid" ]; then kill "$snap_pid" 2>/dev/null; fi
  rm -rf "$work"
  if [ "$status" -ne 0 ]; then
    log "FAILED (exit $status). This run's backup is not safely off the server."
    ping_check /fail "exit $status"
  fi
  exit "$status"
}
trap finish EXIT
trap 'exit 130' INT TERM

ping_check /start
started=$(date +%s)
stamp=$(date -u +%Y%m%dT%H%M%SZ)
day=$(date -u +%F)

# One REPEATABLE READ transaction exports its snapshot. pg_dump reads that snapshot, then the
# figures are taken in the same transaction, so they describe exactly what the dump holds.
coproc SNAP { pg psql -X -q -A -t -v ON_ERROR_STOP=1 -U "$PG_USER" -d "$PG_DB" 2>&1; }
snap_pid=$SNAP_PID
exec 7>&"${SNAP[1]}" 8<&"${SNAP[0]}"
printf 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\nSELECT pg_export_snapshot();\n' >&7
read -r -t 60 snapshot <&8 || die "couldn't open a snapshot in Postgres"
[[ "$snapshot" =~ ^[0-9A-F]+-[0-9A-F]+-[0-9]+$ ]] || die "Postgres didn't return a snapshot id: $snapshot"

pg pg_dump -U "$PG_USER" -d "$PG_DB" --format=custom --snapshot="$snapshot" </dev/null >"$work/goodbuild.dump" ||
  die "pg_dump failed"
[ -s "$work/goodbuild.dump" ] || die "pg_dump wrote nothing"

{ cat "$CHECKS_SQL"; printf "\nSELECT '__end__';\n"; } >&7
: >"$work/manifest.tsv"
while :; do
  read -r -t 300 line <&8 || die "couldn't read the figures from Postgres"
  [ "$line" = "__end__" ] && break
  case "$line" in *$'\t'*) printf '%s\n' "$line" >>"$work/manifest.tsv" ;; *) die "unexpected Postgres output: $line" ;; esac
done
printf 'COMMIT;\n\\q\n' >&7
exec 7>&- 8<&-
wait "$snap_pid" || die "the snapshot session ended with an error"
snap_pid=""
[ -s "$work/manifest.tsv" ] || die "the figures came back empty"

# The archive must be readable by pg_restore before it's worth sending.
pg pg_restore --list <"$work/goodbuild.dump" >/dev/null || die "pg_restore can't read the new dump"

cp "$CHECKS_SQL" "$work/backup-checks.sql"
printf 'created\t%s\nsnapshot\t%s\n' "$stamp" "$snapshot" >"$work/info.tsv"
tar -cf "$work/payload.tar" -C "$work" goodbuild.dump manifest.tsv backup-checks.sql info.tsv
rm -f "$work/goodbuild.dump"
age -R "$AGE_RECIPIENTS_FILE" -o "$work/payload.tar.age" "$work/payload.tar" || die "age encryption failed"
rm -f "$work/payload.tar"
[ -s "$work/payload.tar.age" ] || die "the encrypted file is empty"

hourly="${S3_PREFIX}hourly/goodbuild-$stamp.tar.age"
daily="${S3_PREFIX}daily/goodbuild-$day.tar.age"
s3_put "$work/payload.tar.age" "$hourly" || die "upload failed"
# Overwritten each hour, so the day's copy is that day's last good backup.
s3_put "$work/payload.tar.age" "$daily" || die "upload failed"

bytes=$(wc -c <"$work/payload.tar.age" | tr -d ' ')
tables=$(grep -c '^rows:' "$work/manifest.tsv" || true)
summary="$hourly, $bytes bytes, $tables tables, $(($(date +%s) - started))s"
log "ok: $summary"
ping_check "" "$summary"
