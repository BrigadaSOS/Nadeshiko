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
