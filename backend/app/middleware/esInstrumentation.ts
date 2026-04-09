import type { Client } from '@elastic/elasticsearch';
import { trace } from '@opentelemetry/api';
import { getMeter } from '@config/telemetry';
import { config } from '@config/config';
import { INDEX_NAME } from '@config/elasticsearch';

const ES_DURATION_BUCKETS = [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5, 10];

const meter = getMeter();

const operationDuration = meter.createHistogram('db.client.operation.duration', {
  description: 'Duration of database client operations',
  unit: 's',
  advice: { explicitBucketBoundaries: ES_DURATION_BUCKETS },
});

function extractOperation(method: string, path: string): string {
  const cleanPath = path.split('?')[0];

  if (cleanPath.endsWith('/_search')) return 'search';
  if (cleanPath.endsWith('/_msearch')) return 'msearch';
  if (cleanPath.endsWith('/_bulk')) return 'bulk';
  if (cleanPath.endsWith('/_count')) return 'count';
  if (method === 'POST' && cleanPath.match(/\/_doc\/?$/)) return 'index';
  if (method === 'PUT' && cleanPath.match(/\/_doc\//)) return 'index';
  if (method === 'DELETE' && cleanPath.match(/\/_doc\//)) return 'delete';
  if (method === 'GET' && cleanPath.match(/\/_doc\//)) return 'get';

  return `${method.toLowerCase()} ${cleanPath}`.slice(0, 50);
}

const esHost = new URL(config.ELASTICSEARCH_HOST);
const esServerAddress = esHost.hostname;
const esServerPort = Number(esHost.port) || 9200;

const requestStartTimes = new Map<any, number>();

function suppressInternalHttpSpans(esClient: Client): void {
  const transport = esClient.transport as any;
  const otelSym = Object.getOwnPropertySymbols(transport).find((s) => s.toString() === 'Symbol(opentelemetry options)');
  if (otelSym) {
    transport[otelSym] = { enabled: true, suppressInternalInstrumentation: true };
  }
}

export function instrumentElasticsearchClient(esClient: Client): void {
  suppressInternalHttpSpans(esClient);

  const diag = esClient.diagnostic;

  diag.on('request', (_err, result) => {
    if (result?.meta?.request?.id != null) {
      requestStartTimes.set(result.meta.request.id, performance.now());
    }

    const span = trace.getActiveSpan();
    if (!span) return;
    const params = result?.meta?.request?.params;
    if (!params?.path) return;

    const operation = extractOperation(params.method || 'GET', params.path);
    const index = params.path.split('/').find((s: string) => s && !s.startsWith('_'));
    span.updateName(index ? `${operation} ${index}` : operation);

    if (params.body && typeof params.body === 'string') {
      const truncated = params.body.length > 2048 ? `${params.body.slice(0, 2048)}...` : params.body;
      span.setAttribute('db.statement', truncated);
    }
  });

  diag.on('response', (err, result) => {
    if (!result) return;

    const requestId = result.meta?.request?.id;
    const startTime = requestId != null ? requestStartTimes.get(requestId) : undefined;
    if (requestId != null) {
      requestStartTimes.delete(requestId);
    }
    if (startTime === undefined) return;

    const durationS = (performance.now() - startTime) / 1000;
    const method = result.meta?.request?.params?.method || 'UNKNOWN';
    const path = result.meta?.request?.params?.path || '';
    const operation = extractOperation(method, path);

    const attrs: Record<string, string | number> = {
      'db.system.name': 'elasticsearch',
      'db.operation.name': operation,
      'db.namespace': INDEX_NAME,
      'server.address': esServerAddress,
      'server.port': esServerPort,
    };

    if (result.statusCode) {
      attrs['db.response.status_code'] = String(result.statusCode);
    }

    if (err) {
      attrs['error.type'] = err.name || 'elasticsearch_error';
    }

    operationDuration.record(durationS, attrs);
  });
}
