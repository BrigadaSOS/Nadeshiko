/**
 * Ranks anime from Jiten by how many uncovered words each would add,
 * using a greedy set-cover algorithm.
 *
 * Usage:
 *   bun run scripts/rank-anime-coverage.ts --nade-key "key"
 *   bun run scripts/rank-anime-coverage.ts --nade-key "key" --max-rank 5000 --top-n 30
 */

import { parseArgs } from 'util';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const { values: args } = parseArgs({
  options: {
    'nade-key': { type: 'string' },
    'nade-url': { type: 'string', default: 'http://localhost:5000' },
    'max-rank': { type: 'string', default: '10000' },
    'cache-dir': { type: 'string', default: join(import.meta.dir, '.jiten-cache') },
    'delay-ms': { type: 'string', default: '500' },
    'concurrency': { type: 'string', default: '10' },
    'top-n': { type: 'string', default: '50' },
    'cache-only': { type: 'boolean', default: false },
    'max-hours': { type: 'string', default: '' },
  },
});

const JITEN_API = 'https://api.jiten.moe/api';
const MAX_RANK = parseInt(args['max-rank']!, 10);
const DELAY_MS = parseInt(args['delay-ms']!, 10);
const CONCURRENCY = parseInt(args['concurrency']!, 10);
const TOP_N = parseInt(args['top-n']!, 10);
const CACHE_DIR = args['cache-dir']!;
const VOCAB_DIR = join(CACHE_DIR, 'vocab');

interface AnimeEntry {
  deckId: number;
  name: string;
  nameEn: string | null;
  speechDurationMs: number;
}

interface AnimeVocab {
  deckId: number;
  animeName: string;
  fetchedAt: string;
  words: Array<{ word: string; reading: string | null }>;
}

interface RankedAnime {
  rank: number;
  deckId: number;
  animeName: string;
  newWordsCovered: number;
  cumulativeCovered: number;
  cumulativePercent: number;
  vocabSize: number;
  speechHours: number;
  newWordsPerHour: number;
}

async function fetchUncoveredWords(nadeUrl: string, nadeKey: string, maxRank: number): Promise<{ words: Set<string>; tierTotal: number; alreadyCovered: number }> {
  console.log(`Fetching uncovered words from ${nadeUrl} (tier=${maxRank})...`);

  const uncovered: string[] = [];
  let totalWords = 0;
  let cursor = 0;

  while (true) {
    const params = new URLSearchParams({
      tier: String(maxRank),
      filter: 'uncovered',
      cursor: String(cursor),
      take: '1000',
    });

    const response = await fetch(`${nadeUrl}/v1/stats/covered-words?${params}`, {
      headers: { Authorization: `Bearer ${nadeKey}` },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Nadeshiko API error ${response.status}: ${text}`);
    }

    const data: {
      words: Array<{ rank: number; word: string; matchCount: number }>;
      nextCursor: number | null;
      tierStats: { total: number; covered: number; uncovered: number };
    } = await response.json();

    totalWords = data.tierStats.total;
    for (const w of data.words) {
      uncovered.push(w.word);
    }

    if (data.nextCursor == null) break;
    cursor = data.nextCursor;
  }

  const alreadyCovered = totalWords - uncovered.length;
  console.log(`  Total words in tier: ${totalWords}`);
  console.log(`  Already covered: ${alreadyCovered} (${((alreadyCovered / totalWords) * 100).toFixed(1)}%)`);
  console.log(`  Uncovered: ${uncovered.length}`);

  return { words: new Set(uncovered), tierTotal: totalWords, alreadyCovered };
}

async function fetchAnimeList(): Promise<AnimeEntry[]> {
  const cachePath = join(CACHE_DIR, 'anime-list.json');
  if (existsSync(cachePath)) {
    return JSON.parse(readFileSync(cachePath, 'utf-8'));
  }

  console.log('Fetching anime list from Jiten...');
  const entries: AnimeEntry[] = [];
  let offset = 0;

  while (true) {
    const url = `${JITEN_API}/media-deck/get-media-decks?mediaType=Anime&offset=${offset}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Jiten list fetch failed: ${response.status}`);

    const data: { data: Array<{ deckId: number; originalTitle: string; englishTitle: string | null; speechDuration: number }>; totalItems: number; pageSize: number } = await response.json();

    for (const deck of data.data) {
      entries.push({
        deckId: deck.deckId,
        name: deck.originalTitle,
        nameEn: deck.englishTitle,
        speechDurationMs: deck.speechDuration,
      });
    }

    if (offset + data.pageSize >= data.totalItems) break;
    offset += data.pageSize;
    await Bun.sleep(DELAY_MS);
  }

  console.log(`  Found ${entries.length} anime`);
  writeFileSync(cachePath, JSON.stringify(entries, null, 2));
  return entries;
}

function cleanWord(text: string): string {
  return text.replace(/\[[^\]]*\]/g, '');
}

async function fetchWithRetry(url: string, maxRetries = 5): Promise<Response> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url);
    if (response.status !== 429) return response;

    const retryAfter = response.headers.get('Retry-After');
    const backoff = retryAfter ? parseInt(retryAfter, 10) * 1000 : Math.min(2000 * 2 ** attempt, 60000);
    if (attempt < maxRetries) {
      console.log(`  429 on ${url.split('/api/')[1]} - retrying in ${(backoff / 1000).toFixed(0)}s (attempt ${attempt + 1}/${maxRetries})`);
      await Bun.sleep(backoff);
    }
  }
  throw new Error(`Rate limited after ${maxRetries} retries: ${url}`);
}

async function fetchAnimeVocab(deckId: number, animeName: string): Promise<AnimeVocab> {
  const words: Array<{ word: string; reading: string | null }> = [];
  let offset = 0;

  while (true) {
    const response = await fetchWithRetry(`${JITEN_API}/media-deck/${deckId}/vocabulary?offset=${offset}`);
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Jiten vocab fetch failed for deck ${deckId}: ${response.status} ${text}`);
    }

    const data: {
      data: {
        words: Array<{
          mainReading: { text: string; readingType: number };
          alternativeReadings: Array<{ text: string; readingType: number }>;
        }>;
      };
      totalItems: number;
      pageSize: number;
    } = await response.json();

    for (const w of data.data.words) {
      const mainText = cleanWord(w.mainReading.text);
      const kanaReading = w.alternativeReadings.find((r) => r.readingType === 1);
      const reading = kanaReading ? cleanWord(kanaReading.text) : null;

      words.push({ word: mainText, reading });
    }

    if (offset + data.pageSize >= data.totalItems) break;
    offset += data.pageSize;
    await Bun.sleep(DELAY_MS);
  }

  return {
    deckId,
    animeName,
    fetchedAt: new Date().toISOString(),
    words,
  };
}

