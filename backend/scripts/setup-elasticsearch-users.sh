#!/usr/bin/env bash
# Source an environment file, start Elasticsearch, then run ./scripts/setup-elasticsearch-users.sh. Requires
# ELASTICSEARCH_ADMIN_PASSWORD, ELASTICSEARCH_INDEX, ELASTICSEARCH_PASSWORD; creates an index-scoped app user. Defaults:
# ELASTICSEARCH_ADMIN_USER=elastic, ELASTICSEARCH_HOST=http://localhost:9200, ELASTICSEARCH_USER=<sanitized-index>_user.

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

# Pass credentials through a curl config file descriptor and bodies through stdin: command-line arguments are
# readable by every user on the host through ps.
es_curl() {
    local creds="${ADMIN_USER}:${ADMIN_PASSWORD}"
    creds="${creds//\\/\\\\}"
    curl -s -K <(printf 'user = "%s"\n' "${creds//\"/\\\"}") "$@"
}

# Wait for Elasticsearch to be ready
echo "Setting up Elasticsearch user for index: ${INDEX_NAME}"
echo "Waiting for Elasticsearch at ${ELASTIC_HOST}..."
until es_curl "${ELASTIC_HOST}/_cluster/health" > /dev/null 2>&1; do
    echo "Elasticsearch is not ready yet. Retrying in 5 seconds..."
    sleep 5
done
echo "Elasticsearch is ready!"

# Create role
echo ""
echo "Creating role: ${ROLE_NAME} (access to ${INDEX_NAME})"
printf '%s' "{
        \"indices\": [
            {
                \"names\": [\"${INDEX_NAME}\", \"${INDEX_NAME}_v*\"],
                \"privileges\": [\"all\"],
                \"allow_restricted_indices\": false
            }
        ]
    }" | es_curl -X PUT "${ELASTIC_HOST}/_security/role/${ROLE_NAME}" -H "Content-Type: application/json" --data-binary @-
echo ""

# Create user
echo "Creating user: ${APP_USER}"
printf '%s' "{
        \"password\": \"${APP_PASSWORD}\",
        \"roles\": [\"${ROLE_NAME}\"],
        \"full_name\": \"Nadeshiko App User for ${INDEX_NAME}\"
    }" | es_curl -X PUT "${ELASTIC_HOST}/_security/user/${APP_USER}" -H "Content-Type: application/json" --data-binary @-
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
