/**
 * Traffic classification, re-exported so `@lib/traffic` keeps meaning what it
 * always meant to the ~8 call sites that import it.
 *
 * The rules themselves live in `@brigadasos/nadeshiko-shared/traffic`, which the
 * frontend reads too. They used to be a byte-identical copy of that file kept in
 * step by hand and policed by a drift test; see the header there for why one
 * copy was worth the workspace package.
 */
export * from '@brigadasos/nadeshiko-shared/traffic';
