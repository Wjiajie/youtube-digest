#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
PROJECT_ROOT=$(cd -- "$SCRIPT_DIR/.." && pwd)
RUNTIME_ENV="$PROJECT_ROOT/.env.m1-runtime.local"

if [[ -f "$RUNTIME_ENV" ]]; then
  # This ignored file contains machine-local paths only, never credentials.
  set -a
  # shellcheck disable=SC1090
  source "$RUNTIME_ENV"
  set +a
fi

exec "$@"
