import fs from 'node:fs';
import path from 'node:path';
import '@config/boot';
import { AppDataSource } from '@config/database';
import { logger } from '@config/log';
import { User } from '@app/models';

/** Exports a release-announcement CSV for Zoho Campaigns; it never sends mail because ZeptoMail is
 * transactional-only. Apply both local lifecycle opt-out and suppression-list exclusions here, and omit deactivated
 * accounts. Usage: `npm run email:audience -w backend -- [path.csv]`. */
function toCsvField(value: string): string {
  // Quote anything that could be read as structure, and double any quote inside
  // it. A username with a comma in it would otherwise shift every later column.
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

async function main(): Promise<void> {
  const target = path.resolve(process.argv[2] ?? 'tmp/email-audience.csv');

  await AppDataSource.initialize();

  try {
    const users = await User.createQueryBuilder('user')
      .select(['user.email', 'user.username'])
      .where('user.is_active = true')
      .andWhere(`COALESCE(user.preferences -> 'productEmails' ->> 'enabled', 'true') <> 'false'`)
      .andWhere(`NOT EXISTS (SELECT 1 FROM "EmailSuppression" p WHERE p.address = LOWER(user.email))`)
      .orderBy('user.email', 'ASC')
      .getMany();

    const rows = ['email,name', ...users.map((user) => `${toCsvField(user.email)},${toCsvField(user.username)}`)];

    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    await fs.promises.writeFile(target, `${rows.join('\n')}\n`, 'utf-8');

    // The count is the thing to sanity-check before an import: a number far
    // below the account total means an exclusion is matching more than intended,
    // and finding that out after the send is too late.
    const total = await User.count();
    logger.info({ recipients: users.length, accounts: total, path: target }, 'Wrote the announcement audience');
    logger.info(
      'Import this into the Campaigns list, then send. Afterwards run `npm run email:sync-unsubscribes` with ' +
        "Campaigns' unsubscribe export, or our own sends will keep writing to people who opted out over there.",
    );
  } finally {
    await AppDataSource.destroy();
  }
}

void main();
