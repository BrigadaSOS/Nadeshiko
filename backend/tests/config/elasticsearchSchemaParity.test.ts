import { describe, it, expect } from 'vitest';
import elasticsearchSchema from 'config/elasticsearch-schema.json';
import type { SegmentDocumentShape } from '@app/services/search/SegmentDocument';

/** The mapping defaults to `dynamic: true`, so unmapped document fields can silently become analyzed text. This
 * parity check prevents identifier fields from drifting into searchable mappings. */

// Type the key list as `SegmentDocumentShape`: extra document fields fail compilation here, while missing mapping keys
// fail this test.
const REPRESENTATIVE_DOCUMENT: Required<SegmentDocumentShape> = {
  uuid: 'uuid',
  publicId: 'publicId',
  position: 0,
  status: 'ACTIVE',
  startTimeMs: 0,
  endTimeMs: 1,
  durationMs: 1,
  textJa: '',
  characterCount: 0,
  textEs: '',
  textEsMt: false,
  textEn: '',
  textEnMt: false,
  contentRating: 'SAFE',
  storage: '',
  hashedId: '',
  category: 'ANIME',
  episode: 1,
  externalVideoId: null,
  mediaId: 1,
  storageBasePath: '',
  tokens: [],
};

describe('elasticsearch schema parity', () => {
  const mappedFields = Object.keys(elasticsearchSchema.mappings.properties).sort();
  const documentFields = Object.keys(REPRESENTATIVE_DOCUMENT).sort();

  it('maps every field the indexer writes', () => {
    const unmapped = documentFields.filter((field) => !mappedFields.includes(field));
    expect(unmapped, `Written to every document but absent from the mapping: ${unmapped.join(', ')}`).toEqual([]);
  });

  it('does not map fields the indexer never writes', () => {
    const unwritten = mappedFields.filter((field) => !documentFields.includes(field));
    expect(unwritten, `Mapped but never written, so dead weight: ${unwritten.join(', ')}`).toEqual([]);
  });

  it('keeps identifier fields unindexed, since none of them are queried', () => {
    // These are returned in _source and never searched on. Indexing them costs
    // index size and indexing CPU on every segment for nothing.
    const properties = elasticsearchSchema.mappings.properties as Record<string, { type?: string; index?: boolean }>;

    for (const field of ['publicId', 'externalVideoId', 'hashedId', 'storageBasePath']) {
      expect(properties[field], `${field} should be mapped`).toBeDefined();
      expect(properties[field]?.type, `${field} should be a keyword, not analysed text`).toBe('keyword');
      expect(properties[field]?.index, `${field} is never queried, so it should not be indexed`).toBe(false);
    }
  });
});
