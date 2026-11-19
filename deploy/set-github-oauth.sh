#!/usr/bin/env bash
# Put the GitHub OAuth App's client ID and secret into the server's .env.production, then restart web and worker.
# Both are typed at hidden prompts, so they never appear in chat, shell history or a command line.
#   deploy/set-github-oauth.sh
set -euo pipefail
cd "$(dirname "$0")"
./set-env.sh GITHUB_CLIENT_ID
./set-env.sh GITHUB_CLIENT_SECRET --worker
