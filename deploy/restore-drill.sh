#!/usr/bin/env bash
# Restore drill for the off-site backups (D47, "Off-site backups" in docs/DEPLOY.md).
# Downloads one backup, decrypts it with the owner's age PRIVATE key, restores it into a brand-new
# throwaway Postgres container (no network, random name, removed at the end) and checks that every
# figure in the backup's manifest (rows per table, ledger totals) comes out exactly the same.
# It never connects to any other database: no host, port or URL is read from anywhere.
#
#   deploy/restore-drill.sh --identity ~/goodbuild-backup.agekey --latest
#   deploy/restore-drill.sh --identity KEYFILE --key hourly/goodbuild-20261106T140000Z.tar.age
#   deploy/restore-drill.sh --identity KEYFILE --file ./goodbuild-2026-11-06.tar.age
#
# --latest and --key read the bucket settings from RESTORE_CONFIG (default ~/.config/goodbuild/restore.env,
# mode 600; template deploy/offsite-backup.env.example). Use a READ-ONLY key there, not the server's.
# Needs docker, age, curl, openssl and tar. Exit 0 means the restore matched; anything else failed.
set -euo pipefail
umask 077

log() { printf 'restore-drill: %s\n' "$*" >&2; }
die() { log "error: $*"; exit 1; }
usage() { sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//' >&2; exit 2; }

identity="${AGE_IDENTITY:-}" mode="" key="" file=""
while [ $# -gt 0 ]; do
  case "$1" in
    --identity) identity="${2:?}"; shift 2 ;;
    --latest) mode=latest; shift ;;
    --key) mode=key; key="${2:?}"; shift 2 ;;
    --file) mode=file; file="${2:?}"; shift 2 ;;
    -h|--help) usage ;;
    *) log "unknown option $1"; usage ;;
  esac
done
[ -n "$mode" ] || usage
[ -n "$identity" ] || die "pass --identity <age private key file>"
[ -r "$identity" ] || die "can't read $identity"
for tool in docker age curl openssl tar; do
  command -v "$tool" >/dev/null || die "$tool is not installed"
done
IMAGE="${POSTGRES_IMAGE:-postgres:16-alpine}"

file_mode() { stat -c '%a' "$1" 2>/dev/null || stat -f '%Lp' "$1"; }

if [ "$mode" != file ]; then
  CONFIG="${RESTORE_CONFIG:-$HOME/.config/goodbuild/restore.env}"
  [ -f "$CONFIG" ] || die "no bucket settings at $CONFIG"
  case "$(file_mode "$CONFIG")" in 600|400) ;; *) die "$CONFIG must be mode 600" ;; esac
  # shellcheck source=/dev/null
  . "$CONFIG"
  for v in S3_ENDPOINT S3_REGION S3_BUCKET S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY; do
    [ -n "${!v:-}" ] || die "$v is not set in $CONFIG"
  done
  for v in S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY; do
    case "${!v}" in *'"'*|*'\'*|*$'\n'*) die "$v contains a quote, backslash or newline" ;; esac
  done
  S3_ENDPOINT="${S3_ENDPOINT%/}"
  S3_PREFIX="${S3_PREFIX:-}"
fi

work="$(mktemp -d "${TMPDIR:-/tmp}/goodbuild-restore.XXXXXX")" || die "couldn't make a temporary folder"
container="goodbuild-restore-drill-$(openssl rand -hex 4)"
cleanup() {
  local status=$?
  set +e
  docker rm -f "$container" >/dev/null 2>&1
  rm -rf "$work"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

# s3 <output file> <url path and query>: a signed GET. Secrets go to curl on stdin.
s3() {
  local out="$1" path="$2" code
  code=$(printf 'user = "%s:%s"\naws-sigv4 = "aws:amz:%s:s3"\n' \
      "$S3_ACCESS_KEY_ID" "$S3_SECRET_ACCESS_KEY" "$S3_REGION" |
    curl -sS -m 600 --retry 3 -K - -o "$out" -w '%{http_code}' "$S3_ENDPOINT/$S3_BUCKET$path") || code="curl failed"
  if [ "$code" != 200 ]; then
    log "GET $path failed: $code $(grep -o '<Code>[^<]*</Code>' "$out" 2>/dev/null | head -1)"
    return 1
  fi
}

# Keys are ours (letters, digits, "-", ".", "/"), so "/" is the only character to encode.
enc() { printf '%s' "$1" | sed 's#/#%2F#g'; }
latest_key() {
  local after="" page=0 keys="$work/keys" q last
  : >"$keys"
  while [ "$page" -lt 100 ]; do
    page=$((page + 1))
    q="?list-type=2&prefix=$(enc "${S3_PREFIX}hourly/")"
    [ -z "$after" ] || q="$q&start-after=$(enc "$after")"
    s3 "$work/list.xml" "/$q" || return 1
    grep -o '<Key>[^<]*</Key>' "$work/list.xml" | sed 's/<[^>]*>//g' >>"$keys" || true
    grep -q '<IsTruncated>true</IsTruncated>' "$work/list.xml" || break
    last=$(tail -1 "$keys")
    [ -n "$last" ] && [ "$last" != "$after" ] || break
    after="$last"
  done
  # Names carry a UTC timestamp, so the last in sort order is the newest.
  grep '\.tar\.age$' "$keys" | sort | tail -1
}

case "$mode" in
  file)
    [ -s "$file" ] || die "$file is missing or empty"
    cp "$file" "$work/backup.tar.age"; source_name="$file" ;;
  key)
    s3 "$work/backup.tar.age" "/$key" || die "download failed"; source_name="$key" ;;
  latest)
    key=$(latest_key) || die "couldn't list the bucket"
    [ -n "$key" ] || die "no backups under ${S3_PREFIX}hourly/ in $S3_BUCKET"
    s3 "$work/backup.tar.age" "/$key" || die "download failed"; source_name="$key" ;;
