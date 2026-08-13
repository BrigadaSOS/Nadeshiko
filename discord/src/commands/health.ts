import { SlashCommandBuilder, EmbedBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { BOT_CONFIG } from '../config';
import { homeUrl, searchUrl } from '../links';
import { createLogger } from '../logger';
import { getActiveTraceId } from '../instrumentation';

const log = createLogger('cmd:health');

const STATUS_PAGE = 'https://status.nadeshiko.co';

export const data = new SlashCommandBuilder().setName('health').setDescription('Check Nadeshiko system status');

async function checkEndpoint(url: string): Promise<{ ok: boolean; latency: number; status?: number }> {
  const start = performance.now();
  try {
    const response = await fetch(url);
    return { ok: response.ok, latency: Math.round(performance.now() - start), status: response.status };
  } catch {
    return { ok: false, latency: Math.round(performance.now() - start) };
  }
}

export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();

  const wsPing = interaction.client.ws.ping;

  try {
    // `attribution: false` because these are the bot's own probes, not links
    // anyone clicked. Tagged as user traffic they would land in PostHog as
    // Discord-referred pageviews once per /health, inventing exactly the
    // click-through the UTM scheme exists to measure honestly.
    const [api, homepage, searchPage] = await Promise.all([
      checkEndpoint(`${BOT_CONFIG.apiBaseUrl}/up`),
      checkEndpoint(homeUrl({ attribution: false })),
      checkEndpoint(searchUrl({}, { attribution: false })),
    ]);

    const allUp = api.ok && homepage.ok && searchPage.ok;
    const statusEmoji = allUp ? '🟢' : '🔴';
    const statusLabel = allUp ? 'healthy' : 'degraded';

    function formatStatus(check: { ok: boolean; latency: number; status?: number }) {
      return check.ok
        ? `🟢 **online** (${check.latency}ms)`
        : `🔴 **down**${check.status ? ` (HTTP ${check.status})` : ''}`;
    }

    const embed = new EmbedBuilder()
      .setColor(allUp ? 0x22c55e : 0xeab308)
      .setTitle(`${statusEmoji} Nadeshiko Status: ${statusLabel}`)
      .setURL(STATUS_PAGE)
      .addFields(
        {
          name: 'Discord Bot',
          value: wsPing >= 0 ? `🟢 **online** (${wsPing}ms)` : `🟡 **starting** (ping unavailable)`,
          inline: false,
        },
        {
          name: 'Homepage',
          value: formatStatus(homepage),
          inline: false,
        },
        {
          name: 'Search',
          value: formatStatus(searchPage),
          inline: false,
        },
        {
          name: 'Backend API',
          value: formatStatus(api),
          inline: false,
        },
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    const traceId = getActiveTraceId();
    log.error({ err: error, traceId }, 'Health command failed');

    const embed = new EmbedBuilder()
      .setColor(0xef4444)
      .setTitle('🔴 Nadeshiko Status: unreachable')
      .setURL(STATUS_PAGE)
      .addFields(
        {
          name: 'Discord Bot',
          value: wsPing >= 0 ? `🟢 **online** (${wsPing}ms)` : `🟡 **starting** (ping unavailable)`,
          inline: false,
        },
        {
          name: 'Backend API',
          value: 'Could not reach the backend API.',
          inline: false,
        },
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  }
}
