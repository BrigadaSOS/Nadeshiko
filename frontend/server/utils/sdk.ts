import { createNadeshikoClient, type NadeshikoClient } from '@brigadasos/nadeshiko-sdk';

export function useServerSdk(): NadeshikoClient {
  const config = useRuntimeConfig();
  const baseURL = String(config.backendInternalUrl || '').replace(/\/$/, '');
  const hostHeader = String(config.backendHostHeader || '');
  const apiKey = String(config.nadeshikoApiKey || '');

  const client = createNadeshikoClient({ apiKey, baseURL });
  if (hostHeader) {
    client.client.interceptors.request.use((request) => {
      request.headers.set('Host', hostHeader);
      return request;
    });
  }
  return client;
}
