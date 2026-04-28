import { faro } from '@grafana/faro-web-sdk';
import { getPagePath } from '~/utils/pagePath';

function toError(value: unknown): Error {
  if (value instanceof Error) return value;
  return new Error(typeof value === 'string' ? value : 'Unknown error');
}

function getComponentName(value: unknown): string {
  if (value && typeof value === 'object') {
    const component = value as { $options?: { name?: string }; $type?: { name?: string } };
    return component.$options?.name || component.$type?.name || 'Unknown';
  }
  return 'Unknown';
}

function reportError(name: string, error: unknown, attributes?: Record<string, string>) {
  if (!faro.api) {
    console.error(`[${name}]`, error);
    return;
  }

  faro.api.pushError(toError(error), {
    type: name,
    context: {
      'page.path': getPagePath(),
      'browser.url': window.location.href,
      ...attributes,
    },
  });
}

export default defineNuxtPlugin({
  name: 'errorHandler',
  setup(nuxtApp) {
    nuxtApp.vueApp.config.errorHandler = (err, instance, info) => {
      reportError('vue:error', err, {
        'vue.info': info || '',
        'vue.component': getComponentName(instance),
      });
    };
  },
});
