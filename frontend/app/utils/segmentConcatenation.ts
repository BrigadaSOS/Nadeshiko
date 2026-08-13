import type { SearchResult, Segment } from '~/types/search';

/** Which side(s) of a segment the reader asked to pull in. */
export type ExpandDirection = 'forward' | 'backward' | 'both';

/** The sides a direction wants, so the rest of the module never re-reads the name. */
const SIDES: Record<ExpandDirection, { before: boolean; after: boolean }> = {
  backward: { before: true, after: false },
  forward: { before: false, after: true },
  both: { before: true, after: true },
};

export type ExpandedTexts = Pick<Segment, 'textJa' | 'textEn' | 'textEs'>;

export interface NeighbourPick {
  before: SearchResult | null;
  after: SearchResult | null;
  /**
   * Sides the direction asked for that the episode does not have -- the segment
   * sits at a boundary. Callers report this to the reader instead of returning
   * silently, which is what made "expand left does nothing" look like a dead
   * button rather than the end of the episode.
   */
  missing: Array<'before' | 'after'>;
}

/**
 * Locate the segment inside its own context response and take the neighbours the
 * direction asks for.
 *
 * Returns `null` only when the response does not contain the segment at all,
 * which means the two disagree about what is being expanded and nothing about
 * the response can be trusted.
 */
export function pickNeighbours(
  segments: SearchResult[],
  publicId: string,
  direction: ExpandDirection,
): NeighbourPick | null {
  const currentIdx = segments.findIndex((s) => s.segment.publicId === publicId);
  if (currentIdx === -1) return null;

  const wants = SIDES[direction];
  const before = wants.before ? (segments[currentIdx - 1] ?? null) : null;
  const after = wants.after ? (segments[currentIdx + 1] ?? null) : null;

  const missing: Array<'before' | 'after'> = [];
  if (wants.before && !before) missing.push('before');
  if (wants.after && !after) missing.push('after');

  return { before, after, missing };
}

/**
 * The shape the three language fields share. Japanese carries `tokens` and the
 * translations carry `isMachineTranslated`, so only these two are common.
 */
type TextFieldBase = { content: string; highlight?: string };

/**
 * Join one language's text across the segments being merged, marking the pulled-in
 * neighbours so the reader can see which half was theirs.
 *
 * A missing side is dropped rather than joined as an empty string: "expand both"
 * one segment away from the end of an episode used to emit `<span></span>` and a
 * stray leading space around text that had not actually grown.
 */
function concatLangField<T extends TextFieldBase>(current: T, before: T | undefined, after: T | undefined): T {
  const wrap = (text: string) => `<span class="text-cyan-200">${text}</span>`;
  const join = (parts: Array<string | null>) => parts.filter((part): part is string => !!part).join(' ');

  const contentOf = (field: T | undefined) => field?.content || '';
  const highlightOf = (field: T | undefined) => field?.highlight || contentOf(field);

  const merged = {
    ...current,
    content: join([before ? wrap(contentOf(before)) : null, contentOf(current), after ? wrap(contentOf(after)) : null]),
    highlight: join([
      before ? wrap(highlightOf(before)) : null,
      highlightOf(current),
      after ? wrap(highlightOf(after)) : null,
    ]),
  };

  // Concatenated text has no token mapping: the tokens describe offsets into the
  // original sentence, so keeping them would furigana-annotate the wrong words.
  // The SDK types `tokens` as always present, but every reader of it guards on
  // emptiness first, which is the contract this relies on.
  if ('tokens' in merged) {
    (merged as { tokens: unknown }).tokens = null;
  }

  return merged;
}

/** Build the merged text for all three languages at once. */
export function buildExpandedTexts(
  segment: Segment,
  before: SearchResult | null,
  after: SearchResult | null,
): ExpandedTexts {
  return {
    textJa: concatLangField(segment.textJa, before?.segment.textJa, after?.segment.textJa),
    textEn: concatLangField(segment.textEn, before?.segment.textEn, after?.segment.textEn),
    textEs: concatLangField(segment.textEs, before?.segment.textEs, after?.segment.textEs),
  };
}

/** The audio objects to concatenate, in playback order. */
export function orderAudioUrls(segment: Segment, before: SearchResult | null, after: SearchResult | null): string[] {
  return [before?.segment.urls.audioUrl, segment.urls.audioUrl, after?.segment.urls.audioUrl].filter(
    (url): url is string => !!url,
  );
}