async function loadOrFetchVocab(anime: AnimeEntry): Promise<AnimeVocab | null> {
  const cachePath = join(VOCAB_DIR, `${anime.deckId}.json`);

  if (existsSync(cachePath)) {
    return JSON.parse(readFileSync(cachePath, 'utf-8'));
  }

  if (args['cache-only']) return null;

  try {
    const vocab = await fetchAnimeVocab(anime.deckId, anime.name);
    writeFileSync(cachePath, JSON.stringify(vocab, null, 2));
    return vocab;
  } catch (err) {
    console.warn(`  Failed to fetch vocab for ${anime.name} (${anime.deckId}): ${err}`);
    return null;
  }
}

function greedySetCover(
  uncoveredWords: Set<string>,
  animeVocabs: Map<number, { name: string; words: Set<string>; speechDurationMs: number }>,
  topN: number,
): RankedAnime[] {
  const remaining = new Set(uncoveredWords);
  const results: RankedAnime[] = [];
  const usedAnime = new Set<number>();
  let cumulativeCovered = 0;
  const totalUncovered = uncoveredWords.size;

  for (let rank = 1; rank <= topN && remaining.size > 0; rank++) {
    let bestId = -1;
    let bestCount = 0;

    for (const [deckId, data] of animeVocabs) {
      if (usedAnime.has(deckId)) continue;

      let count = 0;
      for (const w of data.words) {
        if (remaining.has(w)) count++;
      }

      if (count > bestCount) {
        bestCount = count;
        bestId = deckId;
      }
    }

    if (bestId === -1 || bestCount === 0) break;

    const bestData = animeVocabs.get(bestId)!;
    for (const w of bestData.words) {
      remaining.delete(w);
    }

    usedAnime.add(bestId);
    cumulativeCovered += bestCount;

    const speechHours = bestData.speechDurationMs / 3_600_000;
    results.push({
      rank,
      deckId: bestId,
      animeName: bestData.name,
      newWordsCovered: bestCount,
      cumulativeCovered,
      cumulativePercent: (cumulativeCovered / totalUncovered) * 100,
      vocabSize: bestData.words.size,
      speechHours,
      newWordsPerHour: speechHours > 0 ? bestCount / speechHours : 0,
    });
  }

  return results;
}

