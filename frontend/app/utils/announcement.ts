/**
 * The heading above a system announcement, by type.
 *
 * Shared because the public banner and the admin preview have to agree: the
 * preview exists to show an admin what visitors will see, and it stopped being
 * true once the two drifted -- the preview read from the locale files while the
 * banner had the three English strings hardcoded, so every announcement went
 * out with an English heading on /es and /ja while the preview promised
 * otherwise.
 */
export function announcementTitle(t: (key: string) => string, type: string | null | undefined): string {
  switch (type) {
    case 'WARNING':
      return t('announcementBanner.titles.WARNING');
    case 'MAINTENANCE':
      return t('announcementBanner.titles.MAINTENANCE');
    default:
      return t('announcementBanner.titles.INFO');
  }
}
