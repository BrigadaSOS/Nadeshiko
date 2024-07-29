// middleware/auth.ts
const store = userStore();
const isAuth = computed(() => store.isLoggedIn);
export default defineNuxtRouteMiddleware(async (to, from) => {
  if (import.meta.server) return;
  if (!isAuth.value) return;
  try {
    await store.getBasicInfo();
    if (!isAuth.value) {
      return navigateTo("/");
    }
  } catch (error) {
    console.error(error);
    return navigateTo("/");
  }
});
