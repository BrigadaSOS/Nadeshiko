import { getNadeshikoUserClient } from '~~/server/utils/nadeshikoSdk';

type ReportStatus = 'PENDING' | 'CONCERN' | 'ACCEPTED' | 'REJECTED' | 'RESOLVED' | 'IGNORED';

function parseNumber(value: unknown): number | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseStatus(value: unknown): ReportStatus | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  return value === 'PENDING' ||
    value === 'CONCERN' ||
    value === 'ACCEPTED' ||
    value === 'REJECTED' ||
    value === 'RESOLVED' ||
    value === 'IGNORED'
    ? value
    : undefined;
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const sdk = getNadeshikoUserClient(event);
  const limit = parseNumber(query.limit ?? query.size);
  const cursor = parseNumber(query.cursor);
  const status = parseStatus(query.status);

  const { data } = await sdk.listUserReports({
    query: {
      limit,
      cursor,
      status,
    },
  });
  return data;
});
