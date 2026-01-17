/**
 * Filesystem operation wrappers that throw custom exceptions, to provide
 * consistent error handling across the codebase
 */

import fs from 'fs';
import path from 'path';
import { PathLike, MakeDirectoryOptions } from 'fs';
import { BadRequest, NotFound } from './error';

/**
 * Safely join path segments with a base directory, preventing path traversal.
 */
export function safePath(baseDir: string, ...segments: string[]): string {
  const resolvedBase = path.resolve(baseDir);
  const joined = path.join(resolvedBase, ...segments);
  const resolved = path.resolve(joined);

  // Ensure the resolved path starts with the base directory
  // Adding path.sep ensures we don't match partial directory names
  // e.g., /media-backup shouldn't match base /media
  if (!resolved.startsWith(resolvedBase + path.sep) && resolved !== resolvedBase) {
    throw new BadRequest('Invalid path');
  }

  return resolved;
}

function handleFsPermissionError(err: unknown, context: string): never {
  if (err instanceof Error && (err as NodeJS.ErrnoException).code === 'EACCES') {
    throw new Error(`Filesystem permission denied: ${context}`);
  }
  throw err;
}

export function statSync(path: PathLike, notFoundMessage?: string): fs.Stats {
  try {
    return fs.statSync(path);
  } catch (err) {
    const message = notFoundMessage ?? `Path not found: ${path}`;
    handleFsNotFound(err, message);
  }
}

export function readFileSync(
  path: PathLike,
  options?: { encoding?: BufferEncoding | null; flag?: string } | BufferEncoding,
  notFoundMessage?: string,
): string | Buffer {
  try {
    return fs.readFileSync(path, options);
  } catch (err) {
    const message = notFoundMessage ?? `File not found: ${path}`;
    handleFsNotFound(err, message);
  }
}

export function readdirSync(
  path: PathLike,
  options?: { encoding?: BufferEncoding | null; withFileTypes?: true; recursive?: boolean },
  notFoundMessage?: string,
): fs.Dirent[];
export function readdirSync(
  path: PathLike,
  options?: { encoding?: BufferEncoding | null; withFileTypes?: false; recursive?: boolean } | BufferEncoding | null,
  notFoundMessage?: string,
): string[];
export function readdirSync(
  path: PathLike,
  options?:
    | ({ encoding?: BufferEncoding | null; withFileTypes?: boolean; recursive?: boolean } | BufferEncoding | null)
    | undefined,
  notFoundMessage?: string,
): string[] | fs.Dirent[] {
  try {
    return fs.readdirSync(path, options as any);
  } catch (err) {
    const message = notFoundMessage ?? `Directory not found: ${path}`;
    handleFsNotFound(err, message);
  }
}

export function existsSync(path: PathLike): boolean {
  return fs.existsSync(path);
}

export function mkdirSync(path: PathLike, options?: MakeDirectoryOptions): void {
  try {
    fs.mkdirSync(path, options);
  } catch (err) {
    handleFsPermissionError(err, `Failed to create directory: ${path}`);
  }
}

export function createReadStream(path: PathLike, options?: { encoding?: BufferEncoding; flag?: string }): fs.ReadStream;
export function createReadStream(path: PathLike, options?: BufferEncoding): fs.ReadStream;
export function createReadStream(
  path: PathLike,
  options?: { encoding?: BufferEncoding; flag?: string } | BufferEncoding,
): fs.ReadStream {
  return fs.createReadStream(path, options);
}

export function handleFsNotFound(err: unknown, notFoundMessage: string): never {
  if (err instanceof Error && (err as NodeJS.ErrnoException).code === 'ENOENT') {
    throw new NotFound(notFoundMessage);
  }
  throw err;
}
