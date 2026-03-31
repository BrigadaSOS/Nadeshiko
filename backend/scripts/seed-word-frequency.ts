/**
 * Seeds the WordFrequency table from Jiten anime frequency data.
 * Downloads the anime-specific CSV frequency list from jiten.moe.
 *
 * Usage:
 *   bun run scripts/seed-word-frequency.ts
 */

import { AppDataSource } from '@config/database';

const JITEN_URL = 'https://api.jiten.moe/api/frequency-list/download?mediaType=anime&downloadType=csv';

interface FreqWord {
  rank: number;
  word: string;
  reading: string | null;
}

const BATCH_SIZE = 1000;

function parseCsv(csv: string): FreqWord[] {
  const lines = csv.split('\n');
  const words: FreqWord[] = [];
  let position = 0;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const parts = line.split(',');
    if (parts.length < 3) continue;

    const word = parts[0];
    const form = parts[1];

    if (!word) continue;

    position++;
    const reading = form !== word ? form : null;
    words.push({ rank: position, word, reading });
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

async function main() {
  const words = await downloadAndParse();

  await AppDataSource.initialize();
  console.log('Database connected');

  await AppDataSource.query('DELETE FROM "WordFrequency"');
  console.log('Cleared existing WordFrequency data');

  let inserted = 0;
  for (let i = 0; i < words.length; i += BATCH_SIZE) {
    const batch = words.slice(i, i + BATCH_SIZE);

    const values = batch.map((_, idx) => {
      const base = idx * 3;
      return `($${base + 1}, $${base + 2}, $${base + 3})`;
    });

    const params = batch.flatMap((w) => [w.rank, w.word, w.reading ?? null]);

    await AppDataSource.query(
      `INSERT INTO "WordFrequency" ("rank", "word", "reading")
       VALUES ${values.join(', ')}
       ON CONFLICT ("rank") DO UPDATE SET
         "word" = EXCLUDED."word",
         "reading" = EXCLUDED."reading"`,
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
