export default defineNuxtPlugin(() => {
  const store = userStore();
  const { $i18n } = useNuxtApp();
  const route = useRoute();

  if (import.meta.client) {
    const hasOAuthError = route.query.error;
    const isOAuthCallback = hasOAuthError || route.query.code || route.query.state;
    const isMagicLinkCallback = route.query.magic_callback === '1';

    if (isMagicLinkCallback) {
      const router = useRouter();
      const isBanned = route.query.error === 'banned';
      router.replace({ query: {} });

      setTimeout(async () => {
        if (isBanned) {
          useToastError($i18n.t('modalauth.labels.banneduser'));
          return;
        }
        if (!store.isLoggedIn) {
          await store.getBasicInfo();
        }
        if (store.isLoggedIn) {
          useToastSuccess($i18n.t('modalauth.labels.successfullogin'));
        }
      }, 200);
    } else if (isOAuthCallback) {
      setTimeout(async () => {
        const wasLoggedIn = store.isLoggedIn;

        await store.getBasicInfo();

        const router = useRouter();

        if (store.isLoggedIn && !wasLoggedIn) {
          useToastSuccess($i18n.t('modalauth.labels.successfullogin'));
          router.replace({ query: {} });
        } else if (hasOAuthError) {
          useToastError($i18n.t('modalauth.labels.errorlogin400'));
          router.replace({ query: {} });
        }
      }, 500);
    }
  }
});
