import type { DataSource } from 'typeorm';

interface CategoryFilteredQueryOpts {
  sql: string;
  params?: unknown[];
  category?: string;
  suffix?: string;
  suffixParams?: unknown[];
}

export async function runCategoryFilteredQuery(
  dataSource: DataSource,
  opts: CategoryFilteredQueryOpts,
): Promise<unknown[]> {
  const params = opts.params ? [...opts.params] : [];
  let query = opts.sql;

  if (opts.category) {
    query += ` AND m.category = $${params.length + 1}`;
    params.push(opts.category);
  }

  if (opts.suffix) {
    let suffix = opts.suffix;
    if (opts.suffixParams) {
      for (const p of opts.suffixParams) {
        suffix = suffix.replace('$NEXT', `$${params.length + 1}`);
        params.push(p);
      }
    }
    query += ` ${suffix}`;
  }

  return dataSource.query(query, params);
}
