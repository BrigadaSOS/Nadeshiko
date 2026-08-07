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
| VictoriaLogs | `monitoring:9428` | v1.43.1, Nadeshiko streams in **tenant `1:0`** |
| Grafana | `monitoring:3000` | v11.6.0 |
| Alertmanager | `monitoring:9093` | v0.27.0, single `discord` receiver |
| vmalert | — | deployed, but loading an **empty rule set** |

**Nadeshiko is a tenant, not a separate stack.** The backends are shared with
lostcoords and live in `lostcoords-infra/machines/monitoring/victoria/`. The
central gateway (`lc-otelcol`) stamps a `team` resource attribute and routes on
it: metrics stay single-tenant in storage and are isolated by the `team=nadeshiko`
label enforced on reads by vmauth, while logs and traces are routed to
**AccountID 1** (lostcoords is 0). This matters the first time you go looking:
query VictoriaLogs without the tenant header and Nadeshiko appears to have no
logs at all, which is exactly the wrong conclusion.

Alertmanager's route sends everything to a Discord webhook, grouped by
`alertname` + `host_name`, `group_wait: 30s`, `repeat_interval: 4h`. So the
delivery path is already built and tested. What is still missing is anything that
produces alerts. vmalert *is* running, but it evaluates nothing **by choice**:
on 2026-06-29 all five rule groups were moved to
`brigadasos-infra/machines/monitoring/victoria/config/vmalert-rules/disabled/`
and replaced with `noop.yml` (`groups: []`). Re-enabling is a matter of moving
them back — but read them first: they were written against the metrics that
existed then, and the set has changed substantially (see below), so
`elasticsearch-alerts.yml` and `container-alerts.yml` in particular are worth
re-checking against what actually reports today.

The two rule files in *this* directory are a separate, older lineage and were
never wired into that path at all. Pick one home for rules before adding more.

That gap is not theoretical. Production backend telemetry stopped on
2026-07-24 and was still absent twelve days later, and nothing said so.

## What Nadeshiko actually reports

Worth knowing before writing a rule. This section used to say "span metrics only,
nothing else, no logs" — that was true when it was written and is now wrong in
almost every particular. The `nadeshiko` host runs an Alloy edge collector
(`brigadasos-infra/machines/nadeshiko/alloy/`) which is where all of this comes
from.

- **Application metrics**, pushed over OTLP by the backend and the Nuxt server:
  `http_server_request_duration_seconds`, `http_server_active_requests`,
  `db_client_operation_duration_seconds`, `db_client_connection_*`,
  `db_elasticsearch_operation_duration_seconds`, `pgboss_queue_size`,
  `nodejs_eventloop_*`, `v8js_memory_*`, `app_exception_total`.

  `app_exception_total` is the one to reach for on errors: it carries
  `error_type`, `error_group`, `error_fingerprint`, `http_route` and an
  `error_severity` of `4xx` or `5xx`. **4xx dominates and is not a bug signal** —
  it is mostly `AUTH_CREDENTIALS_REQUIRED`, `NOT_FOUND` and
  `RATE_LIMIT_EXCEEDED`, which the error handler counts deliberately without
  logging. Alert on `error_severity="5xx"`, which also has a matching
  error-level log line; 4xx has none by design.
- **Span metrics**, `traces_span_metrics_calls_milliseconds_total` and
  `traces_span_metrics_duration_milliseconds_bucket`, derived centrally by the
  gateway's spanmetrics connector. Labels include `service_name`, `span_name`,
  `span_kind`, `status_code`, `deployment_environment`.
- **Host metrics** — `node_*` from `prometheus.exporter.unix`, tagged
  `host_name="nadeshiko"`. **Always filter on that label**: this VictoriaMetrics
  also holds inari's, hokora's and qtower's, and an unfiltered `node_*` rule will
  cheerfully evaluate against someone else's box.

  `host_name="nadeshiko"` now covers application metrics too, but only since
  2026-08-07. The OTel SDKs resolve `host.name` with `os.hostname()`, which in a
  container is the container ID, so app metrics used to arrive as
  `host_name="nadeshiko-963b823bba6a"` — a fresh value per Kamal deploy, twelve
  of them accumulated, and not one matching the host. The edge collector now
  overwrites it. **Series predating the fix keep their old label until retention
  expires**, so a query spanning that boundary will show a gap on
  `host_name="nadeshiko"` that is an artefact, not an outage.
- **Container metrics** — `container_memory_working_set_bytes`,
  `container_spec_memory_limit_bytes`, `container_cpu_usage_seconds_total` from
  cAdvisor, tagged `host_name="nadeshiko"` and keyed on `container_name`. This is
  what catches a container approaching its own cgroup cap; `node_memory_*` cannot,
  because a container killed against its own limit dies while the host still has
  gigabytes free.
