import supertest from 'supertest';
import type TestAgent from 'supertest/lib/agent';
import { afterAll } from 'vitest';
import type { Application } from 'express';
import type { Server } from 'http';

/**
 * Drop-in replacement for `supertest` that binds one server per app.
 *
 * Plain `supertest(app)` starts a fresh ephemeral server for every single
 * request and closes it afterwards. Across a full suite that is thousands of
 * bind/close cycles, and the kernel reuses ports faster than the closed sockets
 * drain -- so a request occasionally lands on a port that now belongs to a
 * different test file's server. That showed up three ways, all of them looking
 * like unrelated flakes:
 *
 *   - ETIMEDOUT / ECONNRESET, when the port had no live listener
 *   - `expected 404 to be 401`, when the request reached the *wrong* app
 *
 * Memoizing the server per app makes it one bind per app instead of one per
 * request, which removes the churn that causes all three.
 *
 * Usage: replace `import request from 'supertest'` with
 * `import { request } from '../helpers/http'`. Call sites need no changes.
 */
// A Map, not a WeakMap: closing a server must also evict its memo entry, or a
// later request would be handed a closed server whose port the kernel has since
// reassigned -- which is how a request ends up answered by a different app.
const serversByApp = new Map<Application, Server>();

export function request(target: Application | Server): TestAgent {
  // An Express app is callable; an http.Server is not. Anything already
  // listening is handed straight through -- supertest reuses its address.
  if (typeof target !== 'function') {
    return supertest(target as Server);
  }

  const app = target as Application;
  let server = serversByApp.get(app);
  if (!server?.listening) {
    server = app.listen(0);
    serversByApp.set(app, server);
  }

  return supertest(server);
}

/** Closes every server this module opened. Registered automatically per test file. */
export async function closeTestServers(): Promise<void> {
  const pending = [...serversByApp.values()];
  serversByApp.clear();

  await Promise.all(
    pending.map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    ),
  );
}

// Self-registering, so importing this helper is the only step a test file takes.
afterAll(closeTestServers);

export default request;
