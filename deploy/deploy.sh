#!/usr/bin/env bash
# Ship the committed code to the server and restart. Run from the repo root: deploy/deploy.sh
# Needs DEPLOY_HOST (default root@193.181.221.210) and DEPLOY_KEY (default .data/goodbuild-deploy).
set -euo pipefail
HOST="${DEPLOY_HOST:-root@193.181.221.210}"
KEY="${DEPLOY_KEY:-.data/goodbuild-deploy}"
SSH=(ssh -i "$KEY" -o IdentitiesOnly=yes -o UserKnownHostsFile=.data/known_hosts)

git diff --quiet HEAD || { echo "Commit your changes first: this deploys HEAD."; exit 1; }
git archive --format=tar HEAD | "${SSH[@]}" "$HOST" 'mkdir -p /opt/goodbuild && find /opt/goodbuild -mindepth 1 -maxdepth 1 ! -name deploy -exec rm -rf {} + ; find /opt/goodbuild/deploy -mindepth 1 ! -name .env.production -delete 2>/dev/null; tar -xf - -C /opt/goodbuild'
"${SSH[@]}" "$HOST" 'cd /opt/goodbuild/deploy && docker compose --env-file .env.production up -d --build --remove-orphans && docker compose --env-file .env.production ps --format "{{.Name}} {{.Status}}"'
