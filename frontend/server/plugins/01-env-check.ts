export default defineNitroPlugin(() => {
  if (import.meta.prerender) {
    return;
  }

  const config = useRuntimeConfig();

  const missing: string[] = [];
  if (!config.backendInternalUrl) missing.push('NUXT_BACKEND_INTERNAL_URL');
  if (!config.nadeshikoApiKey) missing.push('NUXT_NADESHIKO_API_KEY');

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
});
