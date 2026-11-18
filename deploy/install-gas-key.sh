#!/usr/bin/env bash
# Puts the gas wallet key where the gas grant reads it (D41, D124): /opt/goodbuild-secrets/gas_wallet_key (outside /opt/goodbuild,
# which deploy.sh wipes on every release), owned by the
# web container's user (uid 1000) and readable only by it. Run ON THE SERVER, in /opt/goodbuild/deploy, by the owner.
#
#   ./install-gas-key.sh            # dry run: says what it would do, prints the gas wallet ADDRESS only
#   ./install-gas-key.sh --write    # writes the file, then restart web: docker compose up -d web
#
# The key comes from GAS_WALLET_PRIVATE_KEY in .env.production. The key itself is never printed.
# After this works, remove GAS_WALLET_PRIVATE_KEY from .env.production so web and worker stop getting it as an
# environment variable (launch-credits.sh is the only script that reads it there, and credits are deployed).
set -euo pipefail
cd "$(dirname "$0")"
ENV_FILE=.env.production
KEY=$(grep -E '^GAS_WALLET_PRIVATE_KEY=' "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d '"'"'"' \r')
[[ "$KEY" =~ ^0x[0-9a-fA-F]{64}$ ]] || { echo "GAS_WALLET_PRIVATE_KEY in $ENV_FILE is missing or not a 0x key." >&2; exit 1; }
# The key goes in on stdin, not the command line, so it never shows in the process list.
ADDR=$(printf '%s' "$KEY" | docker run -i --rm goodbuild:latest node -e 'let k="";process.stdin.on("data",d=>k+=d).on("end",()=>console.log(require("viem/accounts").privateKeyToAccount(k.trim()).address))')
echo "Gas wallet: $ADDR (should be 0x26b0c612e2073c368557929861d1eb665c5924cb)"
if [ "${1:-}" != "--write" ]; then
  echo "Dry run. Run with --write to create /opt/goodbuild-secrets/gas_wallet_key."
  exit 0
fi
umask 077
DIR=/opt/goodbuild-secrets
mkdir -p "$DIR"
printf '%s\n' "$KEY" > "$DIR/gas_wallet_key"
chown 1000:1000 "$DIR" "$DIR/gas_wallet_key"
chmod 0500 "$DIR"
chmod 0400 "$DIR/gas_wallet_key"
echo "Written. Now: docker compose up -d web"
