import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * `BOT_CONFIG` is frozen at import time, so every case here re-imports the
 * module under a fresh environment. `vi.resetModules()` is what makes that
 * re-import actually re-run the file rather than hand back the cached object.
 *
 * What is being protected: `validateConfig` is the only thing standing between
 * a misconfigured deploy and a bot that starts, connects, and then answers
 * every command against `http://localhost:5000` -- up, green, and useless.
 */
const ORIGINAL_ENV = { ...process.env };

async function loadConfig(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return import('../../config');
}

/** The env a healthy production deploy has. Cases below remove one at a time. */
const COMPLETE_ENV = {
  DISCORD_BOT_TOKEN: 'token.part.part',
  DISCORD_API_KEY_MASTER: 'api-key',
  NADESHIKO_API_URL: 'https://api.nadeshiko.co',
  NADESHIKO_FRONTEND_URL: 'https://nadeshiko.co',
  NODE_ENV: 'production',
};

beforeEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key];
  }
  Object.assign(process.env, ORIGINAL_ENV);
});

afterEach(() => {
  vi.resetModules();
});

describe('BOT_CONFIG defaults', () => {
  test('falls back to a local backend and the production frontend', async () => {
    const { BOT_CONFIG } = await loadConfig({
      NADESHIKO_API_URL: undefined,
      NADESHIKO_FRONTEND_URL: undefined,
    });

    expect(BOT_CONFIG.apiBaseUrl).toBe('http://localhost:5000');
    expect(BOT_CONFIG.frontendUrl).toBe('https://nadeshiko.co');
  });

  test('secrets default to empty rather than undefined, so validateConfig can name them', async () => {
    const { BOT_CONFIG } = await loadConfig({
      DISCORD_BOT_TOKEN: undefined,
      DISCORD_API_KEY_MASTER: undefined,
    });

    expect(BOT_CONFIG.token).toBe('');
    expect(BOT_CONFIG.apiKey).toBe('');
  });

  test('reads the environment when it is set', async () => {
    const { BOT_CONFIG } = await loadConfig(COMPLETE_ENV);

    expect(BOT_CONFIG.apiBaseUrl).toBe('https://api.nadeshiko.co');
    expect(BOT_CONFIG.token).toBe('token.part.part');
  });
});

describe('validateConfig', () => {
  test('passes on a complete production environment', async () => {
    const { validateConfig } = await loadConfig(COMPLETE_ENV);

    expect(() => validateConfig()).not.toThrow();
  });

  test.each(['DISCORD_BOT_TOKEN', 'DISCORD_API_KEY_MASTER'])('requires %s even outside production', async (missing) => {
    const { validateConfig } = await loadConfig({ ...COMPLETE_ENV, NODE_ENV: 'development', [missing]: undefined });

    expect(() => validateConfig()).toThrow(missing);
  });

  test('names every missing variable at once, not just the first', async () => {
    // A deploy that fails four times in a row because each restart reveals one
    // more missing secret is the failure mode this guards.
    const { validateConfig } = await loadConfig({
      ...COMPLETE_ENV,
      DISCORD_BOT_TOKEN: undefined,
      DISCORD_API_KEY_MASTER: undefined,
    });

    expect(() => validateConfig()).toThrow(/DISCORD_BOT_TOKEN, DISCORD_API_KEY_MASTER/);
  });

  test.each(['NADESHIKO_API_URL', 'NADESHIKO_FRONTEND_URL'])('requires %s in production', async (missing) => {
    const { validateConfig } = await loadConfig({ ...COMPLETE_ENV, [missing]: undefined });

    expect(() => validateConfig()).toThrow(missing);
  });

  test.each(['NADESHIKO_API_URL', 'NADESHIKO_FRONTEND_URL'])(
    'lets %s fall back to its default outside production',
    async (unset) => {
      // Locally the default is right and demanding the variable would make a
      // fresh checkout refuse to start.
      const { validateConfig } = await loadConfig({ ...COMPLETE_ENV, NODE_ENV: 'development', [unset]: undefined });

      expect(() => validateConfig()).not.toThrow();
    },
  );

  test('rejects a URL that will not parse, naming which one', async () => {
    // `https//api` (a missing colon) is a real typo, and without this check it
    // survives startup and fails later as an opaque fetch error per command.
    const { validateConfig } = await loadConfig({ ...COMPLETE_ENV, NADESHIKO_API_URL: 'https//api.nadeshiko.co' });

    expect(() => validateConfig()).toThrow(/NADESHIKO_API_URL is not a valid URL/);
  });

  test('rejects an unparseable frontend URL too', async () => {
    const { validateConfig } = await loadConfig({ ...COMPLETE_ENV, NADESHIKO_FRONTEND_URL: 'not a url' });

    expect(() => validateConfig()).toThrow(/NADESHIKO_FRONTEND_URL is not a valid URL/);
  });
});

describe('getApplicationId', () => {
  test('derives the application id from the first token segment', async () => {
    // Discord bot tokens are `base64(applicationId).timestamp.hmac`.
    const applicationId = '1234567890';
    const encoded = Buffer.from(applicationId).toString('base64');
    const { getApplicationId } = await loadConfig({ ...COMPLETE_ENV, DISCORD_BOT_TOKEN: `${encoded}.ts.hmac` });

    expect(getApplicationId()).toBe(applicationId);
  });

  test('throws on a token whose first segment decodes to nothing', async () => {
    // An empty application id would be spliced into the install URL and produce
    // a link that 404s for every user who clicks it in /info.
    const { getApplicationId } = await loadConfig({ ...COMPLETE_ENV, DISCORD_BOT_TOKEN: '.ts.hmac' });

    expect(() => getApplicationId()).toThrow(/malformed/);
  });
});
