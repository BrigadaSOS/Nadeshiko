#!/usr/bin/env bash
# =============================================================================
# Elasticsearch User and Role Setup Script for Nadeshiko
# =============================================================================
#
# Creates an index-scoped user and role for the application to use.
# Run this in your environment context (local, dev, or prod).
#
# Usage:
#   1. Source your environment variables:
#      - Local: source .env
#      - Dev: source .kamal/secrets.dev
#      - Prod: source .kamal/secrets.prod
#
#   2. Start Elasticsearch (if not running):
#      docker compose up -d elasticsearch
#
#   3. Run this script:
#      ./scripts/setup-elasticsearch-users.sh
#
# Required environment variables:
#   ELASTICSEARCH_ADMIN_USER      - Admin username for setup (default: elastic)
#   ELASTICSEARCH_ADMIN_PASSWORD  - Admin password for setup (required)
#   ELASTICSEARCH_INDEX           - Index name to grant access to (required)
#   ELASTICSEARCH_PASSWORD        - Password for new app user (required)
#
# Optional:
#   ELASTICSEARCH_USER            - App username (defaults to <INDEX>_user)
#   ELASTICSEARCH_HOST            - Elasticsearch URL (default: http://localhost:9200)
#
# After running, your env will have app credentials that can only access ELASTICSEARCH_INDEX.
#
# =============================================================================

set -e

ELASTIC_HOST="${ELASTICSEARCH_HOST:-http://localhost:9200}"
ADMIN_USER="${ELASTICSEARCH_ADMIN_USER:-elastic}"
ADMIN_PASSWORD="${ELASTICSEARCH_ADMIN_PASSWORD}"
INDEX_NAME="${ELASTICSEARCH_INDEX}"
APP_USER="${ELASTICSEARCH_USER}"
APP_PASSWORD="${ELASTICSEARCH_PASSWORD}"

# Validate required variables
if [[ -z "$ADMIN_PASSWORD" ]]; then
    echo "Error: ELASTICSEARCH_ADMIN_PASSWORD is required"
    exit 1
fi

if [[ -z "$INDEX_NAME" ]]; then
    echo "Error: ELASTICSEARCH_INDEX is required"
    exit 1
fi

if [[ -z "$APP_PASSWORD" ]]; then
    echo "Error: ELASTICSEARCH_PASSWORD is required (for new user)"
    exit 1
fi

# Generate username from index if not provided
if [[ -z "$APP_USER" ]]; then
    # Convert index name to a valid username (replace hyphens with underscores, remove special chars)
    APP_USER="${INDEX_NAME//[^a-zA-Z0-9]/_}_user"
fi

ROLE_NAME="${APP_USER}_role"

# Wait for Elasticsearch to be ready
echo "Setting up Elasticsearch user for index: ${INDEX_NAME}"
echo "Waiting for Elasticsearch at ${ELASTIC_HOST}..."
until curl -s -u "${ADMIN_USER}:${ADMIN_PASSWORD}" "${ELASTIC_HOST}/_cluster/health" > /dev/null 2>&1; do
    echo "Elasticsearch is not ready yet. Retrying in 5 seconds..."
    sleep 5
done
echo "Elasticsearch is ready!"

# Create role
echo ""
echo "Creating role: ${ROLE_NAME} (access to ${INDEX_NAME})"
curl -s -X PUT "${ELASTIC_HOST}/_security/role/${ROLE_NAME}" \
    -u "${ADMIN_USER}:${ADMIN_PASSWORD}" \
    -H "Content-Type: application/json" \
    -d "{
        \"indices\": [
            {
                \"names\": [\"${INDEX_NAME}\"],
                \"privileges\": [\"all\"],
                \"allow_restricted_indices\": false
            }
        ]
    }"
echo ""

# Create user
echo "Creating user: ${APP_USER}"
curl -s -X PUT "${ELASTIC_HOST}/_security/user/${APP_USER}" \
    -u "${ADMIN_USER}:${ADMIN_PASSWORD}" \
    -H "Content-Type: application/json" \
    -d "{
        \"password\": \"${APP_PASSWORD}\",
        \"roles\": [\"${ROLE_NAME}\"],
        \"full_name\": \"Nadeshiko App User for ${INDEX_NAME}\"
    }"
echo ""

echo ""
echo "=========================================================================="
echo "Setup complete!"
echo "=========================================================================="
echo ""
echo "Created user '${APP_USER}' with role '${ROLE_NAME}'"
echo "This user can only access index: ${INDEX_NAME}"
echo ""
echo "Your app will use:"
echo "  ELASTICSEARCH_USER=${APP_USER}"
echo "  ELASTICSEARCH_PASSWORD=<already set in your env>"
echo "  ELASTICSEARCH_INDEX=${INDEX_NAME}"
echo ""
echo "Keep ELASTICSEARCH_ADMIN_* credentials separate - only for setup!"
echo ""
