import type { SitemapUrlInput } from '#sitemap/types';

interface CoveredWord {
  rank: number;
  word: string;
  matchCount: number;
}

interface CoveredWordsResponse {
  words: CoveredWord[];
  pagination: { hasMore: boolean; cursor: string | null };
}

export default defineSitemapEventHandler(async () => {
  const config = useRuntimeConfig();
  const baseUrl = (config.backendInternalUrl as string).replace(/\/$/, '');
  const apiKey = config.nadeshikoApiKey as string;
  const headers = { Authorization: `Bearer ${apiKey}` };

  const allWords: CoveredWord[] = [];
  let cursor: string | null = null;

  while (true) {
    const qs: string = cursor ? `&cursor=${encodeURIComponent(cursor)}` : '';
    const endpoint = `${baseUrl}/v1/stats/covered-words?tier=20000&filter=COVERED&take=1000${qs}`;
    const backendResponse = await fetch(endpoint, { headers });
    const response = (await backendResponse.json()) as CoveredWordsResponse;
    allWords.push(...response.words);
    if (!response.pagination?.cursor) break;
    cursor = response.pagination.cursor;
  }

  return allWords.map(
    (entry) =>
      ({
        loc: `/search/${encodeURIComponent(entry.word)}`,
        changefreq: 'monthly',
      }) satisfies SitemapUrlInput,
  );
});
