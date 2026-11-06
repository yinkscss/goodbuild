#!/usr/bin/env bash
# Runs on the server, called by deploy.sh: release.sh <tag>. Builds the image, keeps the old one for
# rollback.sh, runs migrations and restarts. See "Rollback" in docs/DEPLOY.md.
set -euo pipefail
cd "$(dirname "$0")"

TAG="${1:?usage: release.sh <tag>}"
IMAGE="${GOODBUILD_IMAGE:-goodbuild}"
KEEP=5
COMPOSE=(docker compose --env-file .env.production)

old=$(docker image inspect --format '{{.Id}}' "$IMAGE:latest" 2>/dev/null || true)
"${COMPOSE[@]}" build
new=$(docker image inspect --format '{{.Id}}' "$IMAGE:latest")

# Tag before starting anything, so a failed migration or start can still be rolled back. A failed
# build stopped above, and a rebuild of the same code changes nothing, so "previous" stays correct.
if [ -n "$old" ] && [ "$old" != "$new" ]; then
  docker tag "$old" "$IMAGE:previous"
fi
docker tag "$new" "$IMAGE:$TAG"

"${COMPOSE[@]}" up -d --remove-orphans
"${COMPOSE[@]}" ps --format "{{.Name}} {{.Status}}"

# Newest first. This only removes the tag, and an image also tagged latest or previous stays.
docker images "$IMAGE" --format '{{.Tag}}' | { grep '^sha-' || true; } | tail -n +"$((KEEP + 1))" | while read -r stale; do
  docker image rm "$IMAGE:$stale" >/dev/null || echo "Couldn't remove $IMAGE:$stale" >&2
done
