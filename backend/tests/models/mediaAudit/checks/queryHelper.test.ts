import { describe, it, expect } from 'bun:test';
import { setupTestSuite, TestDataSource } from '../../../helpers/setup';
import { runCategoryFilteredQuery } from '@app/models/mediaAudit/checks/queryHelper';

setupTestSuite();

describe('runCategoryFilteredQuery', () => {
  it('executes plain SQL without category or suffix', async () => {
    const rows = await runCategoryFilteredQuery(TestDataSource, {
      sql: `SELECT 1 AS "value"`,
    });

    expect(rows).toEqual([{ value: 1 }]);
  });

  it('appends category filter when category is provided', async () => {
    const rows = await runCategoryFilteredQuery(TestDataSource, {
      sql: `
        SELECT m.id
        FROM "Media" m
        WHERE 1=1
      `,
      category: 'ANIME',
    });

    // No media seeded, so should be empty — the point is it doesn't error
    expect(rows).toEqual([]);
  });

  it('appends suffix after category filter', async () => {
    const rows = await runCategoryFilteredQuery(TestDataSource, {
      sql: `SELECT 1 AS "value" WHERE true`,
      suffix: `AND 1 = 1`,
    });

    expect(rows).toEqual([{ value: 1 }]);
  });

  it('handles params correctly without category', async () => {
    const rows = await runCategoryFilteredQuery(TestDataSource, {
      sql: `SELECT $1::int AS "value" WHERE true`,
      params: [42],
    });

    expect(rows).toEqual([{ value: 42 }]);
  });

  it('handles params correctly with category', async () => {
    const rows = await runCategoryFilteredQuery(TestDataSource, {
      sql: `
        SELECT m.id
        FROM "Media" m
        WHERE 1=1
          AND m.id = $1
      `,
      params: [-999],
      category: 'ANIME',
    });

    expect(rows).toEqual([]);
  });

  it('replaces $NEXT placeholders in suffix with correct param indices', async () => {
    const rows = await runCategoryFilteredQuery(TestDataSource, {
      sql: `SELECT $1::int AS "a" WHERE true`,
      params: [10],
      suffix: `AND $NEXT::int > 0`,
      suffixParams: [5],
    });

    expect(rows).toEqual([{ a: 10 }]);
  });

  it('replaces multiple $NEXT placeholders in suffix', async () => {
    const rows = await runCategoryFilteredQuery(TestDataSource, {
      sql: `SELECT $1::int AS "a" WHERE true`,
      params: [1],
      suffix: `AND $NEXT::int > 0 AND $NEXT::int > 0`,
      suffixParams: [2, 3],
    });

    expect(rows).toEqual([{ a: 1 }]);
  });

  it('handles suffixParams with category (param indices shift)', async () => {
    const rows = await runCategoryFilteredQuery(TestDataSource, {
      sql: `
        SELECT m.id
        FROM "Media" m
        WHERE 1=1
      `,
      category: 'ANIME',
      suffix: `LIMIT $NEXT`,
      suffixParams: [0],
    });

    expect(rows).toEqual([]);
  });
});
