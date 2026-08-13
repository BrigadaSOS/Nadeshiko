import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { createLogger } from './logger';

const log = createLogger('settings');

export type Language = 'en' | 'es' | 'both' | 'none';

export type GuildSettings = {
  language: Language;
};

const DEFAULTS: GuildSettings = {
  language: 'both',
};

let db: Database.Database;

export function initSettings(dbPath = 'data/settings.db') {
  mkdirSync(dirname(dbPath), { recursive: true });
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  // `auto_embed` is not dropped from existing databases. It is NOT NULL with a
  // default, so leaving it costs one unread integer per guild, while an ALTER
  // TABLE DROP COLUMN on a live SQLite file buys a migration path for nothing.
  // New databases simply never get the column.
  db.exec(`
    CREATE TABLE IF NOT EXISTS guild_settings (
      guild_id TEXT PRIMARY KEY,
      language TEXT NOT NULL DEFAULT 'both'
    )
  `);
  log.info({ dbPath }, 'Settings database initialized');
}

export function getGuildSettings(guildId: string | null): GuildSettings {
  if (!guildId) {
    log.debug('No guildId, returning defaults');
    return { ...DEFAULTS };
  }

  const row = db.prepare('SELECT language FROM guild_settings WHERE guild_id = ?').get(guildId) as {
    language: Language;
  } | null;

  if (!row) {
    log.debug({ guildId }, 'No settings found, returning defaults');
    return { ...DEFAULTS };
  }

  const settings = { language: row.language };
  log.debug({ guildId, settings }, 'Loaded guild settings');
  return settings;
}

export function setGuildSetting<K extends keyof GuildSettings>(guildId: string, key: K, value: GuildSettings[K]) {
  db.prepare(
    `INSERT INTO guild_settings (guild_id, ${key}) VALUES (?, ?)
     ON CONFLICT(guild_id) DO UPDATE SET ${key} = excluded.${key}`,
  ).run(guildId, value);

  log.info({ guildId, key, value }, 'Setting updated');
}

export function resetGuildSettings(guildId: string) {
  db.prepare('DELETE FROM guild_settings WHERE guild_id = ?').run(guildId);
  log.info({ guildId }, 'Settings reset to defaults');
}
