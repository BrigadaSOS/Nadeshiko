import type { SitemapUrlInput } from '#sitemap/types';

interface CoveredWord {
  rank: number;
  word: string;
  matchCount: number;
}

interface CoveredWordsResponse {
  words: CoveredWord[];
  nextCursor: number | null;
}

export default defineSitemapEventHandler(async () => {
  const config = useRuntimeConfig();
  const baseUrl = (config.backendInternalUrl as string).replace(/\/$/, '');
  const apiKey = config.nadeshikoApiKey as string;
  const headers = { Authorization: `Bearer ${apiKey}` };

  const allWords: CoveredWord[] = [];
  let cursor = 0;

  while (true) {
    const response = await $fetch<CoveredWordsResponse>(
      `${baseUrl}/v1/stats/covered-words?tier=5000&filter=covered&cursor=${cursor}&take=1000`,
      { headers },
    );
    allWords.push(...response.words);
    if (response.nextCursor == null) break;
    cursor = response.nextCursor;
  }

  return allWords.map(
    (entry) =>
      ({
        loc: `/search/${encodeURIComponent(entry.word)}`,
        changefreq: 'monthly',
      }) satisfies SitemapUrlInput,
  );
});
