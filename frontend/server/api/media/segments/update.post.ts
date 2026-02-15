import { getNadeshikoSdkClient, unwrapSdkResult } from '~~/server/utils/nadeshikoSdk';

export default defineEventHandler(async (event) => {
  const body = await readBody(event);
  const { uuid, ja, en, es, status, isNsfw } = body;

  if (!uuid) {
    throw createError({ statusCode: 400, statusMessage: 'uuid is required' });
  }

  const sdk = getNadeshikoSdkClient();

  // Step 1: Resolve UUID to segment ID, mediaId, and episode number
  const segmentResult = await sdk.segmentShowByUuid({ path: { uuid } });
  const segment = unwrapSdkResult('segmentShowByUuid', segmentResult);

  // Step 2: Update the segment via PATCH
  const updateResult = await sdk.segmentUpdate({
    path: {
      mediaId: segment.mediaId,
      episodeNumber: segment.episode,
      id: segment.id,
    },
    body: {
      ...(ja !== undefined && { ja: { content: ja } }),
      ...(en !== undefined && { en: { content: en.content, isMachineTranslated: en.isMachineTranslated } }),
      ...(es !== undefined && { es: { content: es.content, isMachineTranslated: es.isMachineTranslated } }),
      ...(status !== undefined && { status }),
      ...(isNsfw !== undefined && { isNsfw }),
    },
  });

  return unwrapSdkResult('segmentUpdate', updateResult);
});
