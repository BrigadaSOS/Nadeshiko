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

/** Which of the merged sentences a token came from. */
export type TokenOrigin = 'before' | 'current' | 'after';

/** What separates two merged sentences -- in the text and in the offsets alike. */
const JOIN = ' ';

type JaField = Segment['textJa'];
type JaToken = JaField['tokens'][number] & { origin?: TokenOrigin };

/** One sentence going into the Japanese merge, with the side it came from. */
type JaPiece = { field: JaField; origin: TokenOrigin };

/**
 * Move a segment's tokens onto the merged sentence's coordinates.
 *
 * `b`/`e` are offsets into the sentence the token came from, so a neighbour's
 * tokens address the wrong characters the moment another sentence is put in
 * front of them. That is what this module used to give up on, dropping the
 * tokens outright and taking furigana, the word cards, the keyboard walk and the
 * Anki furigana export down with them. Shifting each token by everything that
 * now precedes its segment is all they actually needed.
 *
 * `parts` carries the same kind of offset one level down -- the finer morphemes
 * inside a grouped token, used to highlight a match that lands inside one of our
 * tokens -- so it moves by the same amount. Nothing reads it today; leaving it
 * behind on the old coordinates would be a trap for whoever first does.
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
 * Merge the Japanese text, keeping its tokens rebased onto the joined sentence.
 *
 * Unlike the translations below, this must NOT wrap the pulled-in neighbours in
 * markup. The tokens address `content` by character offset and
 * `tokensToAnkiFurigana` slices that very string, so a `<span>` inside it would
 * both shift every offset past it and end up spliced into the reader's Anki
 * field. `enrichTokens` has the same problem from the other side: it measures
 * its highlight ranges by counting characters and skips only `<em>`, so any
 * other tag in `highlight` slides the match underline off the words it belongs
 * to. So provenance moves out of the string and onto `origin`, and the renderer
 * tints the halves a token at a time.
 *
 * Returns null when any piece has no tokens -- the caller's cue to fall back to
 * the plain string merge. A segment with no POS analysis still has to expand,
 * and there the wrapper is the only way left to mark what was pulled in.
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

  // Reached for Japanese only when `concatJapanese` declined -- a segment
  // somewhere in the merge has no tokens at all. The ones that DO exist cannot
  // come along: they describe offsets into their own sentence, and the wrappers
  // above have just moved every character past the first one, so keeping them
  // would furigana-annotate the wrong words. The SDK types `tokens` as always
  // present, but every reader of it guards on emptiness first, which is the
  // contract this relies on.
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
