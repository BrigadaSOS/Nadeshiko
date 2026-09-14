interface AniListMediaResponse {
  data?: {
    Media?: {
      title?: { english?: string | null; romaji?: string | null };
      coverImage?: { extraLarge?: string | null };
      siteUrl?: string | null;
    } | null;
  };
}

export interface AniListMediaMetadata {
  title: string;
  coverUrl: string;
  siteUrl: string;
}

const ANILIST_MEDIA_URL = /^https?:\/\/(?:www\.)?anilist\.co\/anime\/(\d+)(?:\/[^?#]*)?(?:[?#].*)?$/i;
const ANILIST_COVER_URL = /^https:\/\/s4\.anilist\.co\/file\/anilistcdn\/media\/anime\/cover\//;

/**
 * Resolve canonical AniList anime links. Metadata is presentation sugar:
 * proposals must still work if AniList is unavailable, so failures fall back
 * to the URL-derived title and no cover in the caller.
 */
export async function getAniListMediaMetadata(sourceUrl: string): Promise<AniListMediaMetadata | null> {
  const id = ANILIST_MEDIA_URL.exec(sourceUrl)?.[1];
  if (!id) return null;

  try {
    const response = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        query:
          'query ($id: Int!) { Media(id: $id, type: ANIME) { title { english romaji } coverImage { extraLarge } siteUrl } }',
        variables: { id: Number(id) },
      }),
      signal: AbortSignal.timeout(4_000),
    });
    if (!response.ok) return null;

    const media = ((await response.json()) as AniListMediaResponse).data?.Media;
    const title = media?.title?.english || media?.title?.romaji;
    const coverUrl = media?.coverImage?.extraLarge;
    const siteUrl = media?.siteUrl;
    if (!title || !coverUrl || !siteUrl || !ANILIST_COVER_URL.test(coverUrl)) return null;
    return { title, coverUrl, siteUrl };
  } catch {
    return null;
  }
}
