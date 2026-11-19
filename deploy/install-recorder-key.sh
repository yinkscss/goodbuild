#!/usr/bin/env bash
# Puts the GoodBuild Registry recorder key where the worker reads it (D155): /opt/goodbuild-recorder/recorder_key, outside
# /opt/goodbuild (deploy.sh wipes that on every release) and in a different folder from the gas wallet's, so the worker
# never sees the gas key. Owned by uid 1000, readable only by it. Run ON THE SERVER, in /opt/goodbuild/deploy, by the owner.
#
#   ./install-recorder-key.sh            # dry run: says what it would do, prints the recorder ADDRESS only
#   ./install-recorder-key.sh --write    # writes the file, then restart the worker: docker compose up -d worker
#
# The key comes from RECORDER_PRIVATE_KEY in .env.production (a wallet made only for this, funded with a little CELO).
# Never printed. After it works, remove RECORDER_PRIVATE_KEY from .env.production.
set -euo pipefail
cd "$(dirname "$0")"
ENV_FILE=.env.production
KEY=$(grep -E '^RECORDER_PRIVATE_KEY=' "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d '"'"'"' \r')
[[ "$KEY" =~ ^0x[0-9a-fA-F]{64}$ ]] || { echo "RECORDER_PRIVATE_KEY in $ENV_FILE is missing or not a 0x key." >&2; exit 1; }
ADDR=$(printf '%s' "$KEY" | docker run -i --rm goodbuild:latest node -e 'let k="";process.stdin.on("data",d=>k+=d).on("end",()=>console.log(require("viem/accounts").privateKeyToAccount(k.trim()).address))')
echo "Recorder wallet: $ADDR (must equal the registry's recorder)"
if [ "${1:-}" != "--write" ]; then
  echo "Dry run. Run with --write to create /opt/goodbuild-recorder/recorder_key."
  exit 0
fi
umask 077
DIR=/opt/goodbuild-recorder
mkdir -p "$DIR"
printf '%s\n' "$KEY" > "$DIR/recorder_key"
chown 1000:1000 "$DIR" "$DIR/recorder_key"
chmod 0500 "$DIR"
chmod 0400 "$DIR/recorder_key"
echo "Written. Now: docker compose up -d worker"
