import { createAuthClient } from 'better-auth/client';

export default defineNuxtPlugin(() => {
  const config = useRuntimeConfig();

  const auth = createAuthClient({
    baseURL: config.public.backendUrl,
    basePath: '/api/auth',
    fetchOptions: {
      credentials: 'include',
    },
  });

  return {
    provide: {
      auth,
    },
  };
});
