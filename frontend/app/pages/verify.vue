<script setup lang="ts">
// Forward still-valid legacy /verify?token= links to Better Auth's current verification endpoint.
const route = useRoute();
const requestUrl = useRequestURL();

const token = typeof route.query.token === 'string' ? route.query.token : '';
if (!token) {
  throw createError({ statusCode: 400, statusMessage: 'Verification token is missing' });
}

// The account settings redirect resolves the reader's locale across devices.
const defaultCallback = `${requestUrl.origin}/user/settings`;
const requestedCallback = typeof route.query.callbackURL === 'string' ? route.query.callbackURL : '';
let callbackURL = defaultCallback;
if (requestedCallback) {
  try {
    const parsedCallback = new URL(requestedCallback, requestUrl.origin);
    if (parsedCallback.origin === requestUrl.origin) callbackURL = parsedCallback.toString();
  } catch {
    // Fall back to the account settings page for malformed callback URLs.
  }
}

const verificationUrl = new URL('/v1/auth/verify-email', requestUrl.origin);
verificationUrl.searchParams.set('token', token);
verificationUrl.searchParams.set('callbackURL', callbackURL);
await navigateTo(verificationUrl.toString(), { external: true, redirectCode: 302 });
</script>

<template>
  <main class="flex min-h-screen items-center justify-center" aria-live="polite">
    <p>{{ $t('modalauth.verifyingEmail') }}</p>
  </main>
</template>
