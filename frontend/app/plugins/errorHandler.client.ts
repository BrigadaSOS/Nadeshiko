import { reportError } from '~/utils/reportError';

function getComponentName(value: unknown): string {
  if (value && typeof value === 'object') {
    const component = value as { $options?: { name?: string }; $type?: { name?: string } };
    return component.$options?.name || component.$type?.name || 'Unknown';
  }
  return 'Unknown';
}

export default defineNuxtPlugin({
  name: 'errorHandler',
  setup(nuxtApp) {
    nuxtApp.vueApp.config.errorHandler = (err, instance, info) => {
      // Faro only: `@posthog/nuxt` already captures every error that reaches here,
      // through its own `vue:error` hook, so sending it to PostHog too would record
      // the same throw twice.
      reportError(
        'vue:error',
        err,
        {
          'vue.info': info || '',
          'vue.component': getComponentName(instance),
        },
        { faroOnly: true },
      );
    };
  },
});
