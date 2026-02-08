import { createAuthClient } from 'better-auth/client';

export default defineNuxtPlugin(() => {
  const auth = createAuthClient({
    baseURL: window.location.origin,
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
