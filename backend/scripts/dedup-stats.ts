import { client, INDEX_NAME } from '@config/elasticsearch';

async function main() {
  // 1. Total document count
  const countResult = await client.count({ index: INDEX_NAME });
  console.log(`Total documents: ${countResult.count}`);

  // Since textJa is a text field (no keyword/doc_values), we can't script on it.
  // Instead, we'll use a sampled approach: for each media, fetch segments and hash client-side.

  // Get all mediaIds
  const mediaAgg = await client.search({
    index: INDEX_NAME,
    size: 0,
    aggs: {
      media_ids: {
        terms: { field: 'mediaId', size: 10000 },
      },
    },
  });

  const mediaBuckets = (mediaAgg.aggregations?.media_ids as any)?.buckets ?? [];
  console.log(`Total media: ${mediaBuckets.length}\n`);

  // For each media, scroll through all segments and find duplicates
  let totalDuplicateDocs = 0;
  let totalGroupsWithDupes = 0;
  const topDupes: Array<{
    count: number;
    mediaId: number;
    text: string;
    episodes: number[];
    times: number[];
  }> = [];

  for (const mb of mediaBuckets) {
    const mediaId = mb.key;
    const docCount = mb.doc_count;

    // Fetch all segments for this media (scroll if needed)
    const segments: Array<{ textJa: string; episode: number; startTimeMs: number }> = [];
    let searchAfter: any[] | undefined;

    while (true) {
      const res = await client.search({
        index: INDEX_NAME,
        size: 5000,
        sort: [{ _doc: 'asc' }],
        _source: ['textJa', 'episode', 'startTimeMs'],
        query: { term: { mediaId } },
        ...(searchAfter ? { search_after: searchAfter } : {}),
      });

      const hits = res.hits.hits;
      if (hits.length === 0) break;

      for (const hit of hits) {
        const src = hit._source as any;
        segments.push({ textJa: src.textJa, episode: src.episode, startTimeMs: src.startTimeMs });
      }

      searchAfter = hits[hits.length - 1].sort as any[];
      if (hits.length < 5000) break;
    }

    // Group by textJa
    const groups = new Map<string, Array<{ episode: number; startTimeMs: number }>>();
    for (const seg of segments) {
      const key = seg.textJa || '';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push({ episode: seg.episode, startTimeMs: seg.startTimeMs });
    }

    for (const [text, entries] of groups) {
      if (entries.length >= 2) {
        totalGroupsWithDupes++;
        totalDuplicateDocs += entries.length - 1;

        if (entries.length >= 5) {
          const episodes = [...new Set(entries.map((e) => e.episode))].sort((a, b) => a - b);
          const times = entries.map((e) => e.startTimeMs).sort((a, b) => a - b);
          topDupes.push({ count: entries.length, mediaId, text, episodes, times });
        }
      }
    }
  }

  // Sort top dupes
  topDupes.sort((a, b) => b.count - a.count);

  console.log(`--- Top duplicated lines (min 5 occurrences) ---`);
  console.log(`${'Count'.padStart(5)} | ${'Eps'.padStart(4)} | ${'Time Range (s)'.padEnd(20)} | Media | Text`);
  console.log('-'.repeat(100));

  for (const d of topDupes.slice(0, 40)) {
    const minTime = Math.round(d.times[0] / 1000);
    const maxTime = Math.round(d.times[d.times.length - 1] / 1000);
    const text = (d.text || '').substring(0, 45);
    console.log(
      `${String(d.count).padStart(5)} | ${String(d.episodes.length).padStart(4)} | ${`${minTime}s - ${maxTime}s`.padEnd(20)} | ${String(d.mediaId).padStart(5)} | ${text}`,
    );
  }

  // Distribution
  const sizeDist: Record<string, number> = { '2-5': 0, '6-13': 0, '14-26': 0, '27+': 0 };
  // Re-count from topDupes isn't complete; let's track during the loop above.
  // Actually we need to re-iterate. Let's just print totals.

  console.log(`\n--- Summary ---`);
  console.log(`Total documents: ${countResult.count}`);
  console.log(`Total groups with duplicates (2+): ${totalGroupsWithDupes}`);
  console.log(`Total duplicate docs that would be removed: ${totalDuplicateDocs}`);
  console.log(`Percentage of index that are duplicates: ${((totalDuplicateDocs / countResult.count) * 100).toFixed(1)}%`);
  console.log(`Groups with 5+ duplicates: ${topDupes.length}`);

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
