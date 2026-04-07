import { SpanStatusCode } from '@opentelemetry/api';
import type { Tracer } from '@opentelemetry/api';

function getErrorMessage(value: unknown): string {
  if (value instanceof Error) return value.message;
  return 'Unknown error';
}

function getComponentName(value: unknown): string {
  if (value && typeof value === 'object') {
    const component = value as { $options?: { name?: string }; $type?: { name?: string } };
    return component.$options?.name || component.$type?.name || 'Unknown';
  }
  return 'Unknown';
}

function reportError(tracer: Tracer | undefined, name: string, error: unknown, attributes?: Record<string, string>) {
  console.error(`[${name}]`, error);

  if (!tracer) return;

  const span = tracer.startSpan(name, {
    attributes: {
      'error.type': name,
      'browser.url': window.location.href,
      ...attributes,
    },
  });

  span.recordException(error instanceof Error ? error : new Error(String(error)));
  span.setStatus({ code: SpanStatusCode.ERROR, message: getErrorMessage(error) });
  span.end();
}

export default defineNuxtPlugin({
  name: 'errorHandler',
  dependsOn: ['otel'],
  setup(nuxtApp) {
    const tracer = nuxtApp.$otelTracer as Tracer | undefined;

    nuxtApp.vueApp.config.errorHandler = (err, instance, info) => {
      reportError(tracer, 'vue:error', err, {
        'vue.info': info || '',
        'vue.component': getComponentName(instance),
      });
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('unhandledrejection', (event) => {
        reportError(tracer, 'unhandledRejection', event.reason);
      });

      window.addEventListener('error', (event) => {
        reportError(tracer, 'global:error', event.error || event.message, {
          'error.filename': event.filename || '',
          'error.lineno': String(event.lineno || 0),
          'error.colno': String(event.colno || 0),
        });
      });
    }
  },
});
