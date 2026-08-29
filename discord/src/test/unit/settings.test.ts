import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { initSettings, getGuildSettings, setGuildSetting, resetGuildSettings } from '../../settings';

/**
 * Run against a real SQLite file rather than a stub. The interesting behaviour
 * here IS the SQL: the upsert, the DEFAULT on the column, and the fact that
 * `setGuildSetting` interpolates its key straight into the statement. A mocked
 * `better-sqlite3` would assert that we called the code we wrote, which is not
 * the same as asserting it stores anything.
 */
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nadeshiko-settings-'));
  initSettings(join(dir, 'nested', 'settings.db'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('initSettings', () => {
  test('creates the directory the database lives in', () => {
    // The bot's data directory does not exist on a fresh container. Without the
    // mkdir the very first start crashes before it ever logs in.
    expect(existsSync(join(dir, 'nested', 'settings.db'))).toBe(true);
  });

  test('is safe to run against an existing database', () => {
    setGuildSetting('guild-1', 'language', 'es');

    initSettings(join(dir, 'nested', 'settings.db'));

    expect(getGuildSettings('guild-1').language).toBe('es');
  });
});

describe('getGuildSettings', () => {
  test('defaults to showing both translations', () => {
    expect(getGuildSettings('guild-unknown')).toEqual({ language: 'both' });
  });

  test('returns defaults in a DM, where there is no guild to look up', () => {
    // `interaction.guildId` is null in DMs and in user-installed contexts. A
    // lookup with a null key would throw and take the whole command with it.
    expect(getGuildSettings(null)).toEqual({ language: 'both' });
  });

  test('hands back a fresh copy, so a caller cannot mutate the shared defaults', () => {
    const first = getGuildSettings('guild-unknown');
    first.language = 'none';

    expect(getGuildSettings('guild-other').language).toBe('both');
  });
});

describe('setGuildSetting', () => {
  test('stores a value for a guild that has no row yet', () => {
    setGuildSetting('guild-1', 'language', 'en');

    expect(getGuildSettings('guild-1').language).toBe('en');
  });

  test('updates an existing row instead of failing on the primary key', () => {
    // The ON CONFLICT clause is the whole point: a plain INSERT would throw
    // `UNIQUE constraint failed` the second time a server changed a setting.
    setGuildSetting('guild-1', 'language', 'en');
    setGuildSetting('guild-1', 'language', 'es');

    expect(getGuildSettings('guild-1').language).toBe('es');
  });

  test('keeps guilds independent', () => {
    setGuildSetting('guild-1', 'language', 'en');
    setGuildSetting('guild-2', 'language', 'none');

    expect(getGuildSettings('guild-1').language).toBe('en');
    expect(getGuildSettings('guild-2').language).toBe('none');
  });

  test.each(['en', 'es', 'both', 'none'] as const)('round-trips %s', (language) => {
    setGuildSetting('guild-1', 'language', language);

    expect(getGuildSettings('guild-1').language).toBe(language);
  });
});

describe('resetGuildSettings', () => {
  test('returns the guild to defaults', () => {
    setGuildSetting('guild-1', 'language', 'none');

    resetGuildSettings('guild-1');

    expect(getGuildSettings('guild-1')).toEqual({ language: 'both' });
  });

  test('is a no-op for a guild that never had settings', () => {
    expect(() => resetGuildSettings('guild-never')).not.toThrow();
  });

  test('does not touch other guilds', () => {
    setGuildSetting('guild-1', 'language', 'en');
    setGuildSetting('guild-2', 'language', 'es');

    resetGuildSettings('guild-1');

    expect(getGuildSettings('guild-2').language).toBe('es');
  });
});

describe('persistence across restarts', () => {
  test('settings survive re-opening the database file', () => {
    // A server configures the bot once; a redeploy must not silently reset
    // every guild back to defaults.
    const dbPath = join(dir, 'restart.db');
    initSettings(dbPath);
    setGuildSetting('guild-1', 'language', 'es');

    initSettings(dbPath);

    expect(getGuildSettings('guild-1').language).toBe('es');
  });
});
