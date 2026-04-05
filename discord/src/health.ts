import { createServer } from 'node:http';
import { createLogger } from './logger';

const log = createLogger('health');

export function startHealthServer(port = 3000) {
  const server = createServer((req, res) => {
    if (req.url === '/up') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  server.listen(port, () => {
    log.info({ port }, 'Health check server listening');
  });

  return server;
}
