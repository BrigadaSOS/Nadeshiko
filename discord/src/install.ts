import { ApplicationIntegrationType, InteractionContextType } from 'discord.js';

/**
 * Where each command can be installed and where it can be run, defined once.
 *
 * Every command used to be guild-install only -- the Discord default, and the
 * reason the only person who can add this bot is someone holding Manage Server.
 * That is the wrong gate for this audience. The people who want to look up a
 * line mid-conversation are learners sitting in somebody else's server, not its
 * admins, and asking them to go find an admin is the end of the funnel. A user
 * install attaches the command to the PERSON instead: it follows them into any
 * server, group DM or DM, needs no permissions, needs nothing approved by a
 * server owner, and does not require the bot to be a member anywhere.
 *
 * The split below is between commands that answer a question about the CORPUS
 * and commands that configure or inspect a SERVER. `/search` means the same
 * thing wherever it runs. `/settings` writes per-guild rows and `/health`
 * reports operator state; neither has an answer in a DM, so both stay where a
 * guild exists.
 *
 * Replies to a user-installed command in a server the bot is not in are
 * ephemeral -- Discord enforces that, it is not something the code chooses.
 * Nothing here has to change to accommodate it, but it does mean a user install
 * cannot produce the sharing-a-clip-with-the-channel behaviour a guild install
 * does. Both are worth having, which is why `anywhere` declares both.
 *
 * ONE MANUAL STEP: this is the command payload only. User installs must also be
 * switched on in the Developer Portal (Installation -> Installation Contexts ->
 * User Install) or Discord rejects `integration_types` when the commands are
 * registered.
 */

/**
 * Structural rather than `SharedSlashCommand`, so this module stays usable from
 * any builder discord.js grows without importing its class hierarchy.
 */
type Installable = {
  setIntegrationTypes(...types: ApplicationIntegrationType[]): unknown;
  setContexts(...contexts: InteractionContextType[]): unknown;
};

/** Installable by a server or by a person, and runnable in every context. */
export function anywhere<T extends Installable>(command: T): T {
  command.setIntegrationTypes(ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall);
  command.setContexts(
    InteractionContextType.Guild,
    InteractionContextType.BotDM,
    InteractionContextType.PrivateChannel,
  );
  return command;
}

/** Installable by a server only, and runnable only inside one. */
export function serverOnly<T extends Installable>(command: T): T {
  command.setIntegrationTypes(ApplicationIntegrationType.GuildInstall);
  command.setContexts(InteractionContextType.Guild);
  return command;
}
