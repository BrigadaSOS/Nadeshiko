# Monitoring

Alert rules and dashboards for Nadeshiko, kept in the repo so they are
reviewable and survive the monitoring host.

```
infra/monitoring/
  vmalert/rules/       alert rules, loaded by vmalert
  scripts/             the host-side publisher and the dashboard exporter
  grafana/dashboards/  exported dashboards (populated by the exporter)
```

## What already exists

The monitoring stack runs on its own Tailscale host, `monitoring`, separate from
the `nadeshiko` deploy host:

| Component | Address | State |
| --- | --- | --- |
| VictoriaMetrics | `monitoring:8428` | v1.139.0, receiving OTLP |
| VictoriaLogs | `monitoring:9428` | running; **no Nadeshiko streams** |
| Grafana | `monitoring:3000` | v11.6.0 |
| Alertmanager | `monitoring:9093` | v0.27.0, single `discord` receiver |
| vmalert | — | **not deployed** |

Alertmanager's route sends everything to a Discord webhook, grouped by
`alertname` + `host_name`, `group_wait: 30s`, `repeat_interval: 4h`. So the
delivery path is already built and tested. What is missing is anything that
produces alerts: at the time these files were written Alertmanager had zero
alerts and VictoriaMetrics had zero rule groups.

That gap is not theoretical. Production backend telemetry stopped on
2026-07-24 and was still absent twelve days later, and nothing said so.

## What Nadeshiko actually reports

Worth knowing before writing a rule, because it is less than you would assume:

- **Span metrics only.** `traces_span_metrics_calls_milliseconds_total` and
  `traces_span_metrics_duration_milliseconds_bucket`, derived by the collector's
  spanmetrics connector from application traces. Labels include `service_name`,
  `span_name`, `span_kind`, `status_code`, `deployment_environment`.
- **Nothing else.** The `nadeshiko` host runs no node_exporter, no cAdvisor, and
  no Elasticsearch or Postgres exporter. The `node_*` and `container_*` series
  in this VictoriaMetrics belong to an unrelated host and must not be used in a
  Nadeshiko rule — they will look healthy forever.
- **No logs.** VictoriaLogs has no Nadeshiko streams, so log-based alerting is
  not available.

`vmalert/rules/nadeshiko-services.yml` uses only what exists today.
`vmalert/rules/nadeshiko-host.yml` depends on `scripts/publish-host-metrics.sh`
below, and stays inert (and says so, via `NadeshikoHostMetricsMissing`) until
that is installed.

## Provisioning

### 1. Host metrics publisher — on the `nadeshiko` host

Publishes Elasticsearch health, Postgres backup freshness and container restart
counts, which no exporter covers. It reads them from the containers that are
already running and pushes to VictoriaMetrics over Tailscale.

```bash
scp infra/monitoring/scripts/publish-host-metrics.sh nadeshiko:/tmp/
ssh nadeshiko 'sudo install -m 0755 /tmp/publish-host-metrics.sh /usr/local/bin/ && rm /tmp/publish-host-metrics.sh'

# Verify by hand before scheduling it — it prints warnings for anything it
# cannot read, and exits non-zero only if the push itself fails.
ssh nadeshiko 'sudo /usr/local/bin/publish-host-metrics.sh'

ssh nadeshiko 'sudo crontab -e'
# */5 * * * * /usr/local/bin/publish-host-metrics.sh >> /var/log/nadeshiko-host-metrics.log 2>&1
```

It needs `docker` access (hence `sudo`, or a user in the `docker` group) and
must reach `monitoring:8428`. Confirm it landed:

```bash
curl -s 'http://monitoring:8428/api/v1/query?query=nadeshiko_elasticsearch_up'
```

### 2. vmalert — on the `monitoring` host

Copy the rules next to the rest of the monitoring stack and run vmalert against
the existing VictoriaMetrics and Alertmanager. Adjust the container names to
whatever the compose network calls them:

```yaml
# add to the monitoring host's compose file
vmalert:
  image: victoriametrics/vmalert:v1.139.0   # match VictoriaMetrics
  restart: unless-stopped
  volumes:
    - ./nadeshiko-rules:/etc/vmalert/rules:ro
  command:
    - -rule=/etc/vmalert/rules/*.yml
    - -datasource.url=http://victoriametrics:8428
    - -notifier.url=http://alertmanager:9093
    # Alert state is recorded back as `ALERTS`/`ALERTS_FOR_STATE` so a vmalert
    # restart does not reset every `for:` timer.
    - -remoteWrite.url=http://victoriametrics:8428
    - -remoteRead.url=http://victoriametrics:8428
    - -evaluationInterval=1m
    - -external.url=http://monitoring:3000
```

Then sync the rules on every change:

```bash
rsync -av --delete infra/monitoring/vmalert/rules/ monitoring:/opt/monitoring/nadeshiko-rules/
ssh monitoring 'docker kill --signal=SIGHUP vmalert'   # vmalert reloads rules on SIGHUP
```

Check what it loaded — including which groups match no series:

```bash
curl -s 'http://monitoring:8428/api/v1/rules' | python3 -m json.tool
```

Pointing `-datasource.url` at VictoriaMetrics rather than Prometheus is what
lets the rules use MetricsQL. They currently stick to PromQL-compatible
constructs, so they would also evaluate against Prometheus.

### 3. Dashboards

Export the live dashboards into the repo:

```bash
GRAFANA_TOKEN=glsa_... infra/monitoring/scripts/export-grafana-dashboards.sh
```

The token needs a Grafana service account with `dashboards:read`
(Administration → Service accounts). **The token currently configured for the
Grafana MCP server is rejected with 401**, so it has to be regenerated before
this works — that is also why `grafana/dashboards/` is still empty.

Re-import an exported dashboard onto a rebuilt Grafana with the JSON under the
`dashboard` key, and the `folder` key tells you where it belongs:

```bash
python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(json.dumps({"dashboard": d["dashboard"], "overwrite": True}))' \
  grafana/dashboards/<uid>.json |
  curl -s -X POST -H "Authorization: Bearer $GRAFANA_TOKEN" \
    -H 'Content-Type: application/json' --data-binary @- \
    http://monitoring:3000/api/dashboards/db
```

## Editing rules

Validate before syncing. There is no vmalert binary locally, so use the image:

```bash
docker run --rm -v "$PWD/infra/monitoring/vmalert/rules:/rules:ro" \
  victoriametrics/vmalert:v1.139.0 -rule=/rules/*.yml -dryRun
```

`-dryRun` parses and validates the rule files, then exits — it never contacts a
datasource or a notifier.

Two conventions the existing rules follow:

- **Alert on absence explicitly.** When a service stops reporting, its series
  leaves the lookbehind window and a bare `rate(...) == 0` returns nothing,
  resolving the alert exactly when it should fire. Use `or vector(0)` (with an
  unaggregated `sum()`, so the label sets match) or `absent()`.
- **Put a volume floor on ratios.** A 100% error rate over three requests is
  noise, and noise is how alerting gets muted.
