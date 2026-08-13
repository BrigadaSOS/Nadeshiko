/**
 * Tells a morpheme-segmented subtitle source from a normally-spaced one.
 *
 * WHY THIS EXISTS. One Punch Man was ingested from a source that had been run
 * through a morphological analyzer before it reached us -- wakati-gaki, one
 * space per morpheme boundary -- and we stored it verbatim for a year:
 *
 *     残念 だ が 俺 は 命 を かけ てる わけ じゃ ない
 *
 * It is not a display bug. Shirabe cannot group across a space, so every line
 * came back shredded (`お前 見 て みろ よ` parsed as five tokens plus four
 * spaces), which costs furigana, inflection, and dictionary linking, and leaves
 * the media unreachable by normal search input: `見てみろ` matched nothing.
 * `scripts/strip-wakati-spaces.ts` repaired that media. This is the part that
 * keeps the next one from landing.
 *
 * THE SIGNAL IS A POPULATION, NOT A LINE. This is the whole design constraint.
 * A single line cannot be judged: `お前 見 て みろ よ` and a perfectly clean
 * `おっ 行く! で どこ?` are the same shape in isolation, because real subtitles
 * do use a space -- for a speaker change, or a pause. What separates them is how
 * FAR APART the spaces are, averaged over enough lines to mean something.
 * Measured over the whole corpus (317 media, 1.32M segments):
 *
 *     One Punch Man            1.91 chars between spaces
 *     Kimi ni Todoke           5.61   <- the closest clean media
 *     every other media        5.8 - 6.1
 *
 * 1.91 is a morpheme. ~6 is a writer's pause. Nothing sits in between, which is
 * why a threshold works here at all -- and why it is checked per BATCH (one
 * episode, ~250 lines) rather than per line.
 *
 * HALF-WIDTH U+0020 ONLY. U+3000 is real Japanese typography, it appears in
 * 172k segments of otherwise clean corpus, and the wakati lines themselves use
 * it correctly alongside the noise (`! !　誰か`). Counting it would measure
 * nothing.
 */

/** Running counts, so a corpus-wide audit can stream instead of buffering 1.3M
 *  strings in memory to hand this module an array. */
export interface WakatiTally {
  totalLines: number;
  spacedLines: number;
  /** Sum of each spaced line's own chars-per-chunk, so the summary is a mean of
   *  per-line ratios -- the same statistic the corpus survey was measured with,
   *  which is where the thresholds below come from. Weighting by line length
   *  instead would let one long line outvote twenty short ones. */
  chunkRatioSum: number;
}

export interface WakatiAssessment {
  totalLines: number;
  spacedLines: number;
  /** Mean characters between half-width spaces, over the spaced lines only.
   *  Zero when there are none -- read `spacedLines` before trusting it. */
  meanChunkChars: number;
  isWakati: boolean;
}

/** Below this, the spaces are falling on morpheme boundaries. Sits in the gap
 *  between 1.91 (the bad ingest) and 5.61 (the closest clean media), far enough
 *  from both that a media would have to be unlike anything in the corpus to be
 *  misread. */
export const MAX_MEAN_CHUNK_CHARS = 3.0;

/** Below this many spaced lines the mean is noise, and a short batch of
 *  exclamations (`おう い たい た ! !`) can average anything at all. A real
 *  wakati episode offers hundreds. */
export const MIN_SPACED_LINES = 20;

export function emptyTally(): WakatiTally {
  return { totalLines: 0, spacedLines: 0, chunkRatioSum: 0 };
}

export function tallyLine(tally: WakatiTally, line: string): void {
  tally.totalLines += 1;

  let spaces = 0;
  for (const character of line) if (character === ' ') spaces += 1;
  if (spaces === 0) return;

  // Characters, not UTF-16 units: `[...line]` so a surrogate pair counts once.
  const characters = [...line].length - spaces;

  tally.spacedLines += 1;
  tally.chunkRatioSum += characters / (spaces + 1);
}

export function summarize(tally: WakatiTally): WakatiAssessment {
  const meanChunkChars = tally.spacedLines === 0 ? 0 : tally.chunkRatioSum / tally.spacedLines;

  return {
    totalLines: tally.totalLines,
    spacedLines: tally.spacedLines,
    meanChunkChars,
    isWakati: tally.spacedLines >= MIN_SPACED_LINES && meanChunkChars <= MAX_MEAN_CHUNK_CHARS,
  };
}

/** The whole assessment for a batch already in memory -- what the ingest guard
 *  uses, where the batch is one episode and buffering is not a question. */
export function assessWakati(lines: string[]): WakatiAssessment {
  const tally = emptyTally();
  for (const line of lines) tallyLine(tally, line);
  return summarize(tally);
}

/** The rejection message, kept here beside the thresholds so the numbers it
 *  quotes and the numbers it is judged by cannot drift apart. */
export function describeWakati(assessment: WakatiAssessment): string {
  return (
    `${assessment.spacedLines} of ${assessment.totalLines} lines average ` +
    `${assessment.meanChunkChars.toFixed(1)} characters between spaces. This subtitle source looks ` +
    `morpheme-segmented (wakati-gaki); ingest the unsegmented text.`
  );
}
