#!/usr/bin/env bash
# Run the LiteLLM proxy locally with keys from .env.local.
# Needs Python 3.10+: pip install 'litellm[proxy]'
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -f .env.local ]; then set -a; . ./.env.local; set +a; fi
: "${ANTHROPIC_API_KEY:?Set ANTHROPIC_API_KEY in .env.local}"
: "${LITELLM_MASTER_KEY:?Set LITELLM_MASTER_KEY in .env.local (any long random string)}"
exec litellm --config litellm/config.yaml --port "${LITELLM_PORT:-4000}"
