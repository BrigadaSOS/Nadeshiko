import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  AttachmentBuilder,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
  type StringSelectMenuInteraction,
} from 'discord.js';
import { downloadFile, getSegmentContext } from './api';
import { buildSegmentMessage, getMediaName, formatTimestamp, stripAllHtmlTags, type DisplayOptions } from './embeds';
import { BOT_CONFIG } from './config';
import type { Segment, Media } from './api';

const CONTEXT_TAKE = 12;

function isNsfw(segment: Segment): boolean {
  return segment.contentRating === 'QUESTIONABLE' || segment.contentRating === 'EXPLICIT';
}

function buildVideoAttachment(videoBuffer: Buffer, segment: Segment): AttachmentBuilder {
  const prefix = isNsfw(segment) ? 'SPOILER_' : '';
  return new AttachmentBuilder(videoBuffer, { name: `${prefix}${segment.publicId}.mp4` });
}

export async function loadVideoFiles(segment: Segment): Promise<AttachmentBuilder[]> {
  const videoBuffer = await downloadFile(segment.urls.videoUrl);
  return videoBuffer ? [buildVideoAttachment(videoBuffer, segment)] : [];
}

type SegmentReplyOptions = {
  interaction: { editReply: ChatInputCommandInteraction['editReply'] };
  segment: Segment;
  media: Media | undefined;
  display: DisplayOptions;
  linkUrl: string;
  extraButtons?: ButtonBuilder[];
  contentPrefix?: string;
};

export async function renderSegmentReply({
  interaction,
  segment,
  media,
  display,
  linkUrl,
  extraButtons,
  contentPrefix,
}: SegmentReplyOptions) {
  const body = buildSegmentMessage(segment, media, display);
  const content = contentPrefix ? `${contentPrefix}\n\n${body}` : body;
  const row = buildSegmentButtons(linkUrl, extraButtons);
  const files = await loadVideoFiles(segment);

  return interaction.editReply({ content, components: [row], files });
}

export async function updateSegmentReply(
  btnInteraction: ButtonInteraction | StringSelectMenuInteraction,
  segment: Segment,
  media: Media | undefined,
  display: DisplayOptions,
  linkUrl: string,
  extraButtons?: ButtonBuilder[],
  contentPrefix?: string,
) {
  const body = buildSegmentMessage(segment, media, display);
  const content = contentPrefix ? `${contentPrefix}\n\n${body}` : body;
  const row = buildSegmentButtons(linkUrl, extraButtons);
  const files = await loadVideoFiles(segment);

  await btnInteraction.editReply({ content, components: [row], files });
}

const closeContextButton = new ButtonBuilder()
  .setCustomId('back_to_original')
  .setLabel('Close context')
  .setEmoji('✖')
  .setStyle(ButtonStyle.Secondary);

export type ContextState = {
  contextSegments: Segment[];
  contextMediaMap: Record<string, Media>;
  originalSegment: Segment | undefined;
  originalMedia: Media | undefined;
  viewingContext: boolean;
  contextExtraButtons: ButtonBuilder[];
};

export function createContextState(): ContextState {
  return {
    contextSegments: [],
    contextMediaMap: {},
    originalSegment: undefined,
    originalMedia: undefined,
    viewingContext: false,
    contextExtraButtons: [],
  };
}

export async function handleContextButton(
  btnInteraction: ButtonInteraction,
  segment: Segment,
  media: Media | undefined,
  display: DisplayOptions,
  state: ContextState,
  extraButtons?: ButtonBuilder[],
) {
  await btnInteraction.deferUpdate();

  state.originalSegment = segment;
  state.originalMedia = media;
  state.contextExtraButtons = [...(extraButtons ?? []), closeContextButton];

  const result = await getSegmentContext(segment.publicId, CONTEXT_TAKE);
  if (result.segments.length === 0) return;

  state.contextSegments = result.segments;
  state.contextMediaMap = result.includes.media ?? {};
  state.viewingContext = true;

  const resolvedMedia = media ?? state.contextMediaMap[segment.mediaPublicId];
  state.originalMedia = resolvedMedia;
  const mediaName = getMediaName(resolvedMedia);
  const header = `📜 **Context** for sentence in **${mediaName}** • Episode ${segment.episode}`;
  const body = buildSegmentMessage(segment, resolvedMedia, display);
  const components = buildContextSelectComponents(result.segments, segment.publicId, state.contextExtraButtons);
  const files = await loadVideoFiles(segment);
  const content = `${header}\n\n${body}`;

  await btnInteraction.editReply({ content, components, files });
}

export async function handleContextSelect(
  selectInteraction: StringSelectMenuInteraction,
  display: DisplayOptions,
  state: ContextState,
) {
  await selectInteraction.deferUpdate();

  const selectedId = selectInteraction.values[0];
  const segment = state.contextSegments.find((s) => s.publicId === selectedId);
  if (!segment) return;

  const media = state.contextMediaMap[segment.mediaPublicId];
  const originalMedia = state.originalMedia;
  const mediaName = originalMedia ? getMediaName(originalMedia) : 'Unknown';
  const header = `📜 **Context** for sentence in **${mediaName}** • Episode ${state.originalSegment?.episode ?? segment.episode}`;
  const body = buildSegmentMessage(segment, media, display);
  const components = buildContextSelectComponents(
    state.contextSegments,
    selectedId,
    state.contextExtraButtons,
    state.originalSegment?.publicId,
  );
  const files = await loadVideoFiles(segment);
  const content = `${header}\n\n${body}`;

  await selectInteraction.editReply({ content, components, files });
}

