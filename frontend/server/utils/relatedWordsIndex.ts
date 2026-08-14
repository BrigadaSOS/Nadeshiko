import type { H3Event } from 'h3';

/**
 * Kanji -> the common words that contain it, for the "related words" links on a
 * word page.
 *
 * The ~19.8k word pages are the site's main indexable asset and, until this,
 * almost nothing linked to them: they were reachable from the sitemap and from a
 * reader typing the word, and from essentially nowhere else on the site. A
 * sitemap tells a crawler a URL exists; links are what tell it the URL matters
 * and give it a path to walk. 19.8k orphan pages is the single biggest
 * structural weakness left in the site's SEO.
 *
 * Relation is by SHARED KANJI, which is not an arbitrary choice: it is also the
 * relation a learner wants. 食べる, 食事, 食べ物 and 飲食 are the same character
 * doing the same work, so a page about one is genuinely a useful place to find
 * the others -- which is what keeps this from being a link farm.
 */

interface CoveredWordEntry {
  word: string;
  /** Frequency rank; lower is more common. */
  rank: number;
  matchCount: number;
}

interface RelatedWordsIndex {
  entries: CoveredWordEntry[];
  /** Kanji -> indices into `entries`. */
  byKanji: Map<string, number[]>;
  builtAt: number;
}

/**
 * How deep into the frequency list the candidate pool goes.
 *
 * NOT the full 20k the sitemap walks. Two reasons, and they point the same way:
 * a suggestion is only useful if the reader is plausibly going to meet the word,
 * so the common half of the list is where the value is; and the pool is built by
 * paginating, so 5k is five backend calls where 20k is twenty. Suggestions are
 * drawn from the top 5k for ANY query word, including one outside it -- a rare
 * word linking to common relatives is the useful direction.
 */
const CANDIDATE_TIER = 5000;
const PAGE_SIZE = 1000;

/** A day: this list only moves when a dictionary or the corpus is reimported. */
const TTL_MS = 24 * 60 * 60 * 1000;

/** CJK ideographs. Kana carry no shared-character meaning, so they are not indexed. */
const KANJI_PATTERN = /[一-龯㐀-䶿]/u;

export function extractKanji(word: string): string[] {
  return [...new Set([...word].filter((char) => KANJI_PATTERN.test(char)))];
}

let cached: RelatedWordsIndex | null = null;
let inflight: Promise<RelatedWordsIndex> | null = null;

async function buildIndex(event?: H3Event): Promise<RelatedWordsIndex> {
  const sdk = useServerSdk(event);
  const entries: CoveredWordEntry[] = [];

  for await (const entry of sdk.getCoveredWords.paginate({
    tier: CANDIDATE_TIER,
    filter: 'COVERED',
    take: PAGE_SIZE,
  })) {
    entries.push({ word: entry.word, rank: entry.rank, matchCount: entry.matchCount });
  }

  const byKanji = new Map<string, number[]>();
  entries.forEach((entry, index) => {
    for (const kanji of extractKanji(entry.word)) {
      const bucket = byKanji.get(kanji);
      if (bucket) bucket.push(index);
      else byKanji.set(kanji, [index]);
    }
  });

  return { entries, byKanji, builtAt: Date.now() };
}

function refresh(event?: H3Event): Promise<RelatedWordsIndex> {
  inflight ??= buildIndex(event)
    .then((index) => {
      cached = index;
      return index;
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}

export interface RelatedWord {
  word: string;
  matchCount: number;
}

/**
 * Words worth linking to from `word`'s page, most relevant first.
 *
 * Ranked by how many kanji are shared (a two-character overlap is a much
 * stronger relation than one), then by frequency, so the reader is offered words
 * they will actually meet rather than the rarest thing that happens to match.
 *
 * Empty for a word with no kanji: relating きれい to every other kana string
 * would produce noise, and noisy links are worse than none -- for a reader and
 * for a crawler reading the same page.
 */
export async function relatedWords(word: string, limit = 12, event?: H3Event): Promise<RelatedWord[]> {
  const kanji = extractKanji(word);
  if (kanji.length === 0) return [];

  const index = cached && Date.now() - cached.builtAt < TTL_MS ? cached : await refresh(event);

  const sharedCount = new Map<number, number>();
  for (const char of kanji) {
    for (const entryIndex of index.byKanji.get(char) ?? []) {
      sharedCount.set(entryIndex, (sharedCount.get(entryIndex) ?? 0) + 1);
    }
  }

  return (
    [...sharedCount.entries()]
      // `flatMap` rather than `map(...)!` plus a filter: the indices come from the
      // map this index built, so a miss is impossible -- but saying so with a
      // non-null assertion is exactly what the lint rule is for, and dropping the
      // word itself is the same pass anyway.
      .flatMap(([entryIndex, shared]) => {
        const entry = index.entries[entryIndex];
        return entry && entry.word !== word ? [{ entry, shared }] : [];
      })
      .sort((a, b) => b.shared - a.shared || a.entry.rank - b.entry.rank)
      .slice(0, limit)
      .map(({ entry }) => ({ word: entry.word, matchCount: entry.matchCount }))
  );
}

/** Test seam: drops the cache so a case can build its own. */
export function resetRelatedWordsIndex(): void {
  cached = null;
  inflight = null;
}
