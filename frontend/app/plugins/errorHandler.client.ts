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
      reportError('vue:error', err, {
        'vue.info': info || '',
        'vue.component': getComponentName(instance),
      });
    };
  },
});
