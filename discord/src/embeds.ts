import { EmbedBuilder } from 'discord.js';
import { BOT_CONFIG } from './config';
import type { Segment, Media, SearchResponse, ContextResponse, StatsResponse } from './api';

function formatTimestamp(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function stripAllHtmlTags(text: string): string {
  return text.replace(/<[^>]+>/g, '');
}

function highlightToMarkdown(text: string): string {
  let result = text.replace(/<em>/g, '**').replace(/<\/em>/g, '**');
  result = result.replace(/<[^>]+>/g, '');
  return result;
}

function getMediaName(media?: Media): string {
  if (!media) return 'Unknown';
  return media.nameRomaji || media.nameEn || media.nameJa || 'Unknown';
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}...`;
}

function mediaUrl(media: Media): string {
  return `${BOT_CONFIG.frontendUrl}/media/${media.slug || media.publicId}`;
}

function segmentUrl(publicId: string): string {
  return `${BOT_CONFIG.frontendUrl}/sentence/${publicId}`;
}

export function buildSegmentMessage(segment: Segment, media: Media | undefined): string {
  const mediaName = getMediaName(media);
  const timestamp = formatTimestamp(segment.startTimeMs);

  const mediaLink = media ? `[${mediaName}](<${mediaUrl(media)}>)` : mediaName;
  const episodeLink = media ? `[Episode ${segment.episode}](<${mediaUrl(media)}>)` : `Episode ${segment.episode}`;

  const jaText = segment.textJa.highlight ? highlightToMarkdown(segment.textJa.highlight) : segment.textJa.content;

  const lines: string[] = [`**JP**: ${jaText}`];

  if (segment.textEn.content) {
    const mtTag = segment.textEn.isMachineTranslated ? ' (MT)' : '';
    lines.push(`**EN${mtTag}**: ||${segment.textEn.content}||`);
  }

  if (segment.textEs.content) {
    const mtTag = segment.textEs.isMachineTranslated ? ' (MT)' : '';
    lines.push(`**ES${mtTag}**: ||${segment.textEs.content}||`);
  }

  lines.push('', `${mediaLink} • ${episodeLink} • ${timestamp} | [Open](<${segmentUrl(segment.publicId)}>)`);

  return truncate(lines.join('\n'), 2000);
}

export function buildSearchResultMessages(response: SearchResponse, query: string): string[] {
  const { segments, includes, pagination } = response;

  const searchUrl = `${BOT_CONFIG.frontendUrl}/search/${encodeURIComponent(query)}`;

  if (segments.length === 0) {
    return [`No results found for **${truncate(query, 200)}** — [Search on Nadeshiko](<${searchUrl}>)`];
  }

  const header = `**Search: ${truncate(query, 200)}** — ~${pagination.estimatedTotalHits.toLocaleString()} results | [Open in Nadeshiko](<${searchUrl}>)\n`;

  const segmentLines = segments.map((segment, i) => {
    const media = includes.media[segment.mediaPublicId];
    const mediaName = getMediaName(media);
    const timestamp = formatTimestamp(segment.startTimeMs);

    const mediaLink = media ? `[${mediaName}](<${mediaUrl(media)}>)` : mediaName;

    const jaText = segment.textJa.highlight ? highlightToMarkdown(segment.textJa.highlight) : segment.textJa.content;

    const enText = segment.textEn.content ? ` — ||${segment.textEn.content}||` : '';

    return (
      `**${i + 1}.** ${truncate(jaText, 150)}${truncate(enText, 100)}\n` +
      `> ${mediaLink} • Ep. ${segment.episode} • ${timestamp} | [Open](<${segmentUrl(segment.publicId)}>)`
    );
  });

  return [header + segmentLines.join('\n\n')];
}

export function buildContextMessage(response: ContextResponse, targetPublicId: string): string {
  const { segments, includes } = response;

  if (segments.length === 0) return 'No context segments found.';

  const firstMedia = Object.values(includes.media ?? {})[0];
  const mediaName = getMediaName(firstMedia);
  const ep = segments[0]?.episode;

  const lines = segments.map((seg) => {
    const isTarget = seg.publicId === targetPublicId;
    const timestamp = formatTimestamp(seg.startTimeMs);
    const jaText = stripAllHtmlTags(seg.textJa.content);
    const enText = seg.textEn.content;

    const jaLine = isTarget ? `**> ${jaText}**` : jaText;
    const enLine = enText ? `  ${isTarget ? `**${enText}**` : `*${enText}*`}` : '';

    return `\`${timestamp}\` ${jaLine}${enLine ? `\n${' '.repeat(8)}${enLine}` : ''}`;
  });

  const header = `**Context: ${mediaName}** — Episode ${ep}\n`;
  return truncate(header + lines.join('\n'), 2000);
}

export function buildStatsEmbed(stats: StatsResponse): EmbedBuilder {
  const tierLines = stats.tiers
    .filter((t) => t.tier <= 20000)
    .map((t) => {
      const bar = buildProgressBar(t.percentage, 10);
      return `Top ${t.tier.toLocaleString()}: ${bar} ${t.percentage}% (${t.covered.toLocaleString()}/${t.total.toLocaleString()})`;
    })
    .join('\n');

  const { translations } = stats;
  const enTotal = translations.enHuman + translations.enMachine;
  const esTotal = translations.esHuman + translations.esMachine;

  return new EmbedBuilder()
    .setColor(BOT_CONFIG.embedColor)
    .setTitle('Nadeshiko Corpus Statistics')
    .addFields(
      {
        name: 'Corpus',
        value: [
          `**${stats.totalSegments.toLocaleString()}** segments`,
          `**${stats.totalMedia.toLocaleString()}** anime/drama`,
          `**${stats.totalEpisodes.toLocaleString()}** episodes`,
          `**${stats.dialogueHours}** hours of dialogue`,
        ].join('\n'),
        inline: true,
      },
      {
        name: 'Translations',
        value: [
          `EN: **${enTotal.toLocaleString()}** (${translations.enHuman.toLocaleString()} human)`,
          `ES: **${esTotal.toLocaleString()}** (${translations.esHuman.toLocaleString()} human)`,
        ].join('\n'),
        inline: true,
      },
      {
        name: 'Word Coverage',
        value: `\`\`\`\n${tierLines}\n\`\`\``,
        inline: false,
      },
    )
    .setFooter({ text: 'nadeshiko.co' });
}

function buildProgressBar(percentage: number, length: number): string {
  const filled = Math.round((percentage / 100) * length);
  const empty = length - filled;
  return `${'█'.repeat(filled)}${'░'.repeat(empty)}`;
}
