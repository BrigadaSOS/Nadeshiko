/**
 * The community links the site hands out, defined once.
 *
 * The Discord invite lives here because it went dead and nobody noticed. It was
 * hardcoded at fifteen call sites across the frontend, the bot and the docs, so
 * there was nothing any check could assert on and no way to rotate it except a
 * find-and-replace -- which is how the replacement itself got mangled into a
 * second dead link. One constant is what makes both problems go away.
 *
 * `discord.gg/<code>` cannot be watched with an ordinary link checker. It
 * answers 200 for every code, live or revoked, and renders "invite invalid"
 * client-side, so lychee or a HEAD sweep reports a dead invite as healthy. The
 * only honest check is the invite API, which returns the guild when the code
 * resolves and 404 when it does not:
 *
 *   GET https://discord.com/api/v10/invites/<code>
 *
 * That runs continuously as the `Discord Invite` endpoint in Gatus (infra repo,
 * machines/monitoring/gatus), asserting both the status and DISCORD_GUILD_ID --
 * a code that resolves to somebody else's server is a failure too, not a pass.
 *
 * ROTATING THE INVITE: change DISCORD_INVITE_CODE here, run the frontend tests,
 * and fix whatever `socialLinks.sync.test.ts` names -- it knows about the copies
 * this file cannot import (markdown content, the bot, CONTRIBUTING, Gatus).
 * Create the new invite as **never expire**: Discord's default is 7 days, which
 * is the quiet way this dies again.
 */
export const DISCORD_INVITE_CODE = 'qRak9MprUS';

/** The guild the invite must resolve to. Asserted by the Gatus check. */
export const DISCORD_GUILD_ID = '1483540629676884031';

export const DISCORD_INVITE_URL = `https://discord.gg/${DISCORD_INVITE_CODE}`;

/**
 * Where readers are asked to support the project.
 *
 * Here for the same reason the invite is: it was hardcoded at the one call site
 * that needed it, and the moment a second surface wanted it -- the empty-results
 * state, which asks for support exactly where the corpus fell short -- there was
 * nothing to import. Unlike the Discord invite this one is a stable vanity URL
 * rather than a rotating code, so `socialLinks.sync.test.ts` does not police it;
 * it lives here to keep one answer to "which link do we hand out", not because
 * it is expected to change.
 */
export const PATREON_URL = 'https://patreon.com/BrigadaSOS';

/**
 * The Discord application the bot runs as. Public -- it is in the install URL
 * every visitor is handed, and in the bot's own profile.
 */
export const DISCORD_BOT_CLIENT_ID = '1064964424684806184';

/**
 * Where a reader is sent to install the bot.
 *
 * Deliberately bare: no `scope`, no `permissions`. With both installation
 * contexts enabled on the application, Discord answers this URL with a chooser
 * -- add it to a server, or add it to your own apps -- and picks the right
 * scopes for whichever the reader takes. Pinning `scope=bot` here would silently
 * collapse that back to the server-only path, which is the gate we are trying to
 * remove: most people who want the bot are not admins of the servers they are in.
 *
 * The admin-facing URL that names the exact permissions lives in the bot
 * (`discord/src/links.ts`), which is where the permission set is defined.
 */
export const DISCORD_BOT_INSTALL_URL = `https://discord.com/oauth2/authorize?client_id=${DISCORD_BOT_CLIENT_ID}`;
