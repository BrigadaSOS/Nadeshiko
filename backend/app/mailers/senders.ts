import { config } from '@config/config';

/**
 * Who a personal email comes from.
 *
 * Nadeshiko has two people behind it, and mail that says "one of the creators"
 * while always being the same creator is a smaller claim than it could be.
 * These are the real identities: a real mailbox each, the picture each of them
 * uses on the about page, and the place they can be found.
 */
export interface Sender {
  /** Stable key, for the log line and for tests to assert on. */
  key: 'dav' | 'natsume';
  /** How they sign, and how the copy greets. */
  name: string;
  /** A real mailbox. Replies to these emails land in it. */
  email: string;
  /** Path under `frontend/public`, resolved against `BASE_URL` at render time. */
  avatarPath: string;
  /** Where the sign-off links. */
  profileUrl: string;
}

export const SENDERS: readonly [Sender, Sender] = [
  {
    key: 'dav',
    name: 'Dav',
    email: 'dav@nadeshiko.co',
    avatarPath: '/david-b5b22fdc.jpg',
    profileUrl: 'https://x.com/davafons',
  },
  {
    key: 'natsume',
    name: 'Natsume',
    email: 'natsume@nadeshiko.co',
    // Already served from the about page rather than copied into `email/`: one
    // file, one place to change it if either of them ever picks a new picture.
    avatarPath: '/github/natsume_pfp.jpg',
    profileUrl: 'https://github.com/Natsume-197',
  },
] as const;

/**
 * Which of them writes to a given reader.
 *
 * STICKY PER READER, NOT RANDOM PER MESSAGE, and that is the one real decision
 * in this file. A coin flip on every send would give the same fifty-fifty split
 * across the audience while making each individual reader's experience
 * incoherent: a welcome from Natsume, a question from Dav a week later, a
 * win-back from Natsume again -- and if they reply to any of them, they are
 * answering somebody who did not write the last one.
 *
 * Keyed on the account id, so the same person always hears from the same person.
 * Even and odd, because the ids are sequential and that splits them exactly.
 */
export function senderForUser(userId: number): Sender {
  return SENDERS[Math.abs(Math.trunc(userId)) % 2] as Sender;
}

/**
 * The fallback identity for mail with no reader behind it.
 *
 * Configured rather than picked, because this is what the transactional relay
 * has always used and changing it is a deployment decision rather than a
 * content one.
 */
export function configuredSender(): { email: string; name: string } {
  return { email: config.LIFECYCLE_FROM_EMAIL, name: config.LIFECYCLE_FROM_NAME };
}

/** The `From` display name. Their own name, not the product's, because that is the point. */
export function fromNameFor(sender: Sender): string {
  return `${sender.name} from Nadeshiko`;
}
