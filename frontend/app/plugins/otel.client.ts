import { trace } from '@opentelemetry/api';
import { WebTracerProvider, type SpanProcessor } from '@opentelemetry/sdk-trace-web';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { LoggerProvider, BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { SeverityNumber } from '@opentelemetry/api-logs';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ZoneContextManager } from '@opentelemetry/context-zone';
import { DocumentLoadInstrumentation } from '@opentelemetry/instrumentation-document-load';
import { FetchInstrumentation } from '@opentelemetry/instrumentation-fetch';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { onCLS, onINP, onLCP, onTTFB } from 'web-vitals';

const DYNAMIC_ROUTE_PATTERNS: [RegExp, string][] = [
  [/^\/search\/.*/, '/search/:query'],
  [/^\/sentence\/.*/, '/sentence/:id'],
  [/^\/collection\/.*/, '/collection/:id'],
  [/^\/s\/.*/, '/s/:id'],
  [/^\/admin\/.*/, '/admin/:slug'],
  [/^\/settings\/.*/, '/settings/:slug'],
  [/^\/user\/.*/, '/user/:slug'],
];

function getPagePath(): string {
  try {
    const path = new URL(window.location.href).pathname;
    for (const [pattern, replacement] of DYNAMIC_ROUTE_PATTERNS) {
      if (pattern.test(path)) return replacement;
    }
    return path;
  } catch {
    return '/';
  }
}

function getUrlPath(url: string): string {
  try {
    return new URL(url).pathname;
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
  }
  onEnd() {}
}


export default defineNuxtPlugin({
  name: 'otel',
  setup() {
    const config = useRuntimeConfig();

    const exporter = new OTLPTraceExporter({ url: '/otel-collector' });

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
          ignoreUrls: [/\/otel-collector/, /\/otel-logs/, /cloud\.umami\.is/],
        }),
      ],
    });

    const tracer = trace.getTracer('nadeshiko-browser', config.public.appVersion || '0.0.0');

    function reportVital({ name, value, rating }: { name: string; value: number; rating: string }) {
      const span = tracer.startSpan(`web-vital ${name}`);
      span.setAttribute('vital.name', name);
      span.setAttribute('vital.value', value);
      span.setAttribute('vital.rating', rating);
      span.end();
    }

    onTTFB(reportVital);
    onLCP(reportVital);
    onCLS(reportVital);
    onINP(reportVital);

    const logExporter = new OTLPLogExporter({ url: '/otel-logs' });
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

    const originalOnError = window.onerror;
    window.onerror = (message, source, lineno, colno, error) => {
      logger.emit({
        severityNumber: SeverityNumber.ERROR,
        severityText: 'ERROR',
        body: String(message),
        attributes: {
          'log.source': 'window.onerror',
          'page.path': getPagePath(),
          'exception.source': source || '',
          'exception.lineno': lineno || 0,
          'exception.colno': colno || 0,
          'exception.type': error?.name || '',
          'exception.stacktrace': error?.stack || '',
        },
      });
      if (originalOnError) return originalOnError(message, source, lineno, colno, error);
      return false;
    };

    window.addEventListener('unhandledrejection', (event) => {
      const reason = event.reason;
      logger.emit({
        severityNumber: SeverityNumber.ERROR,
        severityText: 'ERROR',
        body: reason instanceof Error ? reason.message : String(reason),
        attributes: {
          'log.source': 'unhandledrejection',
          'page.path': getPagePath(),
          'exception.type': reason instanceof Error ? reason.name : 'UnhandledRejection',
          'exception.stacktrace': reason instanceof Error ? reason.stack || '' : '',
        },
      });
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') logProcessor.forceFlush();
    });

    return {
      provide: { otelTracer: tracer },
    };
  },
});
