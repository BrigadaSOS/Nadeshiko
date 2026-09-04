import { realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';

/** True only when `candidate` is the directory itself or a descendant of `base`. */
export function isPathInside(base: string, candidate: string): boolean {
  const pathFromBase = relative(base, candidate);
  return (
    pathFromBase === '' || (!pathFromBase.startsWith(`..${sep}`) && pathFromBase !== '..' && !isAbsolute(pathFromBase))
  );
}

/**
 * Resolves an existing media file, rejecting both lexical traversal and a
 * symlink under the media directory that points outside it.
 */
export async function resolveMediaFilePath(mediaBasePath: string, requestPath: string): Promise<string> {
  const candidate = resolve(mediaBasePath, requestPath);
  if (!isPathInside(mediaBasePath, candidate)) {
    throw new MediaPathForbiddenError();
  }

  const [realMediaBasePath, realFilePath] = await Promise.all([realpath(mediaBasePath), realpath(candidate)]);
  if (!isPathInside(realMediaBasePath, realFilePath)) {
    throw new MediaPathForbiddenError();
  }

  return realFilePath;
}

export class MediaPathForbiddenError extends Error {}
