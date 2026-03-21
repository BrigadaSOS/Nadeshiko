#!/usr/bin/env bash
set -euo pipefail

environment="${1:-}"
shift || true

case "$environment" in
  dev)
    base_url="https://dev.nadeshiko.co"
    parameter_name="/nadeshiko/dev/E2E_USER_PASSWORD"
    ;;
  prod)
    base_url="https://nadeshiko.co"
    parameter_name="/nadeshiko/prod/E2E_USER_PASSWORD"
    ;;
  *)
    echo "Usage: $0 <dev|prod> [playwright args...]" >&2
    exit 1
    ;;
esac

playwright_bin="./node_modules/.bin/playwright"

if [[ ! -x "$playwright_bin" ]]; then
  echo "Playwright binary not found at $playwright_bin" >&2
  exit 1
fi

if [[ -z "${CI:-}" && -z "${E2E_USER_PASSWORD:-}" ]]; then
  if ! command -v aws >/dev/null 2>&1; then
    echo "aws CLI is required to fetch E2E_USER_PASSWORD from SSM" >&2
    exit 1
  fi

  E2E_USER_PASSWORD="$(
    aws ssm get-parameter \
      --name "$parameter_name" \
      --with-decryption \
      --query 'Parameter.Value' \
      --output text
  )"
  export E2E_USER_PASSWORD
fi

exec env E2E_BASE_URL="$base_url" "$playwright_bin" test --config=e2e/playwright.config.ts "$@"
