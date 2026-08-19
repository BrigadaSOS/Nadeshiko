/**
 * Pins the `x-server-only` marker to the two things it has to agree with.
 *
 * The marker generates the frontend proxy's refusal list, and it exists because
 * the proxy stamps the internal secret onto every browser request it relays --
 * so a backend controller checking that secret (`isInternalProxyRequest`) is
 * only actually server-only if the proxy ALSO refuses the route. A controller
 * that checks the secret without the marker is a door left open; a marker on a
 * route the controller does not check is a claim the backend does not enforce.
 * Both are found by reading the controllers, and neither would fail any other
 * test.
 */
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

/**
 * Every exported handler that calls `isInternalProxyRequest`, by operationId.
 * The handlers are named after their operationId (the generated router imports
 * them by that name), so a handler body that mentions the check is the
 * operation that enforces it. Coarse -- a text scan -- but the alternative is
 * executing every controller with a fake request, and coarse is enough to
 * catch a new server-only route whose author forgot the marker.
 */
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
    // Server-only is a stricter claim than internal: a route the proxy will not
    // forward has no business in the public spec, and it is reached with the
    // reader's cookie relayed by our own server, so a session is what it takes.
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