- **PostgreSQL** — `pg_up`, `pg_stat_database_*`, `service_name="integrations/postgres"`.
- **Elasticsearch** — `elasticsearch_*`. **Currently absent**: the exporter dials
  a published port that was pinned to the host's old tailnet address. Fixed in
  `backend/config/deploy.prod.yml`, but it needs an accessory reboot to take.
- **Logs** — every container plus journald, in VictoriaLogs **tenant `1:0`**,
  one stream per service (`service.name` × `host.name` × `deployment.environment`).
  Lines are parsed at the edge, so `http.status_code`, `http.path`, `http.route`,
  `responseTime`, `trace_id` and `span_id` are queryable fields, not text.

Two paths are deliberately dropped at the edge and will never appear: kamal-proxy's
`/collect` (the Faro ingest route logging its own beacons) and `/up` (Kamal's
readiness probe). Do not write a rule that counts either.

## Telling bots from readers

Every request both services handle is labelled `traffic` — `reader`, `bot` or
`monitor` — from its User-Agent, by `backend/lib/traffic.ts` and its mirror
`frontend/shared/utils/traffic.ts`. Nothing is blocked; the crawlers are welcome
and the AI crawlers especially are most of the growth. The label exists because
a blended number cannot answer the two questions that matter when something
looks wrong:

- **Is the site slow, or is a crawler enumerating it?** p95 over reader traffic
  and p95 over crawl traffic are different metrics, and mixing them means a
  quiet crawl of `/search` reads as a latency regression.
- **Is this error burst reaching people?** A 500 that only ever fires on a URL
  shape no human links to, hit only by GPTBot, is not the same morning as the
  same burst hitting readers.

Monitors are split out from readers for the same reason shirabe splits them: our
own probes arrive on a fixed cadence, forever, against the same few paths, so
counting them as people makes "reader latency" partly a measurement of our own
uptime checks.

Where the label lands:

| Signal | Field / attribute | Notes |
| --- | --- | --- |
| `http_server_requests_total` | `traffic`, `http_request_method`, `http_status_class` | New. Bot share is this divided by itself over `traffic`. |
| `http_server_bot_requests_total` | `bot_family` | New. ~40 families; the *only* place the crawler's name is a metric label. |
| `http_server_active_requests` | `traffic`, `bot_family` | In-flight load, split by who is causing it. |
| `app_exception_total` | `traffic`, `bot_family` | Both services. This is the one that answers "who is seeing the errors". |
| Traces | `traffic`, `bot.family` span attributes | On the server span, so a slow trace names its crawler. |
| Logs | `traffic`, `bot.family` fields | Every access log line and every error line, both services. |

The crawler's *name* is deliberately kept off the request and error metrics and
put on a counter of its own: ~40 families crossed with method and status would be
thousands of series to answer a question that needs neither dimension. In logs,
breadth is free, so `bot.family` rides along on every line.

Some queries to start from:

```promql
# Bot share of frontend requests, right now
sum(rate(http_server_requests_total{service_name="nadeshiko-frontend-prod", traffic="bot"}[5m]))
  / sum(rate(http_server_requests_total{service_name="nadeshiko-frontend-prod"}[5m]))

# Which crawlers, ranked
topk(10, sum by (bot_family) (rate(http_server_bot_requests_total[1h])))

# Errors readers actually saw (the number that should page you)
sum(rate(app_exception_total{traffic="reader"}[5m]))
```

```logsql
# tenant 1:0. Crawl traffic on the expensive surface
service.name:"nadeshiko-frontend-prod-web-prod" AND traffic:"bot" AND http.path:"/search"
  | stats by (bot.family) count() as reqs

# 5xx, split by who hit it
service.name:"nadeshiko-backend-prod-web-prod" AND http.status_code:>=500
  | stats by (traffic, http.route) count() as errors
```

**Baseline, measured 2026-08-07** over 24h of kamal-proxy logs, before any of
this shipped: 27.7k origin requests, of which ~32 (0.1%) came from a
self-declared robot and 492 (1.8%) from our own probes. The crawlers seen were
`ChatGPT-User`, `GenomeCrawlerd` and `FlowIQLabsBot` — all three classified
correctly by the lists above. Do not read that 0.1% as "AI crawlers are not
interested": Cloudflare fronts the origin, so a crawl that hits cached HTML
never reaches kamal-proxy at all. These labels measure what *arrives*, which is
the number that explains origin latency and origin errors. The full crawl volume
is a Cloudflare-side question and this change does not answer it.

One caveat worth knowing before trusting a backend number: a crawler's page view
reaches the backend as an SSR call over the internal network, which carries the
service API key rather than the crawler's User-Agent. The frontend therefore
propagates its own verdict in `x-nadeshiko-traffic` / `x-nadeshiko-bot-family`,
and the backend believes those headers only from callers that prove they are us
(internal-proxy secret or a SERVICE key — `backend/lib/internalProxy.ts`).
Anything else is classified from the User-Agent it presented. If that
propagation ever breaks, the symptom is backend traffic looking almost entirely
`reader` while the frontend says otherwise — compare the two services' bot share
before believing either.

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
