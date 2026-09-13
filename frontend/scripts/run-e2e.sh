#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${script_dir}/.."

environment="${1:-local}"
shift || true

case "$environment" in
  local)
    base_url="${E2E_BASE_URL:-http://localhost:3000}"
    parameter_name=""
    bypass_parameter_name=""
    bypass_variable=""
    ;;
  staging|dev)
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
    export E2E_SMOKE=1
    ;;
  *)
    echo "Usage: $0 <local|staging|prod> [playwright args...]" >&2
    exit 1
    ;;
esac

if [[ "$environment" != local && -z "${E2E_EXPECTED_SHA:-}" ]]; then
  echo "E2E_EXPECTED_SHA is required for deployed-environment E2E" >&2
  exit 1
fi

if [[ -z "${CI:-}" && "$environment" != local ]]; then
  command -v aws >/dev/null 2>&1 || { echo 'aws CLI is required to fetch E2E credentials from SSM' >&2; exit 1; }
  if [[ -z "${E2E_USER_PASSWORD:-}" ]]; then
    E2E_USER_PASSWORD="$(aws ssm get-parameter --name "$parameter_name" --with-decryption --query Parameter.Value --output text)"
    export E2E_USER_PASSWORD
  fi
  if [[ -z "${!bypass_variable:-}" ]]; then
    bypass_secret="$(aws ssm get-parameter --name "$bypass_parameter_name" --with-decryption --query Parameter.Value --output text)"
    printf -v "$bypass_variable" '%s' "$bypass_secret"
    export "$bypass_variable"
  fi
fi

exec env E2E_BASE_URL="$base_url" npx playwright test --config=e2e/playwright.config.ts "$@" \
  </dev/null
