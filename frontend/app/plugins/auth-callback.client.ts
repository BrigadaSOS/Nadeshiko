export default defineNuxtPlugin({
  name: 'auth-callback',
  // `identity-auth` finishes the client-side session bootstrap that
  // `store.isLoggedIn` is read from below, and `vue-toastification` installs the
  // Vue plugin every toast here needs. Both sort after this file by name, so
  // without this they would run second.
  dependsOn: ['identity-auth', 'vue-toastification'],
  setup(nuxtApp) {
    const store = userStore();
    const { $i18n } = useNuxtApp();
    const route = useRoute();
    const posthog = usePostHog();

    const isOAuthCallback = route.query.error || route.query.code || route.query.state;
    const isMagicLinkCallback = route.query.magic_callback === '1';

    if (!isOAuthCallback && !isMagicLinkCallback) return;

    // `route` is the live current route: once the query is stripped below there is
    // nothing left to branch on, so the outcome has to be read out first.
    const callbackError = Array.isArray(route.query.error) ? route.query.error[0] : route.query.error;

    // Deferred to `app:mounted` for the router, not for the plugins: the initial
    // client navigation is still settling while plugins run, and it writes the
    // callback query back over anything replaced before it lands.
    nuxtApp.hook('app:mounted', async () => {
      const router = useRouter();
      await router.replace({ path: route.path, query: {} });

      if (callbackError === 'banned') {
        useToastError($i18n.t('modalauth.labels.banneduser'));
        return;
      }
      if (callbackError) {
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
    });
  },
});
