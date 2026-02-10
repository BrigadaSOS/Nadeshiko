export default defineNuxtPlugin(() => {
  const store = userStore();
  const { $i18n } = useNuxtApp();
  const route = useRoute();

  // Check if we're returning from an OAuth callback
  // better-auth uses error and error_description params for errors
  if (import.meta.client) {
    const hasOAuthError = route.query.error;
    const isOAuthCallback = hasOAuthError || route.query.code || route.query.state;

    if (isOAuthCallback) {
      // Give better-auth time to process the callback
      setTimeout(async () => {
        const wasLoggedIn = store.isLoggedIn;

        // Refresh auth state
        await store.getBasicInfo();

        // Show appropriate notification
        if (store.isLoggedIn && !wasLoggedIn) {
          useToastSuccess($i18n.t('modalauth.labels.successfullogin'));

          // Clean up URL parameters
          const router = useRouter();
          router.replace({ query: {} });
        } else if (hasOAuthError) {
          useToastError($i18n.t('modalauth.labels.errorlogin400'));
        }
      }, 500);
    }
  }
});
