import { LogLevel, getWebInstrumentations, initializeFaro, type Faro } from '@grafana/faro-web-sdk';
import { OtlpHttpTransport } from '@grafana/faro-transport-otlp-http';
import { TracingInstrumentation } from '@grafana/faro-web-tracing';
import { getPagePath } from '~/utils/pagePath';

const TRACE_HEADER_CORS_URLS = [/^https?:\/\/(dev\.)?nadeshiko\.co/, /^https:\/\/api(?:-dev)?\.nadeshiko\.co/];
const IGNORED_URLS = [/cloud\.umami\.is/, /static\.cloudflareinsights\.com/];

function getFaroOrigin(url: string): string | undefined {
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

function getAppName(environment: string, configuredName: string): string {
  if (configuredName) return configuredName;
  return environment === 'development' ? 'nadeshiko-frontend-browser-dev' : 'nadeshiko-frontend-browser-prod';
}

function syncRouteContext(faroInstance: Faro) {
  const path = getPagePath();
  faroInstance.api.setView({ name: path });
  faroInstance.api.setPage({
    id: path,
    url: window.location.href,
    attributes: { path },
  });
}

export default defineNuxtPlugin({
  name: 'faro',
  setup() {
    const config = useRuntimeConfig();
    const faroUrl = String(config.public.faroUrl || '');
    const environment = String(config.public.environment || 'production');
    const faroAppName = String(config.public.faroAppName || '');
    const appVersion = String(config.public.appVersion || '0.0.0');

    if (!faroUrl) return;

    const faroOrigin = getFaroOrigin(faroUrl);
    const ignoreUrls = faroOrigin ? [...IGNORED_URLS, faroOrigin] : IGNORED_URLS;

    const tracesURL = `${faroUrl.replace(/\/$/, '')}/v1/traces`;
    const logsURL = `${faroUrl.replace(/\/$/, '')}/v1/logs`;

    const faroInstance = initializeFaro({
      app: {
        name: getAppName(environment, faroAppName),
        version: appVersion,
        environment,
      },
      transports: [
        new OtlpHttpTransport({
          tracesURL,
          logsURL,
        }),
      ],
      trackResources: true,
      sessionTracking: {
        persistent: true,
      },
      pageTracking: {
        page: {
          id: getPagePath(),
          attributes: { path: getPagePath() },
        },
      },
      view: { name: getPagePath() },
      ignoreUrls,
      consoleInstrumentation: {
        disabledLevels: [LogLevel.DEBUG, LogLevel.TRACE, LogLevel.LOG],
        serializeErrors: true,
      },
      webVitalsInstrumentation: {
        reportAllChanges: true,
      },
      instrumentations: [
        ...getWebInstrumentations({
          captureConsole: true,
          enablePerformanceInstrumentation: true,
        }),
        new TracingInstrumentation({
          instrumentationOptions: {
            propagateTraceHeaderCorsUrls: TRACE_HEADER_CORS_URLS,
            fetchInstrumentationOptions: {
              applyCustomAttributesOnSpan(span, _request, result) {
                if (result instanceof Response) {
                  span.setAttribute('http.response.status_code', result.status);
                  span.setAttribute('page.path', getPagePath());
                }
              },
            },
            xhrInstrumentationOptions: {
              applyCustomAttributesOnSpan(span, xhr) {
                span.setAttribute('http.response.status_code', xhr.status);
                span.setAttribute('page.path', getPagePath());
              },
            },
          },
          resourceAttributes: {
            'client.timezone': Intl.DateTimeFormat().resolvedOptions().timeZone,
          },
        }),
      ],
    });

    const router = useRouter();
    syncRouteContext(faroInstance);
    router.afterEach(() => {
      syncRouteContext(faroInstance);
    });

    return {
      provide: {
        faro: faroInstance,
      },
    };
  },
});
