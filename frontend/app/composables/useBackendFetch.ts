/**
 * Returns a $fetch-compatible base URL and headers for hitting the backend
 * directly during SSR, or through the Nitro proxy on the client.
 */
export function useBackendFetchOptions(): { baseURL: string; headers: Record<string, string> } {
  if (import.meta.server) {
    const config = useRuntimeConfig();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${config.nadeshikoApiKey as string}`,
    };
    if (config.backendHostHeader) {
      headers.Host = String(config.backendHostHeader);
    }
    return {
      baseURL: String(config.backendInternalUrl || '').replace(/\/$/, ''),
      headers,
    };
  }
  return { baseURL: '', headers: {} };
}
