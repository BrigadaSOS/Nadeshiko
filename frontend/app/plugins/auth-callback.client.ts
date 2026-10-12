import {
  AUTH_CALLBACK_PARAM,
  authEventProperties,
  authIntentStorage,
  authReturnToStorage,
  consumeAuthIntent,
  consumeAuthReturnTo,
  isAuthCallbackPath,
} from '~/utils/authAnalytics';
import { isAccountLinkCallback } from '~/utils/accountLinks';
import { reportEvent } from '~/utils/reportError';

/**
 * Report rejection with the shared auth attribution fields and consume the completed intent so it cannot
 * credit a later login.
 */
function reportFailedLogin(reason: string) {
  const intent = consumeAuthIntent(authIntentStorage(), Date.now());
  usePostHog()?.capture('login_failed', { ...authEventProperties(intent), reason });
}

/**
 * Access denial may mean cancellation or account policy refusal; suggest email sign-in rather than retrying
 * the same provider.
 */
function callbackErrorLabel(reason: string): string {
  if (reason === 'banned') return 'modalauth.labels.banneduser';
  if (reason === 'access_denied') return 'modalauth.labels.logindenied';
  return 'modalauth.labels.errorlogin400';
}

export default defineNuxtPlugin({
  name: 'auth-callback',
  // Wait for session bootstrap and toast installation before handling the callback.
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

    // Linking a third-party account is the same OAuth shape and not a sign-in;
    // the bare `code`/`state` test above cannot tell them apart. See
    // `isAccountLinkCallback` for what claiming those pages did.
    if (isAccountLinkCallback(route.path)) return;

    // `route` is the live current route: once the query is stripped below there is
    // nothing left to branch on, so the outcome has to be read out first.
    const callbackError = Array.isArray(route.query.error) ? route.query.error[0] : route.query.error;
    const isStableCallback = isAuthCallbackPath(route.path);
    const returnTo = isStableCallback ? consumeAuthReturnTo(authReturnToStorage()) : null;
    const locale = route.path.match(/^\/(en|es|ja|zh|zh-hant|id|pt-BR)(?:\/|$)/)?.[1];
    const fallbackPath = locale ? `/${locale}` : '/en';

    // Deferred to `app:mounted` for the router, not for the plugins: the initial
    // client navigation is still settling while plugins run, and it writes the
    // callback query back over anything replaced before it lands.
    nuxtApp.hook('app:mounted', async () => {
      const router = useRouter();
      await router.replace({ path: route.path, query: {} });

      if (callbackError) {
        // Record rejection separately from provider abandonment.
        reportFailedLogin(String(callbackError));
        useToastError($i18n.t(callbackErrorLabel(String(callbackError))));
        await router.replace(returnTo ?? fallbackPath);
        return;
      }

      if (!store.isLoggedIn) {
        await store.getBasicInfo();
      }
      if (store.isLoggedIn) {
        useToastSuccess($i18n.t('modalauth.labels.successfullogin'));
        // Reconcile identity with callback evidence; an already-reported transition remains a no-op.
        reconcileAnalyticsIdentity({ viaCallback: true });
      } else {
        reportEvent('auth_callback_session_failed', { 'auth.callback_path': route.path });
        useToastError($i18n.t('modalauth.labels.errorlogin400'));
      }
      await router.replace(returnTo ?? fallbackPath);
    });
  },
});
