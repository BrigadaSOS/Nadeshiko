const AUTH_BASE = '/v1/auth';

type SocialSignInOptions = {
  provider: string;
  callbackURL: string;
  errorCallbackURL: string;
};

type SignInResponse = {
  url?: string;
  error?: { message?: string };
};

export async function signInSocial(options: SocialSignInOptions): Promise<{ error?: string }> {
  const response = await $fetch<SignInResponse>(`${AUTH_BASE}/sign-in/social`, {
    method: 'POST',
    credentials: 'include',
    body: {
      provider: options.provider,
      callbackURL: options.callbackURL,
      errorCallbackURL: options.errorCallbackURL,
    },
  });

  if (response?.error) {
    return { error: response.error.message || 'Sign in failed' };
  }

  if (response?.url) {
    window.location.href = response.url;
  }

  return {};
}

export async function signOut(): Promise<void> {
  await $fetch(`${AUTH_BASE}/sign-out`, {
    method: 'POST',
    credentials: 'include',
  });
}
