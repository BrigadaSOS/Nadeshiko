import { getNadeshikoSdkClient } from '~~/server/utils/nadeshikoSdk';

export default defineEventHandler(async (event) => {
  const body = await readBody(event);
  const { uuid, textJa, textEn, textEs, status, isNsfw } = body;

  if (!uuid) {
    throw createError({ statusCode: 400, statusMessage: 'uuid is required' });
  }

  const sdk = getNadeshikoSdkClient();

  const { data: segment } = await sdk.segmentShowByUuid({ path: { uuid } });
  if (!segment) {
    throw createError({ statusCode: 404, statusMessage: 'Segment not found' });
  }

  const { data } = await sdk.segmentUpdate({
    path: {
      mediaId: segment.mediaId,
      episodeNumber: segment.episode,
      id: segment.id,
    },
    body: {
      ...(textJa !== undefined && { textJa: { content: textJa } }),
      ...(textEn !== undefined && {
        textEn: { content: textEn.content, isMachineTranslated: textEn.isMachineTranslated },
      }),
      ...(textEs !== undefined && {
        textEs: { content: textEs.content, isMachineTranslated: textEs.isMachineTranslated },
      }),
      ...(status !== undefined && { status }),
      ...(isNsfw !== undefined && { isNsfw }),
    },
  });

  return data;
});
