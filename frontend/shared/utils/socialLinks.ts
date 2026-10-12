// Rotate with a never-expiring invite and update copies named by socialLinks.sync.test.ts. discord.gg returns 200
// even for revoked codes; Gatus must check the invite API and expected guild, not the landing page.
export const DISCORD_INVITE_CODE = 'qRak9MprUS';

/** The guild the invite must resolve to. Asserted by the Gatus check. */
export const DISCORD_GUILD_ID = '1483540629676884031';

export const DISCORD_INVITE_URL = `https://discord.gg/${DISCORD_INVITE_CODE}`;

export const PATREON_URL = 'https://patreon.com/BrigadaSOS';

export const DISCORD_BOT_CLIENT_ID = '1064964424684806184';

// Omit scope/permissions so Discord offers both server and user installation. Explicit scope=bot forces server-only.
// The admin-facing permission-specific URL lives in discord/src/links.ts.
export const DISCORD_BOT_INSTALL_URL = `https://discord.com/oauth2/authorize?client_id=${DISCORD_BOT_CLIENT_ID}`;
