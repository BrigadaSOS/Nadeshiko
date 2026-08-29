import { EmbedBuilder } from 'discord.js';
import { BOT_CONFIG } from './config';
import { mediaSearchUrl, sentenceUrl, statsUrl } from './links';
import type { Segment, Media, StatsResponse } from './api';
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

const ELLIPSIS = '...';

/**
 * Cut `text` down to at most `max` characters, ellipsis included.
 *
 * The ellipsis has to come out of the budget, not be added on top of it. It was
 * added on top -- `slice(0, max - 1) + '...'` -- so a truncated string came back
 * `max + 2` characters long. Both callers pass 2000, which is exactly Discord's
 * limit on message content, so the one path that exists to keep a long sentence
 * under the limit was the path that pushed it over: the API rejects the message
 * and the command fails outright instead of showing a shortened reply.
 */
function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  // No room for the ellipsis itself: a hard cut is the only thing that fits.
  // Unreachable from either caller (both pass 2000), but it keeps the promise
  // in the name -- the result is never longer than `max`.
  if (max < ELLIPSIS.length) return text.slice(0, Math.max(0, max));
  return `${text.slice(0, max - ELLIPSIS.length)}${ELLIPSIS}`;
}

export function buildSegmentMessage(
  segment: Segment,
  media: Media | undefined,
  opts: DisplayOptions = DEFAULT_DISPLAY,
): string {
  const mediaName = getMediaName(media);
  const timestamp = formatTimestamp(segment.startTimeMs);

  const mediaLink = media ? `[${mediaName}](<${mediaSearchUrl(media.publicId)}>)` : mediaName;
  const episodeLink = media
    ? `[Episode ${segment.episode}](<${mediaSearchUrl(media.publicId, segment.episode)}>)`
    : `Episode ${segment.episode}`;
  const timestampLink = `[${timestamp}](<${sentenceUrl(segment.publicId)}>)`;

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

  // A language with no translations at all divides zero by zero, and `NaN%
  // human` is what the embed renders. That is not hypothetical: it is the state
  // every new locale is in on the day it is added.
  const humanShare = (human: number, total: number) => (total === 0 ? 0 : Math.round((human / total) * 100));

  return new EmbedBuilder()
    .setColor(BOT_CONFIG.embedColor)
    .setTitle('Nadeshiko in Numbers')
    .setURL(statsUrl())
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
          `EN: **${enTotal.toLocaleString()}** (${humanShare(translations.enHuman, enTotal)}% human)`,
          `ES: **${esTotal.toLocaleString()}** (${humanShare(translations.esHuman, esTotal)}% human)`,
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
