#!/usr/bin/env bash
# Nightly database backup, keeping 7 days. Installed in root's crontab (docs/DEPLOY.md).
# These stay on the same server, so copy one off before relying on it.
set -euo pipefail
DIR=/var/backups/goodbuild
mkdir -p "$DIR"
docker compose -f /opt/goodbuild/deploy/docker-compose.yml --env-file /opt/goodbuild/deploy/.env.production exec -T goodbuild-postgres \
  pg_dump -U goodbuild -d goodbuild --format=custom > "$DIR/goodbuild-$(date +%F).dump"
find "$DIR" -name 'goodbuild-*.dump' -mtime +7 -delete
