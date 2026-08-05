export interface PaginationMeta {
  hasMore: boolean;
  cursor: string | null;
}

/**
 * Async generator that iterates through all pages of a paginated endpoint,
 * yielding individual items.
 *
 * @example
 * ```ts
 * for await (const segment of paginate(
 *   (opts) => client.search(opts),
 *   { body: { query: { search: '猫' } } },
 *   (data) => ({ items: data.segments, pagination: data.pagination }),
 * )) {
 *   console.log(segment);
 * }
 * ```
 */
export async function* paginate<TData, TItem>(
  fn: (options: any) => Promise<{ data: TData } | { error: unknown }>,
  options: Record<string, any>,
  extract: (data: TData) => { items: TItem[]; pagination: PaginationMeta },
): AsyncGenerator<TItem, void, unknown> {
  let cursor: string | null = null;
  let first = true;

  while (true) {
    const callOptions = first ? options : patchCursor(options, cursor!);
    first = false;

    const result = await fn(callOptions);

    if ('error' in result && result.error !== undefined) {
      throw result.error;
    }

    const { items, pagination } = extract((result as { data: TData }).data);

    for (const item of items) {
      yield item;
    }

    if (!pagination.hasMore || pagination.cursor === null) break;
    cursor = pagination.cursor;
  }
}

function patchCursor(options: Record<string, any>, cursor: string): Record<string, any> {
  if (options.body !== undefined) {
    return { ...options, body: { ...options.body, cursor } };
  }
  if (options.query !== undefined) {
    return { ...options, query: { ...options.query, cursor } };
  }
  return { ...options, body: { cursor } };
}

/**
 * Async generator for paginating with flattened parameters.
 * Unlike `paginate()`, this merges the cursor directly into the flat params
 * object, then passes the result to `fn` which repacks into the SDK call format.
 *
 * Used by the `client.search.paginate()` built-in pagination.
 */
export async function* flatPaginate<TData, TItem>(
  params: Record<string, any>,
  fn: (flatParams: Record<string, any>) => Promise<{ data: TData } | { error: unknown }>,
  extract: (data: TData) => { items: TItem[]; pagination: PaginationMeta },
): AsyncGenerator<TItem, void, unknown> {
  let cursor: string | null = null;
  let first = true;

  while (true) {
    const flat = first ? params : { ...params, cursor: cursor! };
    first = false;

    const result = await fn(flat);

    if ('error' in result && result.error !== undefined) {
      throw result.error;
    }

    const { items, pagination } = extract((result as { data: TData }).data);

    for (const item of items) {
      yield item;
    }

    if (!pagination.hasMore || pagination.cursor === null) break;
    cursor = pagination.cursor;
  }
}
