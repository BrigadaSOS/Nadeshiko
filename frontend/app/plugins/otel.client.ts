import { trace } from '@opentelemetry/api';
import { WebTracerProvider, type SpanProcessor } from '@opentelemetry/sdk-trace-web';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { LoggerProvider, BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { SeverityNumber } from '@opentelemetry/api-logs';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ZoneContextManager } from '@opentelemetry/context-zone';
import { DocumentLoadInstrumentation } from '@opentelemetry/instrumentation-document-load';
import { FetchInstrumentation } from '@opentelemetry/instrumentation-fetch';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { onCLS, onINP, onLCP, onTTFB } from 'web-vitals';
import { getPagePath } from '~/utils/pagePath';

const ID_PATTERN = /^[0-9]+$|^[0-9a-f]{8,}$/i;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NANOID_PATTERN = /^[A-Za-z0-9_-]{8,}$/;

function isIdSegment(seg: string): boolean {
  if (ID_PATTERN.test(seg)) return true;
  if (UUID_PATTERN.test(seg)) return true;
  if (seg.length >= 8 && NANOID_PATTERN.test(seg) && /[0-9]/.test(seg) && /[A-Za-z]/.test(seg)) return true;
  return false;
}

function normalizePath(path: string): string {
  return path
    .split('/')
    .map((s) => (s !== '' && isIdSegment(s) ? ':id' : s))
    .join('/');
}

function getUrlPath(url: string): string {
  try {
    return normalizePath(new URL(url).pathname);
  } catch {
    return url;
  }
}

class SpanRenamer implements SpanProcessor {
  forceFlush() {
    return Promise.resolve();
  }
  shutdown() {
    return Promise.resolve();
  }
  onStart(span: any) {
    const name = span.name;
    if (name === 'documentFetch' || name === 'documentLoad') {
      span.updateName(`${name} ${getPagePath()}`);
      span.setAttribute('page.path', getPagePath());
    } else if (name === 'resourceFetch') {
      const url = span.attributes?.['http.url'] || '';
      const path = getUrlPath(url);
      span.updateName(`resourceFetch ${path}`);
    } else if (name.startsWith('HTTP ')) {
      const method = name.replace('HTTP ', '');
      const url = span.attributes?.['http.url'] || '';
      const path = getUrlPath(url);
      span.updateName(`${method} ${path}`);
    }

    if (span.attributes?.['http.url']) {
      try {
        span.setAttribute('http.url', decodeURIComponent(span.attributes['http.url']));
      } catch {}
    }
  }
  onEnd() {}
}

