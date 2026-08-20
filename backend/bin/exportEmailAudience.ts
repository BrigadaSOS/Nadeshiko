import fs from 'node:fs';
import path from 'node:path';
import '@config/boot';
import { AppDataSource } from '@config/database';
import { logger } from '@config/log';
import { User } from '@app/models';

/**
 * The recipient list for a release announcement, for import into Zoho Campaigns.
 *
 *   npm run email:audience -w backend -- [path.csv]
 *
 * WHY THIS IS A CSV AND NOT A SEND. The announcement is the one lifecycle email
 * that is genuinely bulk -- identical content, on our schedule, to everybody --
 * and ZeptoMail is transactional-only by its own terms. Sending it from here
 * would put a mass send on the Agent that also carries magic links, and losing
 * that Agent means losing sign-in. So the list goes to Campaigns and the mail
 * goes out from there.
 *
 * TWO EXCLUSIONS, both of which have to happen HERE rather than in Campaigns,
 * because Campaigns knows nothing about either:
 *
 *   - anyone who turned lifecycle mail off, in settings or from an unsubscribe
 *     link. Zoho remembers its OWN unsubscribes and will not re-mail them even
 *     after a re-import, but it has never heard of ours.
 *   - anyone on our suppression list. Mailing a known-bad address through a new
 *     provider is how a clean sending domain earns its first bounce.
 *
 * Deactivated accounts are left out for the same reason the sweep skips them:
 * `authentication.ts` refuses them, so they are not readers we are talking to.
 */
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
