// Plugin identity-auth.ts
export default defineNuxtPlugin((nuxtApp) => {
  const store = userStore();
  const authCookie = useCookie("access_token");

  if (import.meta.server) {
    // En el servidor, verifica si existe el token
    store.isLoggedIn = !!authCookie.value;
  }
});