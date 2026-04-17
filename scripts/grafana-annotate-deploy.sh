#!/bin/bash

# Create a Grafana annotation marking a deployment.
# Called from each service's .kamal/hooks/post-deploy.
#
# Expects Kamal hook env vars:
#   KAMAL_SERVICE, KAMAL_VERSION, KAMAL_PERFORMER, KAMAL_RUNTIME
# Requires:
#   GRAFANA_ANNOTATION_TOKEN env var (fetched from AWS SSM in secrets files)
#   Grafana reachable at monitoring:3000 via Tailscale

set -uo pipefail

GRAFANA_URL="${GRAFANA_URL:-http://monitoring:3000}"

if [ -z "${GRAFANA_ANNOTATION_TOKEN:-}" ]; then
  echo "Warning: GRAFANA_ANNOTATION_TOKEN not set, skipping deploy annotation"
  exit 0
fi

SERVICE="${KAMAL_SERVICE:-unknown}"
VERSION="${KAMAL_VERSION:-unknown}"
PERFORMER="${KAMAL_PERFORMER:-unknown}"
RUNTIME="${KAMAL_RUNTIME:-}"

# Gather git info from the local repo (hooks run on the deployer machine)
GIT_SHA=$(git rev-parse --short HEAD 2>/dev/null || echo "$VERSION")
GIT_MESSAGE=$(git log -1 --pretty=%s 2>/dev/null || echo "")

ANNOTATION_TEXT="**${SERVICE}** deployed version \`${VERSION}\`"
[ -n "$GIT_MESSAGE" ] && ANNOTATION_TEXT="${ANNOTATION_TEXT}\n\n${GIT_MESSAGE}"
ANNOTATION_TEXT="${ANNOTATION_TEXT}\n\nBy: ${PERFORMER}"
[ -n "$RUNTIME" ] && ANNOTATION_TEXT="${ANNOTATION_TEXT} (${RUNTIME}s)"

# Make curl non-fatal - annotation is nice-to-have
curl -s -X POST "${GRAFANA_URL}/api/annotations" \
  -H "Authorization: Bearer ${GRAFANA_ANNOTATION_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"text\": \"${ANNOTATION_TEXT}\",
    \"tags\": [\"deploy\", \"${SERVICE}\"]
  }" || {
    echo "Warning: Failed to create Grafana deploy annotation (curl failed)"
    exit 0
  }

echo "Deploy annotation created for ${SERVICE} (${VERSION})"
