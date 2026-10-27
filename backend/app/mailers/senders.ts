import { config } from '@config/config';

/** Use real personal identities for personal mail rather than claiming an anonymous “creator.” */
export interface Sender {
  /** Stable key, for the log line and for tests to assert on. */
  key: 'natsume';
  /** How they sign, and how the copy greets. */
  name: string;
  /** A real mailbox. Replies to these emails land in it. */
  email: string;
  /** Path under `frontend/public`, resolved against `BASE_URL` at render time. */
  avatarPath: string;
  /** Where the sign-off links. */
  profileUrl: string;
}

export const SENDERS: readonly [Sender] = [
  {
    key: 'natsume',
    name: 'Natsume',
    email: 'natsume@nadeshiko.co',
    // Already served from the about page rather than copied into `email/`: one
    // file, one place to change it if a new picture is ever picked.
    avatarPath: '/github/natsume_pfp.jpg',
    profileUrl: 'https://github.com/Natsume-197',
  },
] as const;

/** Natsume signs every reader's mail. Keeps the per-reader signature so a second author can be added back without
 * touching the callers; with one sender, every reader gets the same person and replies stay coherent. */
export function senderForUser(userId: number): Sender {
  return SENDERS[Math.abs(Math.trunc(userId)) % SENDERS.length] as Sender;
}

/** Configure the no-reader identity because changing it is a deployment decision, not a copy choice. */
export function configuredSender(): { email: string; name: string } {
  return { email: config.LIFECYCLE_FROM_EMAIL, name: config.LIFECYCLE_FROM_NAME };
}

/** The `From` display name. Their own name, not the product's, because that is the point. */
export function fromNameFor(sender: Sender): string {
  return `${sender.name} from Nadeshiko`;
}
