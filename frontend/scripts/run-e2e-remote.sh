#!/usr/bin/env bash
set -euo pipefail

environment="${1:-}"
shift || true

case "$environment" in
  dev)
    base_url="https://stg.nadeshiko.co"
    parameter_name="/nadeshiko/staging/E2E_USER_PASSWORD"
    bypass_parameter_name="/nadeshiko/staging/RATE_LIMIT_BYPASS_SECRET"
    bypass_variable="E2E_RATE_LIMIT_BYPASS_SECRET"
    ;;
  prod)
    base_url="https://nadeshiko.co"
    parameter_name="/nadeshiko/prod/E2E_USER_PASSWORD"
    bypass_parameter_name="/nadeshiko/prod/CI_BYPASS_SECRET"
    bypass_variable="E2E_CI_BYPASS_SECRET"
    ;;
  *)
    echo "Usage: $0 <dev|prod> [playwright args...]" >&2
    exit 1
    ;;
esac

playwright_bin="$(command -v playwright || true)"

if [[ -z "$playwright_bin" || ! -x "$playwright_bin" ]]; then
  echo "Playwright binary not found on PATH; run npm ci from the workspace root" >&2
  exit 1
fi

if [[ -z "${CI:-}" ]]; then
  if ! command -v aws >/dev/null 2>&1; then
    echo "aws CLI is required to fetch E2E credentials from SSM" >&2
    exit 1
  fi

  if [[ -z "${E2E_USER_PASSWORD:-}" ]]; then
    E2E_USER_PASSWORD="$(
      aws ssm get-parameter \
        --name "$parameter_name" \
        --with-decryption \
        --query 'Parameter.Value' \
        --output text
    )"
    export E2E_USER_PASSWORD
  fi

  if [[ -z "${!bypass_variable:-}" ]]; then
    bypass_secret="$(
      aws ssm get-parameter \
        --name "$bypass_parameter_name" \
        --with-decryption \
        --query 'Parameter.Value' \
        --output text 2>/dev/null || true
    )"
    if [[ -n "$bypass_secret" ]]; then
      printf -v "$bypass_variable" '%s' "$bypass_secret"
      export "$bypass_variable"
    fi
  fi
fi

exec env E2E_BASE_URL="$base_url" "$playwright_bin" test --config=e2e/playwright.config.ts "$@"
