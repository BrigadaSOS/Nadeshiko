import { EmbedBuilder } from 'discord.js';
import { BOT_CONFIG } from './config';
import type { Segment, Media, StatsResponse, MediaAutocompleteItem } from './api';
import type { GuildSettings } from './settings';

export type DisplayOptions = Pick<GuildSettings, 'language'>;

const DEFAULT_DISPLAY: DisplayOptions = { language: 'both' };

function shouldShowEn(opts: DisplayOptions): boolean {
  return opts.language === 'en' || opts.language === 'both';
}

function shouldShowEs(opts: DisplayOptions): boolean {
  return opts.language === 'es' || opts.language === 'both';
}

export function formatTimestamp(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function stripAllHtmlTags(text: string): string {
  return text.replace(/<[^>]+>/g, '');
}

function highlightToMarkdown(text: string): string {
  let result = text.replace(/<em>/g, '**').replace(/<\/em>/g, '**');
  result = result.replace(/<[^>]+>/g, '');
  return result;
}

export function getMediaName(media?: {
  nameRomaji?: string | null;
  nameEn?: string | null;
  nameJa?: string | null;
}): string {
  if (!media) return 'Unknown';
  return media.nameRomaji || media.nameEn || media.nameJa || 'Unknown';
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}...`;
}

function mediaSearchUrl(media: { mediaPublicId: string }, episode?: number): string {
  const params = new URLSearchParams({ media: media.mediaPublicId });
  if (episode != null) params.set('episode', String(episode));
  return `${BOT_CONFIG.frontendUrl}/search?${params}`;
}

export function buildSegmentMessage(
  segment: Segment,
  media: Media | undefined,
  opts: DisplayOptions = DEFAULT_DISPLAY,
): string {
  const mediaName = getMediaName(media);
  const timestamp = formatTimestamp(segment.startTimeMs);

  const sentenceUrl = `${BOT_CONFIG.frontendUrl}/sentence/${segment.segmentPublicId}`;
  const mediaLink = media ? `[${mediaName}](<${mediaSearchUrl(media)}>)` : mediaName;
  const episodeLink = media
    ? `[Episode ${segment.episode}](<${mediaSearchUrl(media, segment.episode)}>)`
    : `Episode ${segment.episode}`;
  const timestampLink = `[${timestamp}](<${sentenceUrl}>)`;

  const jaText = segment.textJa.highlight ? highlightToMarkdown(segment.textJa.highlight) : segment.textJa.content;

  const lines: string[] = [`**JP**: ${jaText}`];

  if (segment.textEn.content && shouldShowEn(opts)) {
    const mtTag = segment.textEn.isMachineTranslated ? ' (MT)' : '';
    lines.push(`**EN${mtTag}**: ||${segment.textEn.content}||`);
  }

  if (segment.textEs.content && shouldShowEs(opts)) {
    const mtTag = segment.textEs.isMachineTranslated ? ' (MT)' : '';
    lines.push(`**ES${mtTag}**: ||${segment.textEs.content}||`);
  }

  lines.push('', `${mediaLink} • ${episodeLink} • ${timestampLink}`);

  return truncate(lines.join('\n'), 2000);
}

export function buildContextLines(
  segments: Segment[],
  mediaMap: Record<string, Media>,
  selectedIndex: number,
  opts: DisplayOptions = DEFAULT_DISPLAY,
): string {
  if (segments.length === 0) return 'No context segments found.';

  const firstMedia = Object.values(mediaMap)[0];
  const mediaName = getMediaName(firstMedia);
  const ep = segments[0]?.episode;

  const selectedSeg = segments[selectedIndex];
  const mediaLink = firstMedia ? `[${mediaName}](<${mediaSearchUrl(firstMedia)}>)` : mediaName;
  const timestamp = formatTimestamp(selectedSeg.startTimeMs);

  const lines = segments.map((seg, i) => {
    const isSelected = i === selectedIndex;
    const jaText = stripAllHtmlTags(seg.textJa.content);
    const diff = i - selectedIndex;
    const prefix = isSelected ? `▶)` : `${diff})`;

    const parts: string[] = [];
    parts.push(isSelected ? `${prefix} **${jaText}**` : `${prefix} ${jaText}`);

    if (seg.textEn.content && shouldShowEn(opts)) {
      const mtTag = seg.textEn.isMachineTranslated ? ' (MT)' : '';
      parts.push(`**EN${mtTag}**: ||${seg.textEn.content}||`);
    }

    if (seg.textEs.content && shouldShowEs(opts)) {
      const mtTag = seg.textEs.isMachineTranslated ? ' (MT)' : '';
      parts.push(`**ES${mtTag}**: ||${seg.textEs.content}||`);
    }

    return parts.join('\n');
  });

  const header = `**Context: ${mediaName}** -- Episode ${ep}\n`;
  const episodeLink = firstMedia ? `[Episode ${ep}](<${mediaSearchUrl(firstMedia, ep)}>)` : `Episode ${ep}`;
  const footer = `\n\n${mediaLink} • ${episodeLink} • ${timestamp}`;
  return truncate(header + lines.join('\n\n') + footer, 2000);
}

export function buildStatsEmbed(stats: StatsResponse): EmbedBuilder {
  const tierLines = stats.tiers
    .map((t) => {
      const bar = buildProgressBar(t.percentage, 10);
      const label = t.tier === 999999999 ? 'Full corpus (216k words)' : `Top ${t.tier.toLocaleString()}`;
      return `${label.padEnd(13)}: ${bar} ${t.percentage}% (${t.covered.toLocaleString()}/${t.total.toLocaleString()})`;
    })
    .join('\n');

  const { translations } = stats;
  const enTotal = translations.enHuman + translations.enMachine;
  const esTotal = translations.esHuman + translations.esMachine;

  return new EmbedBuilder()
    .setColor(BOT_CONFIG.embedColor)
    .setTitle('Nadeshiko in Numbers')
    .setURL(`${BOT_CONFIG.frontendUrl}/stats`)
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
          `EN: **${enTotal.toLocaleString()}** (${Math.round((translations.enHuman / enTotal) * 100)}% human)`,
          `ES: **${esTotal.toLocaleString()}** (${Math.round((translations.esHuman / esTotal) * 100)}% human)`,
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

export function buildMediaSearchMessage(media: MediaAutocompleteItem[], query: string): string {
  if (media.length === 0) {
    return `No media found for **${truncate(query, 200)}**`;
  }

  const header = `🔎 **Media matching "${truncate(query, 200)}":**\n\n`;
  const lines = media.map((m, i) => {
    const name = getMediaName(m);
    const jaName = m.nameJa && m.nameJa !== name ? ` (${m.nameJa})` : '';
    const link = mediaSearchUrl(m);
    return `**${i + 1}.** [${name}](<${link}>)${jaName}`;
  });

  return truncate(header + lines.join('\n'), 2000);
}

function buildProgressBar(percentage: number, length: number): string {
  const filled = Math.round((percentage / 100) * length);
  const empty = length - filled;
  return `${'█'.repeat(filled)}${'░'.repeat(empty)}`;
}
