<script setup lang="ts">
/**
 * Compatibility entry point for verification links minted by older Nadeshiko
 * deployments. Better Auth's current endpoint is `/v1/auth/verify-email`, but
 * older mail used `/verify?token=...`; forwarding here lets those still-valid
 * tokens complete instead of falling through to the content catch-all and 404.
 */
const route = useRoute();
const requestUrl = useRequestURL();

const token = typeof route.query.token === 'string' ? route.query.token : '';
if (!token) {
  throw createError({ statusCode: 400, statusMessage: 'Verification token is missing' });
}

// The legacy `/settings` redirect localizes this path for the reader, so this
// callback remains valid even when the verification link is opened in another
// language or on another device.
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
    <p>Verifying your email…</p>
  </main>
</template>