export async function handleBackToOriginal(
  btnInteraction: ButtonInteraction,
  display: DisplayOptions,
  state: ContextState,
  linkUrl: string,
  extraButtons?: ButtonBuilder[],
  contentPrefix?: string,
) {
  await btnInteraction.deferUpdate();
  state.viewingContext = false;

  if (!state.originalSegment) return;
  await updateSegmentReply(
    btnInteraction,
    state.originalSegment,
    state.originalMedia,
    display,
    linkUrl,
    extraButtons,
    contentPrefix,
  );
}

function buildContextSelectComponents(
  segments: Segment[],
  currentPublicId: string,
  extraButtons?: ButtonBuilder[],
  originalPublicId?: string,
): ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] = [];

  const originId = originalPublicId ?? currentPublicId;
  const originIndex = segments.findIndex((s) => s.publicId === originId);

  const options = segments.slice(0, 25).map((seg, i) => {
    const jaText = stripAllHtmlTags(seg.textJa.content);
    const diff = i - originIndex;
    const prefix = seg.publicId === originId ? '▶' : `${diff > 0 ? '+' : ''}${diff}`;
    const prefixedText = `${prefix}) ${jaText}`;
    const label = prefixedText.length > 100 ? `${prefixedText.slice(0, 97)}...` : prefixedText;
    const timestamp = formatTimestamp(seg.startTimeMs);
    return {
      label,
      value: seg.publicId,
      description: timestamp,
      default: seg.publicId === currentPublicId,
    };
  });

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('context_select')
    .setPlaceholder('Select a sentence...')
    .addOptions(options);

  rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu));

  const buttonRow = new ActionRowBuilder<ButtonBuilder>();
  if (extraButtons) {
    buttonRow.addComponents(...extraButtons);
  }
  buttonRow.addComponents(
    new ButtonBuilder()
      .setLabel('Search on Nadeshiko')
      .setStyle(ButtonStyle.Link)
      .setURL(`${BOT_CONFIG.frontendUrl}/sentence/${currentPublicId}`)
      .setEmoji({ id: '1488442092823777410' }),
  );
  rows.push(buttonRow);

  return rows;
}

export function buildSearchSelectComponents(
  segments: Segment[],
  mediaMap: Record<string, Media>,
  currentPublicId: string,
  linkUrl: string,
  extraButtons?: ButtonBuilder[],
  pageOffset = 0,
): ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] = [];

  const options = segments.slice(0, 25).map((seg, i) => {
    const num = pageOffset + i + 1;
    const jaText = stripAllHtmlTags(seg.textJa.content);
    const prefix = `${num}) `;
    const maxLabelLen = 100 - prefix.length;
    const truncatedJa = jaText.length > maxLabelLen ? `${jaText.slice(0, maxLabelLen - 3)}...` : jaText;
    const label = `${prefix}${truncatedJa}`;
    const media = mediaMap[seg.mediaPublicId];
    const mediaName = media?.nameRomaji || media?.nameEn || media?.nameJa || '';
    const timestamp = formatTimestamp(seg.startTimeMs);
    const description = mediaName ? `${mediaName} - Ep. ${seg.episode} - ${timestamp}` : timestamp;

    return {
      label,
      value: seg.publicId,
      description: description.slice(0, 100),
      default: seg.publicId === currentPublicId,
    };
  });

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('search_select')
    .setPlaceholder('Browse results...')
    .addOptions(options);

  rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu));

  const allButtons = [
    ...(extraButtons ?? []),
    new ButtonBuilder().setCustomId('context').setLabel('Context').setStyle(ButtonStyle.Secondary).setEmoji('📜'),
    new ButtonBuilder()
      .setLabel('Search on Nadeshiko')
      .setStyle(ButtonStyle.Link)
      .setURL(linkUrl)
      .setEmoji({ id: '1488442092823777410' }),
  ];

  for (let i = 0; i < allButtons.length && rows.length < 5; i += 5) {
    const chunk = allButtons.slice(i, i + 5);
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(...chunk));
  }

  return rows;
}

export function buildSegmentButtons(linkUrl: string, extraButtons?: ButtonBuilder[]): ActionRowBuilder<ButtonBuilder> {
  const row = new ActionRowBuilder<ButtonBuilder>();

  if (extraButtons) {
    row.addComponents(...extraButtons);
  }

  row.addComponents(
    new ButtonBuilder().setCustomId('context').setLabel('Context').setStyle(ButtonStyle.Secondary).setEmoji('📜'),
    new ButtonBuilder()
      .setLabel('Search on Nadeshiko')
      .setStyle(ButtonStyle.Link)
      .setURL(linkUrl)
      .setEmoji({ id: '1488442092823777410' }),
  );

  return row;
}

export function buildLinkOnlyRow(url: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setLabel('Search on Nadeshiko')
      .setStyle(ButtonStyle.Link)
      .setURL(url)
      .setEmoji({ id: '1488442092823777410' }),
  );
}
