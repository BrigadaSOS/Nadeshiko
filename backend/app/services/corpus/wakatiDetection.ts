/** Detect wakati from a population of lines using half-width spaces only; full-width spaces are valid Japanese
 * typography, not the signal. */

/** Running counts, so a corpus-wide audit can stream instead of buffering 1.3M
 *  strings in memory to hand this module an array. */
export interface WakatiTally {
  totalLines: number;
  spacedLines: number;
  /** Average per-line ratios rather than weighting by characters, so one long subtitle cannot outweigh many short
   * lines. */
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

/** The threshold sits between the measured bad and clean populations; evaluate it per batch, not per isolated line. */
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
