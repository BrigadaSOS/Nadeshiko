/**
 * Whether the title card starts open or closed.
 *
 * The card is a disclosure: a single line -- thumbnail, title, sentence and
 * episode counts -- with the alternate names, studio, season, genres and
 * catalogue links folded underneath it. Anyone can open and close it from the
 * card itself, signed in or not; this decides only which way it starts.
 *
 * It exists because the card is context for a page whose actual subject is the
 * sentence list below it, and at its old fixed size on a phone it filled ~285px
 * of an 844px viewport -- enough that the first sentence started below the fold,
 * so every visit to a title began with the same scroll. Readers who came for the
 * sentences said so.
 *
 * `OPEN` stays the default. The details are the only thing on `/media/<slug>`
 * that describes the work in prose, and someone arriving from a search engine
 * has not seen them before -- so starting closed is a choice a returning reader
 * makes, not something taken from everybody.
 *
 * A STORED preference, not a cookie, which is the opposite of what furigana and
 * motion do. Those are cookies because a signed-out reader has to be able to set
 * them and because the server has to read them before it renders. Only the
 * second half applies here, and the session already carries the answer:
 * `get-session` returns `user.preferences` (see `plugins/identity-auth.ts`), so
 * the card starts the right way in the first byte of HTML with no cookie
 * involved. Adding one would have bought nothing and cost something real --
 * every name in `RENDER_FORKING_PREFERENCE_COOKIES` drops the reader carrying it
 * out of the shared HTML cache tier, and a signed-in render is `personal` there
 * already. Signed-out readers start `OPEN`, which also keeps every anonymous
 * render of a title page byte-identical.
 */
export const MEDIA_CARD_DEFAULTS = ['OPEN', 'CLOSED'] as const;
export type MediaCardDefault = (typeof MEDIA_CARD_DEFAULTS)[number];

export const DEFAULT_MEDIA_CARD_DEFAULT: MediaCardDefault = 'OPEN';

export function useMediaCardDefault() {
  const user = userStore();

  const preference = computed<MediaCardDefault>(() => {
    if (!user.isLoggedIn) return DEFAULT_MEDIA_CARD_DEFAULT;
    return user.preferences?.mediaCardDefault === 'CLOSED' ? 'CLOSED' : DEFAULT_MEDIA_CARD_DEFAULT;
  });

  /** The same answer as a boolean, which is the shape the card actually seeds from. */
  const startsOpen = computed(() => preference.value === 'OPEN');

  return { preference, startsOpen };
}
