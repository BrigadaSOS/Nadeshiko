import fs from 'node:fs';
import '@config/boot';
import { AppDataSource } from '@config/database';
import { logger } from '@config/log';
import { User } from '@app/models';
import { normalizeAddress, suppress } from '@app/services/email/suppression';
import { setProductEmailCategory } from '@app/services/email/unsubscribe';

/** Imports Zoho opt-outs and bounces into local suppression/preferences. Dry-run is the default because a
 * hand-selected export can suppress valid addresses and suppression is not undone by rerunning. Usage: `npm run
 * email:sync-unsubscribes -w backend -- <unsubscribes|bounces> <export.csv> [--apply]`. */
type Mode = 'unsubscribes' | 'bounces';

/** Parse quoted CSV fields, doubled quotes, and embedded newlines; `split(",")` would silently corrupt quoted
 * commas. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }

  if (field || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((entry) => entry.some((value) => value.trim()));
}

/** Find the address column by header because Zoho export order varies; fall back to the first address-looking column
 * for a one-column hand-made list. */
export function addressesFrom(rows: string[][]): string[] {
  if (rows.length === 0) return [];

  const header = (rows[0] ?? []).map((value) => value.trim().toLowerCase());
  const byHeader = header.findIndex((value) => value.includes('email') || value.includes('mail address'));

  if (byHeader >= 0) {
    return rows
      .slice(1)
      .map((row) => row[byHeader] ?? '')
      .filter(Boolean);
  }

  const looksLikeAddress = (value: string) => value.includes('@');
  const byShape = header.findIndex(looksLikeAddress);

  // No header row at all: the first line is data, so nothing is skipped.
  if (byShape >= 0) return rows.map((row) => row[byShape] ?? '').filter(Boolean);

  return [];
}

async function main(): Promise<void> {
  const mode = process.argv[2] as Mode | undefined;
  const file = process.argv[3];
  const apply = process.argv.includes('--apply');

  if ((mode !== 'unsubscribes' && mode !== 'bounces') || !file) {
    logger.error('Usage: npm run email:sync-unsubscribes -w backend -- <unsubscribes|bounces> <export.csv> [--apply]');
    process.exitCode = 1;
    return;
  }

  const addresses = [
    ...new Set(
      addressesFrom(parseCsv(await fs.promises.readFile(file, 'utf-8')))
        .map(normalizeAddress)
        .filter((address): address is string => Boolean(address)),
    ),
  ];

  if (addresses.length === 0) {
    logger.error({ file }, 'Found no email addresses in that file. Check it is the right export.');
    process.exitCode = 1;
    return;
  }

  await AppDataSource.initialize();

  try {
    let matched = 0;
    let changed = 0;

    for (const address of addresses) {
      const user = await User.createQueryBuilder('user').where('LOWER(user.email) = :address', { address }).getOne();

      if (mode === 'unsubscribes') {
        // An unsubscribe for an unknown account is valid input; there is no local preference to update.
        if (!user) continue;
        matched += 1;
        // Update only lifecycle preferences: Campaigns opt-out must not disable unrelated mail.
        if (apply && (await setProductEmailCategory(user.id, 'updates', false))) changed += 1;
        continue;
      }

      matched += user ? 1 : 0;
      if (apply) {
        await suppress({ address, cause: 'hard_bounce', reason: 'Reported as a bounce by Zoho Campaigns' });
        changed += 1;
      }
    }

    logger.info({ mode, addresses: addresses.length, matched, changed, applied: apply }, 'Campaigns sync complete');

    if (!apply) {
      logger.info('DRY RUN -- nothing was written. Re-run with --apply once the numbers above look right.');
    }
  } finally {
    await AppDataSource.destroy();
  }
}

void main();
