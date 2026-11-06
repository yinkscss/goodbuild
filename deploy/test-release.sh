#!/usr/bin/env bash
# Tests release.sh and rollback.sh against real Docker, with a tiny throwaway project and image.
# It uses its own names (goodbuild-o1test) and never touches a real GoodBuild container. CI runs it.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
dir="$(mktemp -d)"
export GOODBUILD_IMAGE=goodbuild-o1test
image="$GOODBUILD_IMAGE"
compose=(docker compose --env-file .env.production)

cleanup() {
  (cd "$dir" && "${compose[@]}" down -v --remove-orphans >/dev/null 2>&1) || true
  docker images "$image" --format '{{.Repository}}:{{.Tag}}' | xargs -r docker image rm -f >/dev/null 2>&1 || true
  rm -rf "$dir"
}
trap cleanup EXIT

cp "$here/release.sh" "$here/rollback.sh" "$dir/"
cd "$dir"
touch .env.production
good_dockerfile='FROM busybox:1.36
COPY VERSION /version
CMD ["sleep", "600"]'
cat > docker-compose.yml <<'YAML'
name: goodbuild-o1test
services:
  migrate:
    image: goodbuild-o1test:latest
    command: ["true"]
    restart: "no"
  web:
    image: goodbuild-o1test:latest
    build: .
    init: true
    depends_on:
      migrate:
        condition: service_completed_successfully
  worker:
    image: goodbuild-o1test:latest
    init: true
    depends_on:
      migrate:
        condition: service_completed_successfully
YAML

fail() { echo "FAILED: $1" >&2; exit 1; }
deploy() { # version
  printf '%s\n' "$good_dockerfile" > Dockerfile
  echo "$1" > VERSION
  bash release.sh "sha-$1" > release.log 2>&1 || { cat release.log >&2; fail "deploy $1"; }
}
running() { "${compose[@]}" exec -T "$1" cat /version; }
expect_running() { # version, why
  [ "$(running web)" = "$1" ] && [ "$(running worker)" = "$1" ] || fail "$2: expected $1, web=$(running web) worker=$(running worker)"
}
id_of() { docker image inspect --format '{{.Id}}' "$image:$1"; }
migrate_started() { docker inspect --format '{{.State.StartedAt}}' goodbuild-o1test-migrate-1; }

deploy v1
expect_running v1 "first deploy"
docker image inspect "$image:previous" >/dev/null 2>&1 && fail "first deploy has no previous image"

deploy v2
expect_running v2 "second deploy"
[ "$(id_of previous)" = "$(id_of sha-v1)" ] || fail "previous should be v1 after deploying v2"

# A failed build changes nothing: the old containers run on and previous stays.
printf 'FROM busybox:1.36\nRUN false\n' > Dockerfile
if bash release.sh sha-broken >/dev/null 2>&1; then fail "a broken build should fail the release"; fi
expect_running v2 "after a failed build"
[ "$(id_of previous)" = "$(id_of sha-v1)" ] || fail "a failed build moved previous"
[ "$(id_of latest)" = "$(id_of sha-v2)" ] || fail "a failed build moved latest"
docker image inspect "$image:sha-broken" >/dev/null 2>&1 && fail "a failed build got a tag"

# Rolling back runs no migration.
before="$(migrate_started)"
bash rollback.sh previous >/dev/null 2>&1
expect_running v1 "rollback to previous"
[ "$(migrate_started)" = "$before" ] || fail "rollback restarted migrate"
[ "$(id_of latest)" = "$(id_of sha-v1)" ] || fail "rollback didn't move latest"

# Running it again is harmless, and an ordinary "up -d" doesn't undo it.
bash rollback.sh previous >/dev/null 2>&1
expect_running v1 "second rollback"
"${compose[@]}" up -d --no-build >/dev/null 2>&1
expect_running v1 "up -d after a rollback"

# A named commit works, and a bad name changes nothing.
bash rollback.sh sha-v2 >/dev/null 2>&1
expect_running v2 "rollback to a named commit"
if bash rollback.sh sha-nope >/dev/null 2>&1; then fail "an unknown tag should fail"; fi
expect_running v2 "after an unknown tag"

# The listing changes nothing.
bash rollback.sh >/dev/null
expect_running v2 "after listing"

# The next deploy after a rollback keeps what was running as previous.
bash rollback.sh sha-v1 >/dev/null 2>&1
deploy v3
expect_running v3 "deploy after a rollback"
[ "$(id_of previous)" = "$(id_of sha-v1)" ] || fail "previous should be the rolled-back image"

# Only the newest five commit tags stay, and previous survives losing its commit tag.
for v in v4 v5 v6 v7 v8 v9; do sleep 1; deploy "$v"; done
tags="$(docker images "$image" --format '{{.Tag}}' | grep -c '^sha-')"
[ "$tags" = "5" ] || fail "expected 5 commit tags, found $tags"
[ "$(id_of previous)" = "$(id_of sha-v8)" ] || fail "previous should be v8"
bash rollback.sh previous >/dev/null 2>&1
expect_running v8 "rollback after pruning"

# Production before O1: "latest" is the only name the running image has. The next release must still
# keep it as previous, and leave no holding tag behind.
printf '%s\n' "$good_dockerfile" > Dockerfile
echo v10 > VERSION
"${compose[@]}" build >/dev/null 2>&1 && "${compose[@]}" up -d >/dev/null 2>&1 || fail "plain build of v10"
expect_running v10 "plain build"
deploy v11
expect_running v11 "deploy over an image named only latest"
docker image inspect "$image:outgoing" >/dev/null 2>&1 && fail "the holding tag was left behind"
bash rollback.sh previous >/dev/null 2>&1
expect_running v10 "rollback to an image that was named only latest"

echo "release and rollback scripts: all checks passed"
