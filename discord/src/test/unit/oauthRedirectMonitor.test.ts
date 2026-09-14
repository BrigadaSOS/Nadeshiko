import { beforeEach, describe, expect, test, vi } from 'vitest';

type GaugeCallback = (result: { observe: (value: number, attrs: Record<string, string>) => void }) => void;
const gauge = vi.hoisted(() => ({ callback: undefined as GaugeCallback | undefined }));

vi.mock('../../telemetry', () => ({
  getMeter: () => ({
    createObservableGauge: () => ({ addCallback: (callback: GaugeCallback) => (gauge.callback = callback) }),
  }),
}));
vi.mock('../../config', () => ({
  BOT_CONFIG: { token: 'bot-token' },
  getApplicationId: () => 'app-1',
}));
vi.mock('../../logger', () => ({ createLogger: () => ({ warn: vi.fn() }) }));

import { checkOauthRedirects } from '../../oauthRedirectMonitor';

const callbacks = {
  production: {
    discord: 'https://nadeshiko.co/v1/auth/callback/discord',
    google: 'https://nadeshiko.co/v1/auth/callback/google',
  },
  staging: {
    discord: 'https://stg.nadeshiko.co/v1/auth/callback/discord',
    google: 'https://stg.nadeshiko.co/v1/auth/callback/google',
  },
} as const;

function metricValues() {
  const values = new Map<string, number>();
  gauge.callback?.({ observe: (value, attrs) => values.set(`${attrs.provider}:${attrs.environment}`, value) });
  return values;
}

beforeEach(() => vi.restoreAllMocks());

describe('OAuth redirect monitoring', () => {
  test('reports each provider and environment independently', async () => {
    const fetchFn = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url.includes('/oauth2/applications/@me')) {
        return Response.json({ id: 'app-1', redirect_uris: [callbacks.production.discord] });
      }
      if (url.includes('/sign-in/social')) {
        const environment = url.includes('api-stg') ? 'staging' : 'production';
        const provider = JSON.parse(init?.body as string).provider as 'discord' | 'google';
        const callback = callbacks[environment][provider];
        return Response.json({
          url: `${provider === 'google' ? 'https://accounts.google.com/o/oauth2/v2/auth' : 'https://discord.com/oauth2/authorize'}?client_id=app-1&redirect_uri=${encodeURIComponent(callback)}`,
        });
      }
      const callback = new URL(url).searchParams.get('redirect_uri');
      const valid = callback === callbacks.production.google;
      return new Response('', {
        status: 302,
        headers: {
          location: valid
            ? 'https://accounts.google.com/v3/signin/identifier'
            : 'https://accounts.google.com/signin/oauth/error',
        },
      });
    });

    await checkOauthRedirects(fetchFn as typeof fetch);

    expect(metricValues()).toEqual(
      new Map([
        ['discord:production', 1],
        ['discord:staging', 0],
        ['google:production', 1],
        ['google:staging', 0],
      ]),
    );
  });

  test('turns every Discord result unhealthy when application metadata cannot be read', async () => {
    const fetchFn = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url.includes('/oauth2/applications/@me')) return new Response('', { status: 401 });
      const environment = url.includes('api-stg') ? 'staging' : 'production';
      const provider = JSON.parse(init?.body as string).provider as 'discord' | 'google';
      const callback = callbacks[environment][provider];
      if (url.includes('/sign-in/social')) {
        return Response.json({ url: `https://${provider}.example/auth?redirect_uri=${encodeURIComponent(callback)}` });
      }
      return new Response('', {
        status: 302,
        headers: { location: 'https://accounts.google.com/v3/signin/identifier' },
      });
    });

    await checkOauthRedirects(fetchFn as typeof fetch);

    expect(metricValues().get('discord:production')).toBe(0);
    expect(metricValues().get('discord:staging')).toBe(0);
  });
});
