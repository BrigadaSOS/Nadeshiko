import type { SearchResult, Segment } from '~/types/search';
import { EXPANDED_NEIGHBOUR_TAG } from './safeHighlight';

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

/** Which of the merged sentences a token came from. */
export type TokenOrigin = 'before' | 'current' | 'after';

/** What separates two merged sentences -- in the text and in the offsets alike. */
const JOIN = ' ';

type JaField = Segment['textJa'];
type JaToken = JaField['tokens'][number] & { origin?: TokenOrigin };

/** One sentence going into the Japanese merge, with the side it came from. */
type JaPiece = { field: JaField; origin: TokenOrigin };

/**
 * Rebase token and nested-part offsets by the preceding merged text length; both address the original
 * sentence's coordinates.
 */
function shiftTokens(tokens: readonly JaToken[], offset: number, origin: TokenOrigin): JaToken[] {
  return tokens.map((token) => ({
    ...token,
    origin,
    b: token.b + offset,
    e: token.e + offset,
    ...(token.parts ? { parts: token.parts.map((part) => ({ ...part, b: part.b + offset, e: part.e + offset })) } : {}),
  }));
}

/**
 * Preserve Japanese tokens against unwrapped content and highlights containing only `<em>`. Other markup
 * shifts offsets, corrupting ruby and Anki slices. Carry provenance on `origin`; return null if any piece
 * lacks tokens so callers can use the string fallback.
 */
function concatJapanese(current: JaField, pieces: JaPiece[]): JaField | null {
  if (pieces.some((piece) => !piece.field.tokens || piece.field.tokens.length === 0)) return null;

  const contents: string[] = [];
  const highlights: string[] = [];
  const tokens: JaToken[] = [];
  let offset = 0;

  for (const { field, origin } of pieces) {
    const content = field.content || '';
    contents.push(content);
    // Highlight and content are merged in lockstep so that stripping the `<em>`
    // marks out of the one still yields the other. That equivalence is what lets
    // the token offsets -- which are content offsets -- be compared against
    // ranges measured on the highlight.
    highlights.push(field.highlight || content);
    tokens.push(...shiftTokens(field.tokens as JaToken[], offset, origin));
    offset += content.length + JOIN.length;
  }

  return { ...current, content: contents.join(JOIN), highlight: highlights.join(JOIN), tokens };
}

/**
 * Join one language's text across the segments being merged, marking the pulled-in
 * neighbours so the reader can see which half was theirs.
 *
 * Only the highlight carries the mark (`EXPANDED_NEIGHBOUR_TAG`, which `safeHighlight`
 * lets through). The content stays plain text: it is copied to the clipboard and
 * rendered escaped under a spoiler, so any markup in it reaches the reader as literal
 * tags.
 *
 * A missing side is dropped rather than joined as an empty string: "expand both"
 * one segment away from the end of an episode used to emit `<span></span>` and a
 * stray leading space around text that had not actually grown.
 */
function concatLangField<T extends TextFieldBase>(current: T, before: T | undefined, after: T | undefined): T {
  const wrap = (text: string) => `${EXPANDED_NEIGHBOUR_TAG}${text}</span>`;
  const join = (parts: Array<string | null>) => parts.filter((part): part is string => !!part).join(' ');

  const contentOf = (field: T | undefined) => field?.content || '';
  const highlightOf = (field: T | undefined) => field?.highlight || contentOf(field);

  const merged = {
    ...current,
    content: join([before ? contentOf(before) : null, contentOf(current), after ? contentOf(after) : null]),
    highlight: join([
      before ? wrap(highlightOf(before)) : null,
      highlightOf(current),
      after ? wrap(highlightOf(after)) : null,
    ]),
  };

  // The Japanese string fallback adds wrappers that invalidate token offsets. Drop remaining tokens;
  // consumers must tolerate absent analysis despite the SDK's required field.
  if ('tokens' in merged) {
    (merged as { tokens: unknown }).tokens = null;
  }

  return merged;
}

/**
 * Build the merged text for all three languages at once.
 *
 * Japanese takes the token-preserving path when every sentence in the merge has
 * an analysis, and the plain string merge otherwise. The translations only ever
 * take the string merge: they have no tokens, so the wrapper is how their
 * pulled-in halves are marked.
 */
export function buildExpandedTexts(
  segment: Segment,
  before: SearchResult | null,
  after: SearchResult | null,
): ExpandedTexts {
  const pieces: JaPiece[] = [
    ...(before ? [{ field: before.segment.textJa, origin: 'before' as const }] : []),
    { field: segment.textJa, origin: 'current' as const },
    ...(after ? [{ field: after.segment.textJa, origin: 'after' as const }] : []),
  ];

  return {
    textJa:
      concatJapanese(segment.textJa, pieces) ??
      concatLangField(segment.textJa, before?.segment.textJa, after?.segment.textJa),
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
