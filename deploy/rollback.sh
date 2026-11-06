#!/usr/bin/env bash
# Runs on the server. Restarts web and worker from an image already there, with no rebuild.
#   rollback.sh             list the images, changing nothing
#   rollback.sh previous    the image that ran before the last deploy
#   rollback.sh sha-<hash>  the image built from that commit
# It can't undo a migration. Read "Rollback" in docs/DEPLOY.md first.
set -euo pipefail
cd "$(dirname "$0")"

IMAGE="${GOODBUILD_IMAGE:-goodbuild}"
TARGET="${1:-}"

if [ -z "$TARGET" ]; then
  docker images "$IMAGE" --format 'table {{.Tag}}\t{{.ID}}\t{{.CreatedAt}}'
  echo
  echo "latest is what's running. To go back: rollback.sh previous, or rollback.sh sha-<hash>"
  exit 0
fi

docker image inspect "$IMAGE:$TARGET" >/dev/null 2>&1 || { echo "No image $IMAGE:$TARGET. Run rollback.sh with no argument to list them." >&2; exit 1; }

# Compose runs whatever latest points at, so a later "up -d" stays on this image too.
docker tag "$IMAGE:$TARGET" "$IMAGE:latest"
# --no-deps: leave the database and the migrate service alone.
docker compose --env-file .env.production up -d --no-build --no-deps --force-recreate web worker
docker compose --env-file .env.production ps --format "{{.Name}} {{.Status}}"
echo "Now on $IMAGE:$TARGET. The next deploy replaces it, so revert the bad commit on main."
