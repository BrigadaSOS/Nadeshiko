import { AUTH_CALLBACK_PARAM, authEventProperties, authIntentStorage, consumeAuthIntent } from '~/utils/authAnalytics';

/**
 * Reports an auth round trip that came back rejected, tagged with the same
 * provider/source/gate the successful events carry so the two are comparable.
 *
 * The intent is consumed rather than left parked: this attempt is over, and
 * leaving it behind would credit the gate to whatever login happens next.
 */
function reportFailedLogin(reason: string) {
  const intent = consumeAuthIntent(authIntentStorage(), Date.now());
  usePostHog()?.capture('login_failed', { ...authEventProperties(intent), reason });
}

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

    // `nd_auth` is put on the callback URL by the login flow itself. The
    // `code`/`state`/`error` checks below it are kept for the error case, which
    // better-auth does signal that way, and `magic_callback` for links already
    // sitting in an inbox from before the marker existed.
    const isMarkedCallback = route.query[AUTH_CALLBACK_PARAM] === '1';
    const isOAuthCallback = route.query.error || route.query.code || route.query.state;
    const isMagicLinkCallback = route.query.magic_callback === '1';

    if (!isMarkedCallback && !isOAuthCallback && !isMagicLinkCallback) return;

    // `route` is the live current route: once the query is stripped below there is
    // nothing left to branch on, so the outcome has to be read out first.
    const callbackError = Array.isArray(route.query.error) ? route.query.error[0] : route.query.error;

    // Deferred to `app:mounted` for the router, not for the plugins: the initial
    // client navigation is still settling while plugins run, and it writes the
    // callback query back over anything replaced before it lands.
    nuxtApp.hook('app:mounted', async () => {
      const router = useRouter();
      await router.replace({ path: route.path, query: {} });

      if (callbackError) {
        // Without this, a provider that rejects everyone looks exactly like a
        // provider nobody chooses -- both are simply an absence of signups. That
        // is not hypothetical here: 264 people picked Google in 90 days and the
        // data could not say what became of any of them.
        reportFailedLogin(String(callbackError));
        useToastError(
          $i18n.t(callbackError === 'banned' ? 'modalauth.labels.banneduser' : 'modalauth.labels.errorlogin400'),
        );
        return;
      }

      if (!store.isLoggedIn) {
        await store.getBasicInfo();
      }
      if (store.isLoggedIn) {
        useToastSuccess($i18n.t('modalauth.labels.successfullogin'));
        // The identify, the signup-or-login decision and the provider that earned
        // it all live in one place now. This call differs from the one
        // `identity-auth` already made only in knowing the load was an auth
        // landing, which is what lets a returning reader's login be counted; if
        // that pass already reported the transition, this one is a no-op.
        reconcileAnalyticsIdentity({ viaCallback: true });
      }
    });
  },
});
