import express from 'express';
import http from 'http';

// Test: res.on('finish') registered in route handler A, response sent from route handler B
const app = express();
const router = express.Router();
let finishFired = false;

// Mimics routeAuth: router.get(path, requireAuth) where requireAuth registers finish listener
router.get('/v1/media', (req, res, next) => {
  console.log('Handler A: registering finish listener');
  res.on('finish', () => {
    finishFired = true;
    console.log('FINISH EVENT FIRED from handler A listener, statusCode:', res.statusCode);
  });
  next();
});

// Mimics generated MediaRoutes
const mediaRouter = express.Router();
mediaRouter.get('/v1/media', (_req, res) => {
  console.log('Handler B: sending response');
  res.status(200).json({ items: [] });
});

router.use('/', mediaRouter);
app.use('/', router);

const server = http.createServer(app);
await new Promise<void>((resolve) => server.listen(0, resolve));
const port = (server.address() as any).port;

const res = await fetch('http://localhost:' + port + '/v1/media');
console.log('Response status:', res.status);

await new Promise((r) => setTimeout(r, 500));

console.log('finish fired:', finishFired);

server.close();
process.exit(finishFired ? 0 : 1);
