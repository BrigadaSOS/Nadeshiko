export default defineNuxtPlugin(() => {
  const store = userStore();
  const { $i18n } = useNuxtApp();
  const route = useRoute();
  const posthog = usePostHog();

  if (import.meta.client) {
    const isOAuthCallback = route.query.error || route.query.code || route.query.state;
    const isMagicLinkCallback = route.query.magic_callback === '1';

    if (!isOAuthCallback && !isMagicLinkCallback) return;

    const router = useRouter();
    router.replace({ query: {} });

    setTimeout(async () => {
      if (route.query.error === 'banned') {
        useToastError($i18n.t('modalauth.labels.banneduser'));
        return;
      }
      if (route.query.error) {
        useToastError($i18n.t('modalauth.labels.errorlogin400'));
        return;
      }

      if (!store.isLoggedIn) {
        await store.getBasicInfo();
      }
      if (store.isLoggedIn) {
        useToastSuccess($i18n.t('modalauth.labels.successfullogin'));
        if (store.userName) {
          posthog?.identify(store.userName, { email: store.userEmail ?? undefined });
        }
        posthog?.capture('user_logged_in', {
          provider: isMagicLinkCallback ? 'magic_link' : 'oauth',
        });
      }
    }, 200);
  }
});
