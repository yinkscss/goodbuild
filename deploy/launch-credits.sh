#!/usr/bin/env bash
# One-shot launch of GoodBuild Credits v2 on Celo mainnet (D56). Run ON THE SERVER, in /opt/goodbuild/deploy, AFTER the
# image with this code has been built (deploy.sh / release.sh), so the container has scripts/ and contracts/.
#
#   ./launch-credits.sh            # dry run: shows the plan, sends nothing
#   ./launch-credits.sh --send     # deploys (needs GAS_WALLET_PRIVATE_KEY in .env.production and some CELO in it)
#
# What it does: (1) makes a quote-signing key if there is none and stores it in .env.production, (2) compiles and deploys
# GoodBuildCredits from the gas wallet, (3) writes CREDITS_CONTRACT_42220 and CREDITS_START_BLOCK_42220 to .env.production,
# (4) restarts web and worker. Keys never leave this server and are never printed. Admin: 0xf0449277E30CC9063147bfB9Ecdf036BF9d41531.
set -euo pipefail
cd "$(dirname "$0")"
ENV_FILE=.env.production
[ -f "$ENV_FILE" ] || { echo "No $ENV_FILE here. Run this in /opt/goodbuild/deploy." >&2; exit 1; }
SEND=""; [ "${1:-}" = "--send" ] && SEND="--send"
get() { grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- | sed -e 's/^["'"'"']//' -e 's/["'"'"']$//' || true; }
set_var() { grep -vE "^$1=" "$ENV_FILE" > "$ENV_FILE.tmp" || true; printf '%s=%s\n' "$1" "$2" >> "$ENV_FILE.tmp"; chmod 600 "$ENV_FILE.tmp"; mv "$ENV_FILE.tmp" "$ENV_FILE"; }

[ -n "$(get GAS_WALLET_PRIVATE_KEY)" ] || { echo "GAS_WALLET_PRIVATE_KEY is not set in $ENV_FILE." >&2; exit 1; }
if [ -n "$(get CREDITS_CONTRACT_42220)" ]; then echo "CREDITS_CONTRACT_42220 is already set to $(get CREDITS_CONTRACT_42220). Refusing to deploy a second one." >&2; exit 1; fi

RUN="docker compose run --rm --no-deps -T -e HOME=/tmp web"
if [ -z "$(get CREDITS_QUOTE_SIGNER_KEY)" ] && [ -n "$SEND" ]; then
  KEY=$($RUN node -e 'const{generatePrivateKey}=require("viem/accounts");process.stdout.write(generatePrivateKey())')
  set_var CREDITS_QUOTE_SIGNER_KEY "$KEY"
  echo "Made a quote-signing key and stored it in $ENV_FILE."
fi
SIGNER_KEY=$(get CREDITS_QUOTE_SIGNER_KEY)
if [ -z "$SIGNER_KEY" ]; then SIGNER_ADDR=0x0000000000000000000000000000000000000001; else
  SIGNER_ADDR=$(docker compose run --rm --no-deps -T web node -e 'const{privateKeyToAccount}=require("viem/accounts");process.stdout.write(privateKeyToAccount(process.env.CREDITS_QUOTE_SIGNER_KEY).address)')
fi
echo "Quote signer address: $SIGNER_ADDR"

OUT=$(docker compose run --rm --no-deps -T \
  -e CREDITS_NETWORK=celo -e CONFIRM_MAINNET=yes -e CREDITS_QUOTE_SIGNER="$SIGNER_ADDR" web \
  sh -c "DEPLOYER_PRIVATE_KEY=\$GAS_WALLET_PRIVATE_KEY node scripts/compile-credits.mjs && DEPLOYER_PRIVATE_KEY=\$GAS_WALLET_PRIVATE_KEY node scripts/deploy-credits.mjs $SEND" | tee /dev/stderr)

[ -n "$SEND" ] || exit 0
ADDR=$(printf '%s\n' "$OUT" | sed -n 's/^Set on the server: CREDITS_CONTRACT_42220=\(0x[0-9a-fA-F]\{40\}\) and CREDITS_START_BLOCK_42220=\([0-9]*\).*/\1/p')
BLOCK=$(printf '%s\n' "$OUT" | sed -n 's/^Set on the server: CREDITS_CONTRACT_42220=\(0x[0-9a-fA-F]\{40\}\) and CREDITS_START_BLOCK_42220=\([0-9]*\).*/\2/p')
[ -n "$ADDR" ] && [ -n "$BLOCK" ] || { echo "Could not read the deployed address from the output above. Set CREDITS_CONTRACT_42220 and CREDITS_START_BLOCK_42220 by hand." >&2; exit 1; }
set_var CREDITS_CONTRACT_42220 "$ADDR"
set_var CREDITS_START_BLOCK_42220 "$BLOCK"
docker compose up -d web worker
echo "Done. Credits live at $ADDR (block $BLOCK). Check https://goodbuildit.xyz/api/credits/onchain"
