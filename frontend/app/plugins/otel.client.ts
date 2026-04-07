import { trace } from '@opentelemetry/api';
import { WebTracerProvider, type SpanProcessor } from '@opentelemetry/sdk-trace-web';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ZoneContextManager } from '@opentelemetry/context-zone';
import { DocumentLoadInstrumentation } from '@opentelemetry/instrumentation-document-load';
import { FetchInstrumentation } from '@opentelemetry/instrumentation-fetch';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { onCLS, onINP, onLCP, onTTFB } from 'web-vitals';

function getPagePath(): string {
  try {
    return new URL(window.location.href).pathname;
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
          ignoreUrls: [/\/otel-collector/, /cloud\.umami\.is/],
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

    return {
      provide: { otelTracer: tracer },
    };
  },
});
