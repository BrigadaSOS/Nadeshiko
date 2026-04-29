import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { createLogger } from './logger';

const log = createLogger('settings');

export type Language = 'en' | 'es' | 'both' | 'none';

export type GuildSettings = {
  language: Language;
  autoEmbed: boolean;
};

const DEFAULTS: GuildSettings = {
  language: 'both',
  autoEmbed: true,
};

let db: Database.Database;

export function initSettings(dbPath = 'data/settings.db') {
  mkdirSync(dirname(dbPath), { recursive: true });
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS guild_settings (
      guild_id TEXT PRIMARY KEY,
      language TEXT NOT NULL DEFAULT 'both',
      auto_embed INTEGER NOT NULL DEFAULT 1
    )
  `);
  addColumnIfMissing('auto_embed', 'INTEGER NOT NULL DEFAULT 1');
  log.info({ dbPath }, 'Settings database initialized');
}

export function getGuildSettings(guildId: string | null): GuildSettings {
  if (!guildId) {
    log.debug('No guildId, returning defaults');
    return { ...DEFAULTS };
  }

  const row = db.prepare('SELECT language, auto_embed FROM guild_settings WHERE guild_id = ?').get(guildId) as {
    language: Language;
    auto_embed: number;
  } | null;

  if (!row) {
    log.debug({ guildId }, 'No settings found, returning defaults');
    return { ...DEFAULTS };
  }

  const settings = {
    language: row.language,
    autoEmbed: row.auto_embed === 1,
  };
  log.debug({ guildId, settings }, 'Loaded guild settings');
  return settings;
}

export function setGuildSetting<K extends keyof GuildSettings>(guildId: string, key: K, value: GuildSettings[K]) {
  const COLUMN_MAP: Record<string, string> = {
    autoEmbed: 'auto_embed',
  };
  const column = COLUMN_MAP[key] ?? key;
  const dbValue = typeof value === 'boolean' ? (value ? 1 : 0) : value;

  db.prepare(
    `INSERT INTO guild_settings (guild_id, ${column}) VALUES (?, ?)
     ON CONFLICT(guild_id) DO UPDATE SET ${column} = excluded.${column}`,
  ).run(guildId, dbValue);

  log.info({ guildId, key, value }, 'Setting updated');
}

function addColumnIfMissing(column: string, definition: string) {
  const columns = db.prepare("PRAGMA table_info('guild_settings')").all() as { name: string }[];
  if (!columns.some((c) => c.name === column)) {
    db.prepare(`ALTER TABLE guild_settings ADD COLUMN ${column} ${definition}`).run();
    log.info({ column }, 'Added missing column to guild_settings');
  }
}

export function resetGuildSettings(guildId: string) {
  db.prepare('DELETE FROM guild_settings WHERE guild_id = ?').run(guildId);
  log.info({ guildId }, 'Settings reset to defaults');
}
