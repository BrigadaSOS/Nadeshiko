import supertest from 'supertest';
import type TestAgent from 'supertest/lib/agent';
import { afterAll } from 'vitest';
import type { Application } from 'express';
import type { Server } from 'http';

/** Drop-in `supertest` replacement that memoizes one server per app. Fresh bind/close cycles can reuse draining
 * ports across suites and surface as timeouts, resets, or responses from the wrong app. Callers keep the same
 * request API. */
// Use a Map, not a WeakMap: closing a server must evict its entry or later requests may use a closed port that the
// kernel reassigned to another app.
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
