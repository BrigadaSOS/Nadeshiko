#!/usr/bin/env bash
set -euo pipefail

# Export the live Grafana dashboards into this repo so they are reviewable and
# restorable. Read-only: it never writes to Grafana.
#
# Usage:
#   GRAFANA_TOKEN=glsa_... infra/monitoring/scripts/export-grafana-dashboards.sh
#
# The token needs only Viewer rights (`dashboards:read`). Create it under
# Administration -> Service accounts. Do not commit it.
#
# Re-running overwrites the exported files, so a diff after an export is a real
# change someone made in the UI. That is the point: this repo is the record, and
# drift should show up in `jj diff`, not be discovered when the host dies.

GRAFANA_URL="${GRAFANA_URL:-http://monitoring:3000}"
: "${GRAFANA_TOKEN:?GRAFANA_TOKEN is required (Grafana service account token with dashboards:read)}"

script_dir="$(cd "$(dirname "$0")" && pwd)"
out_dir="${script_dir}/../grafana/dashboards"
mkdir -p "$out_dir"

api() {
  curl --fail --silent --show-error --max-time 30 \
    -H "Authorization: Bearer ${GRAFANA_TOKEN}" \
    "${GRAFANA_URL}$1"
}

echo "→ Listing dashboards on ${GRAFANA_URL}"
listing=$(api "/api/search?type=dash-db&limit=500")

uids=$(python3 -c '
import json, sys
for d in json.load(sys.stdin):
    print(d["uid"])
' <<<"$listing")

if [ -z "$uids" ]; then
  echo "No dashboards found." >&2
  exit 1
fi

count=0
while IFS= read -r uid; do
  [ -n "$uid" ] || continue
  raw=$(api "/api/dashboards/uid/${uid}")

  # Strip the fields that change on every save without the dashboard changing:
  # the numeric id and version are instance-local, and `folderId` does not
  # survive a re-import onto a rebuilt Grafana anyway. Keeping them would make
  # every export a diff.
  python3 -c '
import json, sys, pathlib
out_dir = pathlib.Path(sys.argv[1])
payload = json.load(sys.stdin)
dash = payload["dashboard"]
meta = payload.get("meta", {})
for key in ("id", "version"):
    dash.pop(key, None)
slug = dash.get("uid") or meta.get("slug") or "dashboard"
target = out_dir / (slug + ".json")
target.write_text(json.dumps({
    "folder": meta.get("folderTitle", "General"),
    "dashboard": dash,
}, indent=2, ensure_ascii=False, sort_keys=True) + "\n")
print("  %s  (%s)" % (target.name, dash.get("title", "?")))
' "$out_dir" <<<"$raw"
  count=$((count + 1))
done <<<"$uids"

echo
echo "Exported ${count} dashboard(s) to ${out_dir}"
