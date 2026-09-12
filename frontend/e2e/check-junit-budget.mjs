import { readFile } from 'node:fs/promises';

const reportPath = process.argv[2] ?? 'test-results/e2e-results.xml';
const maxSkips = Number.parseInt(process.argv[3] ?? '', 10);

if (!Number.isInteger(maxSkips) || maxSkips < 0) {
  throw new Error('Usage: node e2e/check-junit-budget.mjs <junit-report> <maximum-skips>');
}

const xml = await readFile(reportPath, 'utf8');
const skipped = [...xml.matchAll(/<testcase\b([^>]*)>([\s\S]*?)<\/testcase>/g)]
  .filter(([, , body]) => /<skipped\b/.test(body))
  .map(([, attributes]) => attributes.match(/\bname="([^"]*)"/)?.[1] ?? '(unnamed test)');

console.log(`E2E skip budget: ${skipped.length}/${maxSkips}`);
for (const name of skipped) console.log(`  skipped: ${name}`);

if (skipped.length > maxSkips) {
  throw new Error(`E2E skipped ${skipped.length} tests, exceeding the approved budget of ${maxSkips}`);
}
