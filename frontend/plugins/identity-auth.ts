export default defineNuxtPlugin(() => {
  const store = userStore();

  if (import.meta.server) {
    const cookieMain = useCookie('nadeshiko.session_token');
    const cookieSecure = useCookie('__Secure-nadeshiko.session_token');
    const cookieHost = useCookie('__Host-nadeshiko.session_token');
    store.isLoggedIn = Boolean(cookieMain.value || cookieSecure.value || cookieHost.value);
  }
});
