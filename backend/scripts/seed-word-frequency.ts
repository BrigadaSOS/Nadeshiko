/** Seeds WordFrequency from the anime frequency-list CSV (`Word,Form,Rank`). Segment difficulty is computed from these
 * ranks at index time, so a reseed must be followed by a full Elasticsearch reindex (`npm run es:reindex`). Usage:
 * `node --import tsx scripts/seed-word-frequency.ts`. */

import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';
import { AppDataSource } from '@config/database';

const JITEN_URL = 'https://api.jiten.moe/api/frequency-list/download?mediaType=anime&downloadType=csv';

/** EDRDG dictionaries (CC BY-SA 4.0): proper names, and the general dictionary to tell a name from a word. */
const JMNEDICT_URL = 'http://ftp.edrdg.org/pub/Nihongo/JMnedict.xml.gz';
const JMDICT_URL = 'http://ftp.edrdg.org/pub/Nihongo/JMdict_e.gz';

interface FreqWord {
  rank: number;
  word: string;
  form: string | null;
  isName: boolean;
}

const BATCH_SIZE = 1000;

function parseCsv(csv: string): FreqWord[] {
  const lines = csv.split('\n');
  const words: FreqWord[] = [];
  let position = 0;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]?.trim();
    if (!line) continue;

    const parts = line.split(',');
    if (parts.length < 3) continue;

    const word = parts[0];
    const form = parts[1] || null;

    if (!word) continue;

    position++;
    words.push({ rank: position, word, form, isName: false });
  }

  return words;
}

async function downloadAndParse(): Promise<FreqWord[]> {
  console.log(`Downloading Jiten anime frequency list...`);

  const response = await fetch(JITEN_URL);
  if (!response.ok) throw new Error(`Download failed: ${response.status}`);

  const csv = await response.text();
  const words = parseCsv(csv);

  console.log(`Parsed ${words.length} words`);
  return words;
}

/** Every kanji (`keb`) and kana (`reb`) headword of a gzipped EDRDG XML file, streamed so the XML is never held whole. */
async function downloadHeadwords(url: string): Promise<Set<string>> {
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`Download failed: ${url} ${response.status}`);

  const headwords = new Set<string>();
  const lines = createInterface({ input: Readable.fromWeb(response.body as never).pipe(createGunzip()) });
  for await (const line of lines) {
    const match = /<(keb|reb)>([^<]+)<\/\1>/.exec(line);
    if (match?.[2]) headwords.add(match[2]);
  }
  return headwords;
}

function toHiragana(text: string): string {
  return text.replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
}

/** A word that is a proper name and nothing else: in JMnedict, not in JMdict. 桜 or 光 are both, so they stay words.
 * JMdict spells many words only in hiragana or kanji, so a katakana entry (イチゴ, マグマ) is also checked as
 * hiragana before it is called a name. */
function markNames(words: FreqWord[], names: ReadonlySet<string>, dictionary: ReadonlySet<string>): number {
  let marked = 0;
  for (const word of words) {
    const inDictionary = dictionary.has(word.word) || dictionary.has(toHiragana(word.word));
    word.isName = names.has(word.word) && !inDictionary;
    if (word.isName) marked++;
  }
  return marked;
}

async function main() {
  const words = await downloadAndParse();

  console.log('Downloading JMnedict and JMdict to mark proper names...');
  const [names, dictionary] = await Promise.all([downloadHeadwords(JMNEDICT_URL), downloadHeadwords(JMDICT_URL)]);
  const marked = markNames(words, names, dictionary);
  console.log(`Marked ${marked} name-only entries`);

  await AppDataSource.initialize();
  console.log('Database connected');

  await AppDataSource.query('DELETE FROM "WordFrequency"');
  console.log('Cleared existing WordFrequency data');

  let inserted = 0;
  for (let i = 0; i < words.length; i += BATCH_SIZE) {
    const batch = words.slice(i, i + BATCH_SIZE);

    const values = batch.map((_, idx) => {
      const base = idx * 4;
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`;
    });

    const params = batch.flatMap((w) => [w.rank, w.word, w.form, w.isName]);

    await AppDataSource.query(
      `INSERT INTO "WordFrequency" ("rank", "word", "form", "is_name")
       VALUES ${values.join(', ')}
       ON CONFLICT ("rank") DO UPDATE SET
         "word" = EXCLUDED."word",
         "form" = EXCLUDED."form",
         "is_name" = EXCLUDED."is_name"`,
      params,
    );

    inserted += batch.length;
    if (inserted % 10000 === 0 || i + BATCH_SIZE >= words.length) {
      console.log(`  ${inserted}/${words.length} rows inserted`);
    }
  }

  console.log(`Seed complete: ${inserted} words inserted into WordFrequency`);
  await AppDataSource.destroy();
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
