// plugins/scalar.client.ts
import '@scalar/api-reference/style.css';

export default defineNuxtPlugin(async () => {
  const mod = await import('@scalar/api-reference');

  return {
    provide: {
      ScalarApiReference: mod.ApiReference,
    },
  };
});
