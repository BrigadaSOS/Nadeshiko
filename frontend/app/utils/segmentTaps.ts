/**
 * How many distinct words a reader opens in one sentence.
 *
 * The question behind it is whether the word lookup should batch. Identify takes
 * up to 200 tokens and costs almost the same for fifteen as for one -- measured
 * at 473ms for a whole sentence against 415ms for a single word, because the
 * fixed cost dominates -- so batching a sentence is nearly free in latency. It
 * is not free in bytes: a fifteen-token sentence answers ~71KB, and grammar
 * words are the worst of it (six particles cost 46KB to nine content words'
 * 26KB, because は resolves to 歯, 葉, 刃, 派 and the rest).
 *
 * So batching pays only if readers actually open several words per sentence. One
 * tap per sentence and it is pure waste: we would fetch fourteen words nobody
 * looked at, and throw away the per-word HTTP cache that currently serves every
 * repeat of は on the page for nothing. Two or three and it starts to earn out.
 *
 * Nobody knows which, so this counts it rather than guessing.
 *
 * DISTINCT words, not opens. A reader who checks 食べる, moves away and comes
 * back to it has looked at one word, and a batch would have fetched one word.
 * Counting the reopen would flatter exactly the case being measured.
 */
export interface SegmentTaps {
  /**
   * Record a word being opened in a sentence, and answer how many distinct words
   * have now been opened in THAT sentence.
   *
   * 1 for the first, and 1 again if the reader reopens the same word.
   */
  record(sentence: string, lemma: string): number;
}

/**
 * One counter per sentence on screen.
 *
 * Keyed on the sentence's own text rather than on an id, because the component
 * that owns this is reused: a search replaces the results under it and the same
 * instance is handed a different sentence. Anything remembered across that
 * boundary would report two sentences' taps as one, which is the direction that
 * makes batching look better than it is. The text changes when the sentence
 * does, and that is all this needs to notice.
 *
 * Only the current sentence is kept. There is no history to accumulate: the
 * number is reported at the moment of the tap and never read back.
 */
export function createSegmentTaps(): SegmentTaps {
  let sentence = '';
  let lemmas = new Set<string>();

  return {
    record(currentSentence: string, lemma: string): number {
      if (currentSentence !== sentence) {
        sentence = currentSentence;
        lemmas = new Set();
      }
      lemmas.add(lemma);
      return lemmas.size;
    },
  };
}
