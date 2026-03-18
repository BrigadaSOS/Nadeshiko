import { AppDataSource } from './config/database';
import { AccountQuotaUsage } from './app/models/AccountQuotaUsage';
import { buildApplication } from './config/application';
import { auth } from './config/auth';
import { User } from './app/models';

await AppDataSource.initialize();
await AppDataSource.query('DELETE FROM "AccountQuotaUsage"');

const user = await User.findOne({ where: {} });
console.log('User:', user?.id);

// Create a key via better-auth internal API
const keyRes = await (auth.api as any).createApiKey({
  body: { name: 'quota-test-key', permissions: { api: ['READ_MEDIA'] } },
  headers: new Headers(),
  _context: { userId: String(user!.id) },
});
const apiKey = keyRes?.key;
console.log('Created key:', apiKey ? `${apiKey.slice(0, 8)}...` : 'FAILED');

if (!apiKey) {
  await AppDataSource.destroy();
  process.exit(1);
}

const app = buildApplication();
const server = app.listen(0, async () => {
  try {
    const port = (server.address() as any).port;

    const res = await fetch('http://localhost:' + port + '/v1/media', {
      headers: { 'Authorization': 'Bearer ' + apiKey },
    });
    console.log('Response status:', res.status);

    // Wait for finish callback and async increment
    await new Promise((r) => setTimeout(r, 1500));

    const rows = await AppDataSource.query('SELECT * FROM "AccountQuotaUsage"');
    console.log('AccountQuotaUsage rows:', JSON.stringify(rows, null, 2));

    if (rows.length === 0) {
      console.log('BUG CONFIRMED: finish callback did not increment quota');
    } else {
      console.log('OK: quota was incremented');
    }
  } finally {
    // Clean up
    await AppDataSource.query("DELETE FROM \"apikey\" WHERE \"name\" = 'quota-test-key'");
    server.close();
    await AppDataSource.destroy();
  }
});
