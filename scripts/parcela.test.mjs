import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { applyParcelaTestEnvironment } from '../backend/config/parcela.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = parse(readFileSync(join(root, 'parcela.yaml'), 'utf8'));

function withDirectory(run) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'nadeshiko-parcela-')));
  try {
    run(directory);
  } finally {
    rmSync(directory, { recursive: true });
  }
}

test("tests reach this environment's containers with the admin logins they were created with", () => {
  withDirectory((backend) => {
    writeFileSync(
      join(backend, '.env'),
      'POSTGRES_ADMIN_USER=admin\nPOSTGRES_ADMIN_PASSWORD=pg-secret\nELASTICSEARCH_ADMIN_PASSWORD=es-secret\nPOSTGRES_DB=nadedb\n',
    );
    const environment = {
      PARCELA_PORT_POSTGRES: '24001',
      PARCELA_PORT_ELASTICSEARCH: '24002',
      POSTGRES_HOST: 'localhost',
      POSTGRES_PORT: '5432',
      POSTGRES_ADMIN_USER: 'postgres',
      POSTGRES_DB: 'nadeshiko_test',
      ELASTICSEARCH_HOST: 'http://localhost:9200',
      ELASTICSEARCH_INDEX: 'nadedb_test',
    };
    applyParcelaTestEnvironment(environment, backend);
    assert.deepEqual(environment, {
      PARCELA_PORT_POSTGRES: '24001',
      PARCELA_PORT_ELASTICSEARCH: '24002',
      POSTGRES_HOST: '127.0.0.1',
      POSTGRES_PORT: '24001',
      POSTGRES_ADMIN_HOST: '127.0.0.1',
      POSTGRES_ADMIN_PORT: '24001',
      POSTGRES_ADMIN_DB: 'postgres',
      POSTGRES_ADMIN_USER: 'admin',
      POSTGRES_ADMIN_PASSWORD: 'pg-secret',
      POSTGRES_DB: 'nadeshiko_test',
      ELASTICSEARCH_HOST: 'http://127.0.0.1:24002',
      ELASTICSEARCH_ADMIN_PASSWORD: 'es-secret',
      ELASTICSEARCH_INDEX: 'nadedb_test',
    });
  });
});

test('outside Parcela the test environment is unchanged', () => {
  const environment = { POSTGRES_HOST: 'localhost', POSTGRES_PORT: '5432' };
  applyParcelaTestEnvironment(environment, '/nonexistent');
  assert.deepEqual(environment, { POSTGRES_HOST: 'localhost', POSTGRES_PORT: '5432' });
});

test('nothing Parcela runs deletes data or starts Discord', () => {
  assert.doesNotMatch(JSON.stringify(manifest), /discord|db:setup|db:reset|down -v|volume rm/);
});

test("validation refuses to run outside an environment's own containers", () => {
  const result = spawnSync(
    process.execPath,
    ['--import', import.meta.resolve('tsx'), join(root, 'scripts/parcela-validate.ts')],
    { encoding: 'utf8', env: { PATH: process.env.PATH } },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /parcela task validate/);
});

test('Nuxt rendering forks keep the TLS and DNS options from parcela.yaml', () => {
  withDirectory((source) => {
    const nodeOptions = manifest.services.frontend.env.NODE_OPTIONS;
    const cliDirectory = dirname(fileURLToPath(import.meta.resolve('@nuxt/cli')));
    const poolSource = readdirSync(cliDirectory)
      .filter((name) => /^dev-.*\.mjs$/.test(name))
      .map((name) => readFileSync(join(cliDirectory, name), 'utf8'))
      .find((text) => text.includes('var ForkPool = class'));
    assert.ok(poolSource, 'installed Nuxt ForkPool implementation is required');
    const start = poolSource.indexOf('var ForkPool = class');
    const end = poolSource.indexOf('//#endregion', start);
    assert.ok(end > start);
    const child = join(source, 'child.mjs');
    writeFileSync(
      child,
      `import {getDefaultResultOrder} from 'node:dns';
import {getCACertificates} from 'node:tls';
import {createHash} from 'node:crypto';
process.send({type:'nuxt:internal:dev:fork-ready',dns:getDefaultResultOrder(),ca:createHash('sha256').update(getCACertificates('default').toSorted().join('\\n')).digest('hex')});
process.disconnect();`,
    );
    const program = `import {fork} from 'node:child_process';
import {EventEmitter,once} from 'node:events';
import {getCACertificates} from 'node:tls';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
let received,closed;
const facade=new EventEmitter();facade.argv=process.argv;facade.env=process.env;facade.exit=()=>{throw new Error('unexpected fork exit')};
const context={process:facade,debug:()=>{},isDeno:false,__nuxt_cli__:{devEntry:${JSON.stringify(child)}},fork:(...args)=>{const child=fork(...args);closed=once(child,'exit');child.once('message',message=>received=message);return child;}};
vm.createContext(context);
vm.runInContext(${JSON.stringify(poolSource.slice(start, end))}+'\\nglobalThis.TestPool=ForkPool;',context);
const entry=new context.TestPool({rawArgs:[]}).createFork();await entry.ready;await closed;
console.log(JSON.stringify({expectedCA:createHash('sha256').update(getCACertificates('default').toSorted().join('\\n')).digest('hex'),child:received}));`;
    const result = spawnSync(
      process.execPath,
      ['--use-system-ca', '--dns-result-order=ipv4first', '--input-type=module', '-e', program],
      {
        encoding: 'utf8',
        cwd: source,
        timeout: 10000,
        env: { PATH: process.env.PATH, NODE_OPTIONS: nodeOptions },
      },
    );
    assert.equal(result.status, 0, result.stderr);
    const value = JSON.parse(result.stdout);
    assert.equal(value.child.dns, 'ipv4first');
    assert.equal(value.child.ca, value.expectedCA);
  });
});
