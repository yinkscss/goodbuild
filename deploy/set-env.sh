#!/usr/bin/env bash
# Set one value in the server's .env.production and restart web (worker too with --worker).
# The value is read from stdin, so it never appears in a command line, shell history or process list, and is never printed.
#   pbpaste | deploy/set-env.sh GOODCASH_PUBLISHABLE_KEY
#   deploy/set-env.sh GOODCASH_SECRET_KEY          (paste at the hidden prompt, then Enter)
# Needs DEPLOY_HOST (default root@193.181.221.210) and DEPLOY_KEY (default .data/goodbuild-deploy).
set -euo pipefail
NAME="${1:-}"; RESTART="web"; [ "${2:-}" = "--worker" ] && RESTART="web worker"
[[ "$NAME" =~ ^[A-Z][A-Z0-9_]*$ ]] || { echo "Usage: deploy/set-env.sh NAME [--worker]  (value on stdin)"; exit 1; }
if [ -t 0 ]; then read -r -s -p "Paste $NAME (hidden), then Enter: " VALUE; echo; else VALUE="$(cat)"; fi
VALUE="$(printf '%s' "$VALUE" | tr -d '\r\n')"
[[ "$VALUE" =~ ^[A-Za-z0-9_.:/+=@-]+$ ]] || { echo "That doesn't look like a plain key (empty, or it has spaces or quotes). Nothing was changed."; exit 1; }
HOST="${DEPLOY_HOST:-root@193.181.221.210}"
KEY="${DEPLOY_KEY:-.data/goodbuild-deploy}"
SSH=(ssh -i "$KEY" -o IdentitiesOnly=yes -o UserKnownHostsFile=.data/known_hosts)
# The name goes in the command; the value goes through stdin only.
printf '%s' "$VALUE" | "${SSH[@]}" "$HOST" "set -euo pipefail; cd /opt/goodbuild/deploy; V=\$(cat); cp -p .env.production .env.production.bak; grep -v '^$NAME=' .env.production > .env.production.new || true; printf '%s=%s\n' '$NAME' \"\$V\" >> .env.production.new; chmod 600 .env.production.new; mv .env.production.new .env.production; docker compose --env-file .env.production up -d $RESTART >/dev/null 2>&1; grep -c '^$NAME=' .env.production"
echo "Set $NAME on the server and restarted: $RESTART. A backup of the old file is .env.production.bak on the server."