export default defineNuxtPlugin({
  name: 'otel',
  setup() {
    const config = useRuntimeConfig();
    const collectorUrl = config.public.otelCollectorUrl;

    if (!collectorUrl) return;

    const exporter = new OTLPTraceExporter({ url: `${collectorUrl}/v1/traces` });

    const conn = (navigator as any).connection;
    const resourceAttrs: Record<string, string> = {
      'service.name':
        config.public.environment === 'development'
          ? 'nadeshiko-frontend-browser-dev'
          : 'nadeshiko-frontend-browser-prod',
      'service.version': config.public.appVersion || '0.0.0',
      'deployment.environment': config.public.environment || 'production',
      'client.timezone': Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
    if (conn?.effectiveType) resourceAttrs['client.connection.effective_type'] = conn.effectiveType;
    if (conn?.rtt != null) resourceAttrs['client.connection.rtt'] = String(conn.rtt);
    if (conn?.downlink != null) resourceAttrs['client.connection.downlink'] = String(conn.downlink);
    if (conn?.saveData != null) resourceAttrs['client.connection.save_data'] = String(conn.saveData);

    const provider = new WebTracerProvider({
      resource: resourceFromAttributes(resourceAttrs),
      spanProcessors: [
        new SpanRenamer(),
        new BatchSpanProcessor(exporter, {
          maxQueueSize: 100,
          maxExportBatchSize: 20,
          scheduledDelayMillis: 5000,
        }),
      ],
    });

    provider.register({ contextManager: new ZoneContextManager() });

    registerInstrumentations({
      instrumentations: [
        new DocumentLoadInstrumentation(),
        new FetchInstrumentation({
          propagateTraceHeaderCorsUrls: [/^https?:\/\/(dev\.)?nadeshiko\.co/],
          ignoreUrls: [/o\.nadeshiko\.co/, /cloud\.umami\.is/],
          applyCustomAttributesOnSpan(span, _request, result) {
            if (result instanceof Response) {
              span.setAttribute('http.response.status_code', result.status);
            }
          },
        }),
      ],
    });

    const tracer = trace.getTracer('nadeshiko-browser', config.public.appVersion || '0.0.0');

    const meterProvider = new MeterProvider({
      resource: resourceFromAttributes(resourceAttrs),
      readers: [
        new PeriodicExportingMetricReader({
          exporter: new OTLPMetricExporter({ url: `${collectorUrl}/v1/metrics` }),
          exportIntervalMillis: 30_000,
        }),
      ],
    });
    const meter = meterProvider.getMeter('nadeshiko-browser');

    const vitalHistograms: Record<string, ReturnType<typeof meter.createHistogram>> = {
      TTFB: meter.createHistogram('web_vital.ttfb', {
        description: 'Time to First Byte',
        unit: 'ms',
        advice: { explicitBucketBoundaries: [0, 100, 200, 400, 800, 1200, 1800, 3000, 5000] },
      }),
      LCP: meter.createHistogram('web_vital.lcp', {
        description: 'Largest Contentful Paint',
        unit: 'ms',
        advice: { explicitBucketBoundaries: [0, 200, 500, 1000, 2500, 4000, 6000, 10000] },
      }),
      CLS: meter.createHistogram('web_vital.cls', {
        description: 'Cumulative Layout Shift',
        unit: '',
        advice: { explicitBucketBoundaries: [0, 10, 25, 50, 100, 250, 500, 1000] },
      }),
      INP: meter.createHistogram('web_vital.inp', {
        description: 'Interaction to Next Paint',
        unit: 'ms',
        advice: { explicitBucketBoundaries: [0, 50, 100, 200, 300, 500, 1000, 2000] },
      }),
    };

    function reportVital({ name, value, rating }: { name: string; value: number; rating: string }) {
      const span = tracer.startSpan(`web-vital ${name}`);
      span.setAttribute('vital.name', name);
      span.setAttribute('vital.value', value);
      span.setAttribute('vital.rating', rating);
      span.end();

      // CLS is a unitless score (0–1 range); multiply by 1000 to align with histogram buckets
      const recordValue = name === 'CLS' ? value * 1000 : value;
      vitalHistograms[name]?.record(recordValue, { 'vital.rating': rating, 'page.path': getPagePath() });
    }

    onTTFB(reportVital);
    onLCP(reportVital, { reportAllChanges: true });
    onCLS(reportVital, { reportAllChanges: true });
    onINP(reportVital);

    const logExporter = new OTLPLogExporter({ url: `${collectorUrl}/v1/logs` });
    const logProcessor = new BatchLogRecordProcessor(logExporter, {
      maxQueueSize: 50,
      maxExportBatchSize: 10,
      scheduledDelayMillis: 10_000,
    });
    const loggerProvider = new LoggerProvider({
      resource: resourceFromAttributes(resourceAttrs),
      processors: [logProcessor],
    });
    const logger = loggerProvider.getLogger('browser-console');

    const errorCounter = meter.createCounter('app.exception', {
      description: 'Total application exceptions by fingerprint',
    });

    const severityMap: Record<string, SeverityNumber> = {
      error: SeverityNumber.ERROR,
      warn: SeverityNumber.WARN,
    };

    for (const level of ['error', 'warn'] as const) {
      const original = console[level];
      console[level] = (...args: unknown[]) => {
        original.apply(console, args);
        logger.emit({
          severityNumber: severityMap[level],
          severityText: level.toUpperCase(),
          body: args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' '),
          attributes: { 'log.source': 'console', 'page.path': getPagePath() },
        });
      };
    }

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        provider.forceFlush();
        logProcessor.forceFlush();
        meterProvider.forceFlush();
      }
    });

    return {
      provide: { otelTracer: tracer, otelErrorCounter: errorCounter },
    };
  },
});
