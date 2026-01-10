export default defineNuxtRouteMiddleware((to, from) => {
  const useUserStore = userStore();
  if (useUserStore.isLoggedIn === true) {
    return
  }
  return navigateTo("/");
});