esac
log "backup: $source_name ($(wc -c <"$work/backup.tar.age" | tr -d ' ') bytes)"

# age checks integrity as it decrypts, so a damaged file fails here too.
age -d -i "$identity" -o "$work/payload.tar" "$work/backup.tar.age" 2>"$work/age.err" ||
  die "can't decrypt: wrong key, or the file is damaged ($(head -1 "$work/age.err"))"
rm -f "$work/backup.tar.age"
mkdir "$work/x"
tar -xf "$work/payload.tar" -C "$work/x" goodbuild.dump manifest.tsv backup-checks.sql info.tsv ||
  die "the decrypted file isn't a GoodBuild backup"
rm -f "$work/payload.tar"
created=$(awk -F'\t' '$1 == "created" { print $2 }' "$work/x/info.tsv")
log "made at $created (UTC)"

log "starting a throwaway Postgres ($IMAGE, no network) as $container"
docker run -d --rm --name "$container" --network none --label goodbuild.restore-drill=1 \
  -e POSTGRES_USER=goodbuild -e POSTGRES_DB=goodbuild -e POSTGRES_HOST_AUTH_METHOD=trust \
  "$IMAGE" >/dev/null || die "couldn't start $IMAGE"
# The image runs a temporary server on its socket while it sets up, then restarts. TCP on
# loopback only answers once the real server is up.
for _ in $(seq 1 90); do
  docker exec "$container" pg_isready -q -h 127.0.0.1 -U goodbuild -d goodbuild 2>/dev/null && break
  sleep 1
done
docker exec "$container" pg_isready -q -h 127.0.0.1 -U goodbuild -d goodbuild || die "the throwaway Postgres didn't start"

t0=$(date +%s)
docker exec -i "$container" pg_restore -h 127.0.0.1 -U goodbuild -d goodbuild --exit-on-error \
  <"$work/x/goodbuild.dump" 2>"$work/restore.err" || die "pg_restore failed: $(tail -3 "$work/restore.err")"
restore_s=$(($(date +%s) - t0))

docker exec -i "$container" psql -X -q -A -t -v ON_ERROR_STOP=1 -h 127.0.0.1 -U goodbuild -d goodbuild \
  <"$work/x/backup-checks.sql" >"$work/restored.tsv" || die "the checks failed on the restored copy"

ok=1
if ! diff -u "$work/x/manifest.tsv" "$work/restored.tsv" >"$work/diff"; then
  ok=0
  log "MISMATCH between the backup's figures (-) and the restored copy (+):"
  cat "$work/diff" >&2
fi
mismatches=$(awk -F'\t' '$1 == "ledger:balance_mismatches" { print $2 }' "$work/restored.tsv")
if [ -n "$mismatches" ] && [ "$mismatches" != 0 ]; then
  ok=0
  log "MISMATCH: $mismatches balances differ from their ledger total"
fi

tables=$(grep -c '^rows:' "$work/restored.tsv" || true)
rows=$(awk -F'\t' '/^rows:/ { s += $2 } END { print s + 0 }' "$work/restored.tsv")
echo "Figures in the restored copy:"
sed 's/^/  /' "$work/restored.tsv"
result=$([ "$ok" = 1 ] && echo PASS || echo FAIL)
echo "$result: $tables tables, $rows rows, restored in ${restore_s}s, from $source_name (made $created)."
echo "Record line for docs/DEPLOY.md:"
echo "| $(date -u +%F) | $source_name | $tables tables, $rows rows | ${restore_s}s | $result | <your name> |"
[ "$ok" = 1 ]