function printResults(results: RankedAnime[], tierTotal: number, alreadyCovered: number) {
  const totalUncovered = tierTotal - alreadyCovered;
  const basePercent = (alreadyCovered / tierTotal) * 100;
  console.log(`\nTier: top ${MAX_RANK.toLocaleString()} words`);
  console.log(`Current coverage: ${alreadyCovered.toLocaleString()}/${tierTotal.toLocaleString()} (${basePercent.toFixed(1)}%)`);
  console.log(`Uncovered: ${totalUncovered.toLocaleString()}\n`);

  const header = `${'#'.padStart(4)} | ${'Anime'.padEnd(40)} | ${'New'.padStart(5)} | ${'Coverage'.padStart(10)} | ${'Hours'.padStart(6)} | ${'New/hr'.padStart(6)} | ${'Vocab'.padStart(6)}`;
  console.log(header);
  console.log('-'.repeat(header.length));

  for (const r of results) {
    const name = r.animeName.length > 38 ? r.animeName.substring(0, 37) + '...' : r.animeName;
    const totalCoveredNow = alreadyCovered + r.cumulativeCovered;
    const coveragePercent = ((totalCoveredNow / tierTotal) * 100).toFixed(1);
    console.log(
      `${String(r.rank).padStart(4)} | ${name.padEnd(40)} | ${String(r.newWordsCovered).padStart(5)} | ${coveragePercent.padStart(8)}% | ${r.speechHours.toFixed(1).padStart(6)} | ${Math.round(r.newWordsPerHour).toString().padStart(6)} | ${String(r.vocabSize).padStart(6)}`,
    );
  }

  console.log(`\n--- Best efficiency (new words per hour of speech) ---`);
  const byEfficiency = [...results].sort((a, b) => b.newWordsPerHour - a.newWordsPerHour).slice(0, 25);
  const effHeader = `${'#'.padStart(4)} | ${'Anime'.padEnd(40)} | ${'New/hr'.padStart(6)} | ${'New'.padStart(5)} | ${'Hours'.padStart(6)}`;
  console.log(effHeader);
  console.log('-'.repeat(effHeader.length));
  for (const r of byEfficiency) {
    const name = r.animeName.length > 38 ? r.animeName.substring(0, 37) + '...' : r.animeName;
    console.log(
      `${String(r.rank).padStart(4)} | ${name.padEnd(40)} | ${Math.round(r.newWordsPerHour).toString().padStart(6)} | ${String(r.newWordsCovered).padStart(5)} | ${r.speechHours.toFixed(1).padStart(6)}`,
    );
  }

  const finalCovered = alreadyCovered + (results.at(-1)?.cumulativeCovered ?? 0);
  const finalPercent = ((finalCovered / tierTotal) * 100).toFixed(1);
  const maxReachable = alreadyCovered + totalUncovered;
  console.log(`\nAfter adding top ${results.length} anime: ${finalCovered.toLocaleString()}/${tierTotal.toLocaleString()} (${finalPercent}%)`);

  console.log(`\n--- Coverage curve ---`);
  const maxBar = 50;
  console.log(`${'now'.padStart(5)} ${'█'.repeat(Math.round((basePercent / 100) * maxBar))}${'░'.repeat(maxBar - Math.round((basePercent / 100) * maxBar))} ${basePercent.toFixed(1)}%`);
  for (const r of results.slice(0, 25)) {
    const pct = ((alreadyCovered + r.cumulativeCovered) / tierTotal) * 100;
    const barLen = Math.round((pct / 100) * maxBar);
    console.log(
      `${String(r.rank).padStart(3)} + ${'█'.repeat(barLen)}${'░'.repeat(maxBar - barLen)} ${pct.toFixed(1)}%`,
    );
  }
}

async function main() {
  if (!args['nade-key']) throw new Error('--nade-key is required');

  mkdirSync(VOCAB_DIR, { recursive: true });

  const { words: uncoveredWords, tierTotal, alreadyCovered } = await fetchUncoveredWords(args['nade-url']!, args['nade-key']!, MAX_RANK);
  if (uncoveredWords.size === 0) {
    console.log('No uncovered words found. Full coverage!');
    return;
  }

  const animeList = await fetchAnimeList();
  console.log(`\nFetching vocabulary for ${animeList.length} anime...`);

  const animeVocabs = new Map<number, { name: string; words: Set<string>; speechDurationMs: number }>();
  let fetched = 0;

  const queue = [...animeList];
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length > 0) {
      const anime = queue.shift()!;
      const vocab = await loadOrFetchVocab(anime);
      if (vocab && vocab.words.length > 0) {
        animeVocabs.set(anime.deckId, {
          name: anime.name,
          words: new Set(vocab.words.map((w) => w.word)),
          speechDurationMs: anime.speechDurationMs,
        });
      }

      fetched++;
      if (fetched % 100 === 0) {
        console.log(`  ${fetched}/${animeList.length} anime processed`);
      }
    }
  });
  await Promise.all(workers);

  const maxHours = args['max-hours'] ? parseFloat(args['max-hours']!) : null;
  if (maxHours) {
    for (const [deckId, data] of animeVocabs) {
      if (data.speechDurationMs / 3_600_000 > maxHours) {
        animeVocabs.delete(deckId);
      }
    }
  }

  console.log(`\nLoaded vocab for ${animeVocabs.size} anime${maxHours ? ` (filtered to <${maxHours}h)` : ''}`);

  const results = greedySetCover(uncoveredWords, animeVocabs, TOP_N);
  printResults(results, tierTotal, alreadyCovered);
}

main().catch((err) => {
  console.error('Script failed:', err);
  process.exit(1);
});
