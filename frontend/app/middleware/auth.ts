export default defineNuxtRouteMiddleware((_to, _from) => {
  const useUserStore = userStore();
  if (useUserStore.isLoggedIn === true) {
    return;
  }
  const localePath = useLocalePath();
  return navigateTo(localePath('/'));
});
