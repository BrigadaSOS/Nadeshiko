/** Keep the `x-server-only` marker, proxy refusal list, and `isInternalProxyRequest` checks in agreement: a missing
 * marker leaves a secret-checked route reachable, while an unused marker overclaims enforcement. */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { resolve, join } from 'path';
import { listOperations, loadBundledSpec } from '../../bin/lib/spec';
import { isServerOnly } from '../../bin/generateServerOnlyRoutes';

const DENYLIST_FILE = resolve(import.meta.dirname, '../../../frontend/server/utils/generated/serverOnlyRoutes.ts');
const CONTROLLERS_DIR = resolve(import.meta.dirname, '../../app/controllers');

const spec = loadBundledSpec();
const operations = listOperations(spec);
const serverOnlyOperations = operations.filter(isServerOnly);

function describeOperation(op: (typeof operations)[number]): string {
  return `${op.method.toUpperCase()} ${op.path} (${op.operationId ?? 'unknown'})`;
}

/** Find every exported handler whose body calls `isInternalProxyRequest`; this coarse operationId scan catches a new
 * server-only route that forgot the marker. */
function handlersCheckingInternalProxy(): Set<string> {
  const found = new Set<string>();
  for (const file of readdirSync(CONTROLLERS_DIR)) {
    if (!file.endsWith('.ts')) continue;
    const source = readFileSync(join(CONTROLLERS_DIR, file), 'utf8');
    if (!source.includes('isInternalProxyRequest(')) continue;

    // `export const <name>: <Type> = async (...) => { ... }` up to the next export.
    for (const match of source.matchAll(/export const (\w+)\s*:[^=]*=\s*async[\s\S]*?(?=\nexport const |\n*$)/g)) {
      if (match[0].includes('isInternalProxyRequest(')) found.add(match[1]);
    }
  }
  return found;
}

describe('server-only routes agree with the controllers and the proxy', () => {
  it('marks at least one route', () => {
    expect(serverOnlyOperations.length).toBeGreaterThan(0);
  });

  it('every marked route is internal and session-gated', () => {
    // A server-only route is not public and is reached with the reader cookie relayed by our server, so it requires a
    // session.
    const offenders = serverOnlyOperations
      .filter((op) => !op.isInternal || !op.security?.some((requirement) => 'SessionCookie' in requirement))
      .map(describeOperation);

    expect(offenders).toEqual([]);
  });

  it('every marked route has a controller that checks the internal secret, and vice versa', () => {
    const checking = handlersCheckingInternalProxy();
    const marked = new Set(serverOnlyOperations.map((op) => op.operationId ?? ''));

    const markedButUnchecked = [...marked].filter((id) => !checking.has(id)).sort();
    const checkedButUnmarked = [...checking].filter((id) => !marked.has(id)).sort();

    expect(markedButUnchecked, 'x-server-only routes whose controller does not check isInternalProxyRequest').toEqual(
      [],
    );
    expect(checkedButUnmarked, 'controllers checking isInternalProxyRequest whose route lacks x-server-only').toEqual(
      [],
    );
  });

  it('the committed proxy deny list matches what the spec derives', () => {
    const committed = [...readFileSync(DENYLIST_FILE, 'utf8').matchAll(/\{ method: '(\w+)', path: '([^']+)' \}/g)]
      .map((match) => `${match[1]} ${match[2]}`)
      .sort();

    const derived = serverOnlyOperations.map((op) => `${op.method.toUpperCase()} ${op.path}`).sort();

    expect(committed).toEqual(derived);
  });
});
