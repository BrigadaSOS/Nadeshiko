export default defineNuxtRouteMiddleware((_to, _from) => {
  const useUserStore = userStore();
  if (useUserStore.isLoggedIn === true) {
    return;
  }
  return navigateTo('/');
});
