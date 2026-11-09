#!/usr/bin/env bash
# Runs the live mainnet credits test from YOUR Mac over ssh (D56). Nothing here is run by Claude: you run it.
# The gas wallet's key and the quote-signing key never leave the server (they are read from .env.production inside a container).
# The throwaway wallet's key is sent over ssh on stdin into a 600 file that is deleted when the run ends. It never touches your shell history.
#
#   SSH_KEY=/path/to/goodbuild-deploy ./scripts/run-live-credits-test.sh dry       # quote the swap, nothing is sent
#   SSH_KEY=... ./scripts/run-live-credits-test.sh fund                            # SENDS: gas wallet swaps 5 CELO to G$ for wallet 1, plus 0.05 CELO fees
#   SSH_KEY=... ./scripts/run-live-credits-test.sh buy-dry                         # simulate the $0.25 purchase against mainnet, nothing is sent
#   SSH_KEY=... ./scripts/run-live-credits-test.sh buy                             # SENDS: wallet 1 pays G$ and receives 0.25 credits
#
# Run `dry`, then `fund`, then `buy-dry`, and send the output of buy-dry back before running `buy`.
# Options (env): HOST (default root@193.181.221.210), KNOWN_HOSTS (default .data/known_hosts next to SSH_KEY), WALLETS (default
# .data/throwaway-credits-wallets.json), WALLET_INDEX (default 0 = credits-test-1), CELO_AMOUNT (default 5), USD (default 0.25).
set -euo pipefail

MODE="${1:-}"
case "$MODE" in dry | fund | buy-dry | buy) ;; *) echo "Usage: $0 dry|fund|buy-dry|buy" >&2; exit 2 ;; esac

HOST="${HOST:-root@193.181.221.210}"
SSH_KEY="${SSH_KEY:?Set SSH_KEY to the server deploy key path (the one DEPLOY.md calls goodbuild-deploy)}"
KNOWN_HOSTS="${KNOWN_HOSTS:-$(dirname "$SSH_KEY")/known_hosts}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WALLETS="${WALLETS:-$ROOT/.data/throwaway-credits-wallets.json}"
WALLET_INDEX="${WALLET_INDEX:-0}"
CELO_AMOUNT="${CELO_AMOUNT:-5}"
USD="${USD:-0.25}"
SSH_OPTS=(-i "$SSH_KEY" -o IdentitiesOnly=yes -o UserKnownHostsFile="$KNOWN_HOSTS")
REMOTE_DIR=/tmp/gbc-live

[ -f "$WALLETS" ] || { echo "No wallet file at $WALLETS" >&2; exit 1; }
ADDRESS="$(node -e 'const w=require(process.argv[1])[Number(process.argv[2])];if(!w)process.exit(1);process.stdout.write(w.address)' "$WALLETS" "$WALLET_INDEX")"
echo "Test wallet: $ADDRESS"

# 1. Copy the scripts (no secrets).
ssh "${SSH_OPTS[@]}" "$HOST" "mkdir -p $REMOTE_DIR/scripts && chmod 700 $REMOTE_DIR"
scp -q "${SSH_OPTS[@]}" "$ROOT/scripts/fund-test-wallet.mjs" "$ROOT/scripts/credits-live-purchase.mjs" "$HOST:$REMOTE_DIR/scripts/"

# 2. Run in a throwaway container from the live image (it has viem). The env file stays on the server.
cleanup() {
  ssh "${SSH_OPTS[@]}" "$HOST" "rm -f $REMOTE_DIR/wallet.env" >/dev/null 2>&1 || true
}
trap cleanup EXIT

case "$MODE" in
  dry)
    ssh "${SSH_OPTS[@]}" "$HOST" "cd /opt/goodbuild/deploy && docker run --rm --env-file .env.production -v $REMOTE_DIR:/app/gbc-live goodbuild:latest node /app/gbc-live/scripts/fund-test-wallet.mjs --to $ADDRESS --celo $CELO_AMOUNT"
    ;;
  fund)
    echo "This SENDS ${CELO_AMOUNT} CELO from the gas wallet into a swap for $ADDRESS. Type YES to continue:"
    read -r ok; [ "$ok" = "YES" ] || { echo "Cancelled."; exit 1; }
    ssh "${SSH_OPTS[@]}" "$HOST" "cd /opt/goodbuild/deploy && docker run --rm --env-file .env.production -e CONFIRM_MAINNET=yes -v $REMOTE_DIR:/app/gbc-live goodbuild:latest node /app/gbc-live/scripts/fund-test-wallet.mjs --to $ADDRESS --celo $CELO_AMOUNT --send"
    ;;
  buy-dry | buy)
    # Send the wallet key on stdin into a 600 file; it is removed by the trap when this script ends.
    node -e 'const w=require(process.argv[1])[Number(process.argv[2])];process.stdout.write("TEST_WALLET_KEY="+w.key+"\n")' "$WALLETS" "$WALLET_INDEX" \
      | ssh "${SSH_OPTS[@]}" "$HOST" "umask 077 && cat > $REMOTE_DIR/wallet.env"
    if [ "$MODE" = "buy" ]; then
      echo "This SENDS a G\$ payment of about \$$USD from $ADDRESS to the credits contract. Type YES to continue:"
      read -r ok; [ "$ok" = "YES" ] || { echo "Cancelled."; exit 1; }
      ssh "${SSH_OPTS[@]}" "$HOST" "cd /opt/goodbuild/deploy && docker run --rm --env-file .env.production --env-file $REMOTE_DIR/wallet.env -e CONFIRM_MAINNET=yes -v $REMOTE_DIR:/app/gbc-live goodbuild:latest node /app/gbc-live/scripts/credits-live-purchase.mjs --usd $USD --send"
    else
      ssh "${SSH_OPTS[@]}" "$HOST" "cd /opt/goodbuild/deploy && docker run --rm --env-file .env.production --env-file $REMOTE_DIR/wallet.env -v $REMOTE_DIR:/app/gbc-live goodbuild:latest node /app/gbc-live/scripts/credits-live-purchase.mjs --usd $USD"
    fi
    ;;
esac
