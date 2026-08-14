/**
 * How a title is written in the account's media tables.
 *
 * Extracted because three panels render the same two strings from the same
 * shape -- the lookup rows, the favorites list and the hidden list -- and they
 * had drifted into three copies with two different fallback keys saying the same
 * `Media #{id}`.
 */
import type { MediaNameLanguage } from '~/utils/mediaNames';
import { secondaryMediaNames as computeSecondaryNames } from '~/utils/mediaNames';

export type NamedMedia = {
  publicId?: string;
  mediaPublicId?: string;
  nameEn?: string;
  nameJa?: string;
  nameRomaji?: string;
};

export function useMediaDisplayName() {
  const { t } = useI18n();
  const { mediaName, language } = useMediaName();

  const toMediaNameArgs = (media: NamedMedia) => ({
    nameEn: media.nameEn || '',
    nameJa: media.nameJa || '',
    nameRomaji: media.nameRomaji || '',
  });

  /** The title in the reader's preferred language, or its id if it has no name at all. */
  const displayMediaName = (media: NamedMedia): string =>
    mediaName(toMediaNameArgs(media)) ||
    t('accountSettings.account.mediaFallback', { id: media.publicId ?? media.mediaPublicId ?? '-' });

  /** Every other name it goes by, so a title is recognisable when the preferred one isn't. */
  const secondaryMediaNames = (media: NamedMedia): string =>
    computeSecondaryNames(media, language.value as MediaNameLanguage).join(' | ');

  return { displayMediaName, secondaryMediaNames };
}
