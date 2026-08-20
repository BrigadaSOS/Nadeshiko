import fs from 'node:fs';
import '@config/boot';
import { AppDataSource } from '@config/database';
import { logger } from '@config/log';
import { User } from '@app/models';
import { normalizeAddress, suppress } from '@app/services/email/suppression';
import { unsubscribeFromProductEmails } from '@app/services/email/unsubscribe';

/**
 * Bring Zoho Campaigns' opt-outs and bounces back into our own database.
 *
 *   npm run email:sync-unsubscribes -w backend -- unsubscribes export.csv [--apply]
 *   npm run email:sync-unsubscribes -w backend -- bounces export.csv [--apply]
 *
 * THE HALF OF THE ANNOUNCEMENT THAT IS EASY TO FORGET, and the one that decides
 * whether the whole arrangement is honest. Somebody who unsubscribes from a
 * release announcement in Campaigns has told US they want less mail, not Zoho.
 * Campaigns will not mail them again -- it remembers its own list -- but the
 * monthly recap and the day-7 note come from here, and here knows nothing about
 * it. Without this script the reader unsubscribes, keeps hearing from us, and
 * reasonably concludes the unsubscribe was a lie.
 *
 * Bounces are the same argument for reputation rather than for courtesy: an
 * address Campaigns could not deliver to is one our own relay should stop
 * trying, and it goes through the same `suppress` every ZeptoMail bounce does.
 *
 * DRY RUN BY DEFAULT. Both modes write, and the input is a file somebody
 * downloaded and picked by hand -- pointing the bounce mode at the wrong export
 * would suppress a pile of perfectly good addresses, and suppression is not
 * something a rerun undoes.
 */
type Mode = 'unsubscribes' | 'bounces';

/**
 * Enough CSV for an export: quoted fields, doubled quotes inside them, and
 * newlines within a quoted field. Not a general parser, and deliberately not a
 * dependency -- the alternative was `split(',')`, which silently mangles any row
 * containing a quoted comma.
 */
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

/**
 * Which column holds the address.
 *
 * Found by header rather than by position, because Zoho's exports do not agree
 * with each other on column order and a fixed index would quietly read the wrong
 * one. Falls back to the first column that looks like an address, which covers a
 * hand-made one-column list.
 */
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
        // An unsubscribe from somebody with no account is not a fault: the
        // Campaigns list can hold addresses we no longer have a reader for.
        // Nothing to turn off, and nothing to report as a failure.
        if (!user) continue;
        matched += 1;
        if (apply && (await unsubscribeFromProductEmails(user.id))) changed += 1;
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
