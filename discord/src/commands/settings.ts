import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ChatInputCommandInteraction,
  type StringSelectMenuInteraction,
  type ButtonInteraction,
} from 'discord.js';
import { getGuildSettings, setGuildSetting, resetGuildSettings, type Language, type GuildSettings } from '../settings';
import { BOT_CONFIG } from '../config';
import { createLogger } from '../logger';
import { getActiveTraceId } from '../instrumentation';

const log = createLogger('cmd:settings');

const LANGUAGE_OPTIONS: { label: string; emoji: string; value: Language }[] = [
  { label: 'Show English translation', emoji: '🇬🇧', value: 'en' },
  { label: 'Show Spanish translation', emoji: '🇪🇸', value: 'es' },
  { label: 'Show Both', emoji: '🌐', value: 'both' },
  { label: 'Show None', emoji: '🇯🇵', value: 'none' },
];

export const data = new SlashCommandBuilder()
  .setName('settings')
  .setDescription('Configure Nadeshiko for this server')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

export async function execute(interaction: ChatInputCommandInteraction) {
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
    return;
  }

  try {
    const settings = getGuildSettings(guildId);

    const reply = await interaction.reply({ ...buildSettingsView(settings), ephemeral: true, fetchReply: true });

    const collector = reply.createMessageComponentCollector({ time: 600_000 });

    collector.on('collect', async (i: StringSelectMenuInteraction | ButtonInteraction) => {
      if (i.isStringSelectMenu() && i.customId === 'settings_pick') {
        const selected = i.values[0];

        if (selected === 'language') {
          await i.update(buildLanguagePicker(getGuildSettings(guildId)));
          return;
        }

        if (selected === 'autoembed') {
          const current = getGuildSettings(guildId);
          setGuildSetting(guildId, 'autoEmbed', !current.autoEmbed);
          await i.update(buildSettingsView(getGuildSettings(guildId)));
          return;
        }

        if (selected === 'reset') {
          resetGuildSettings(guildId);
          await i.update(buildSettingsView(getGuildSettings(guildId)));
          return;
        }
      }

      if (i.isStringSelectMenu() && i.customId === 'settings_language') {
        const value = i.values[0] as Language;
        setGuildSetting(guildId, 'language', value);
        await i.update(buildSettingsView(getGuildSettings(guildId)));
        return;
      }

      if (i.isButton() && i.customId === 'settings_back') {
        await i.update(buildSettingsView(getGuildSettings(guildId)));
      }
    });
  } catch (error) {
    const traceId = getActiveTraceId();
    log.error({ err: error, traceId }, 'Settings command failed');
    const suffix = traceId ? ` (trace: ${traceId})` : '';
    await interaction.reply({ content: `Something went wrong.${suffix}`, ephemeral: true });
  }
}

function languageLabel(settings: GuildSettings): string {
  const opt = LANGUAGE_OPTIONS.find((o) => o.value === settings.language);
  return opt ? `${opt.emoji} ${opt.label}` : settings.language;
}

function buildSettingsView(settings: GuildSettings) {
  const embed = new EmbedBuilder()
    .setColor(BOT_CONFIG.embedColor)
    .setTitle('Nadeshiko Settings')
    .addFields(
      { name: 'Translation language', value: languageLabel(settings), inline: true },
      { name: 'Auto-embed links', value: settings.autoEmbed ? 'On' : 'Off', inline: true },
    )
    .setFooter({ text: 'Select an option below to change a setting' });

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('settings_pick')
    .setPlaceholder('Change a setting...')
    .addOptions(
      { label: 'Language', description: `Currently: ${languageLabel(settings)}`, value: 'language', emoji: '🌐' },
      {
        label: `Auto-embed: ${settings.autoEmbed ? 'On' : 'Off'}`,
        description: settings.autoEmbed
          ? 'Click to stop replying to nadeshiko.co links'
          : 'Click to auto-reply when someone shares a nadeshiko.co link',
        value: 'autoembed',
        emoji: '🔗',
      },
      { label: 'Reset to defaults', description: 'Reset all settings to default values', value: 'reset', emoji: '🔄' },
    );

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

  return { content: '', embeds: [embed], components: [row] };
}

function buildLanguagePicker(settings: GuildSettings) {
  const embed = new EmbedBuilder()
    .setColor(BOT_CONFIG.embedColor)
    .setTitle('Translation Language')
    .setDescription('Which translations should Nadeshiko show alongside Japanese?');

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('settings_language')
    .setPlaceholder('Select language...')
    .addOptions(
      LANGUAGE_OPTIONS.map((opt) => ({
        label: opt.label,
        value: opt.value,
        emoji: opt.emoji,
        default: opt.value === settings.language,
      })),
    );

  const selectRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

  const backButton = new ButtonBuilder().setCustomId('settings_back').setLabel('Back').setStyle(ButtonStyle.Secondary);
  const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(backButton);

  return { content: '', embeds: [embed], components: [selectRow, buttonRow] };
}
