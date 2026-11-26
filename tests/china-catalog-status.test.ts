import './helpers/server-only-hook.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {readChinaCatalogStatus, type ChinaCatalogStatus} from '../apps/web/lib/catalog/china-catalog-status';

const runtimeSha = 'a'.repeat(40), generationId = 'gen_china_45655051136_1';
const sourceObservedAt = '2026-01-02T03:04:05.678Z';
const unavailable = {status: 'unavailable'};
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
function manifest() {
  return {
    version: 1, kind: 'china-local-generation-v1', market: 'china', runtimeSha, generationId,
    prepared: true, published: false, activationAuthorized: false,
    source: {cursor: 123, sourceObservedAt, supplierLatestVerified: true}, rows: 17,
    queryIndex: {version: 1, kind: 'china-query-index-v1', rows: 17,
      binding: {version: 1, market: 'china', generationId, sourceCursor: 123, sourceObservedAt}},
    reconciliation: {version: 1, kind: 'china-frozen-pricing-reconciliation-v1', market: 'china', generationId,
      admittedRows: 17, sourceObservedAt, supplierLatestVerified: true},
    // These fields must never replace the source date or enter the owner projection.
    acceptedAt: '2026-01-03T01:02:03.000Z', privateFixture: 'PRIVATE_MANIFEST_VALUE',
  };
}
async function fixture(t: any, value: unknown = manifest()) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'china-catalog-status-'));
  t.after(() => fs.rm(directory, {recursive: true, force: true}));
  const filename = path.join(directory, 'GENERATION.json');
  const bytes = Buffer.from(JSON.stringify(value));
  await fs.writeFile(filename, bytes);
  const environment = {CATALOG_CHINA_LOCAL_GENERATION_DIR: directory,
    CATALOG_CHINA_LOCAL_MANIFEST_SHA256: hash(bytes), CATALOG_CHINA_LOCAL_RUNTIME_SHA: runtimeSha};
  return {directory, filename, environment};
}

test('reads only the pinned manifest and projects source date / admitted rows, never publication or private fields', async t => {
  const f = await fixture(t);
  t.mock.method(globalThis, 'fetch', async () => { throw Error('network_forbidden'); });
  const opened: string[] = [], original = fs.open;
  t.mock.method(fs, 'open', async (...args: Parameters<typeof fs.open>) => {
    opened.push(String(args[0])); return original(...args);
  });
  const result = await readChinaCatalogStatus(f.environment);
  assert.deepEqual(result, {status: 'ready', sourceObservedAt, rows: 17, generationId});
  assert.equal(opened.length, 2);
  assert.equal(opened[0], f.directory);
  assert.match(opened[1], /^\/proc\/self\/fd\/\d+\/GENERATION\.json$/);
  assert.deepEqual(await fs.readdir(f.directory), ['GENERATION.json'], 'no SQLite or other payload exists in the fixture');
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|acceptedAt|runtimeSha|published|manifestSha/);
});

test('rejects inconsistent schema, source evidence, dates, identities and counts even when the file hash is valid', async t => {
  const cases: Array<[string, (value: any) => void]> = [
    ['schema', v => { v.version = 2; }], ['kind', v => { v.kind = 'different'; }],
    ['market', v => { v.market = 'japan'; }], ['unprepared', v => { v.prepared = false; }],
    ['runtime', v => { v.runtimeSha = 'b'.repeat(40); }],
    ['generation', v => { v.generationId = '../PRIVATE'; }],
    ['source unverified', v => { v.source.supplierLatestVerified = false; }],
    ['source verification string', v => { v.source.supplierLatestVerified = 'true'; }],
    ['source date absent', v => { delete v.source.sourceObservedAt; }],
    ['source date malformed', v => { v.source.sourceObservedAt = 'PRIVATE_DATE'; }],
    ['source date impossible', v => { v.source.sourceObservedAt = '2026-02-30T03:04:05.678Z'; }],
    ['source date future', v => { v.source.sourceObservedAt = '2999-01-01T00:00:00.000Z'; }],
    ['rows zero', v => { v.rows = 0; }], ['rows fraction', v => { v.rows = 17.5; }],
    ['rows string', v => { v.rows = '17'; }],
    ['index rows', v => { v.queryIndex.rows = 18; }],
    ['reconciliation rows', v => { v.reconciliation.admittedRows = 18; }],
    ['index generation', v => { v.queryIndex.binding.generationId = 'gen_china_999_1'; }],
    ['index source cursor', v => { v.queryIndex.binding.sourceCursor++; }],
    ['index source date', v => { v.queryIndex.binding.sourceObservedAt = v.acceptedAt; }],
    ['reconciliation generation', v => { v.reconciliation.generationId = 'gen_china_999_1'; }],
    ['reconciliation source date', v => { v.reconciliation.sourceObservedAt = v.acceptedAt; }],
  ];
  for (const [name, change] of cases) {
    const value = manifest(); change(value); const f = await fixture(t, value);
    assert.deepEqual(await readChinaCatalogStatus(f.environment), unavailable, name);
  }
});

test('invalid config, wrong checksum, missing, malformed, oversized and non-regular files are unavailable', async t => {
  assert.deepEqual(await readChinaCatalogStatus({}), unavailable);
  const f = await fixture(t);
  for (const environment of [
    {...f.environment, CATALOG_CHINA_LOCAL_GENERATION_DIR: 'relative'},
    {...f.environment, CATALOG_CHINA_LOCAL_GENERATION_DIR: f.directory + '/../' + path.basename(f.directory)},
    {...f.environment, CATALOG_CHINA_LOCAL_MANIFEST_SHA256: '0'.repeat(64)},
    {...f.environment, CATALOG_CHINA_LOCAL_RUNTIME_SHA: 'invalid'},
  ]) assert.deepEqual(await readChinaCatalogStatus(environment), unavailable);
  for (const bytes of [Buffer.from('{PRIVATE_BAD_JSON'), Buffer.alloc(1024 * 1024 + 1, 32), Buffer.alloc(0)]) {
    await fs.writeFile(f.filename, bytes); f.environment.CATALOG_CHINA_LOCAL_MANIFEST_SHA256 = hash(bytes);
    assert.deepEqual(await readChinaCatalogStatus(f.environment), unavailable);
  }
  await fs.rm(f.filename);
  assert.deepEqual(await readChinaCatalogStatus(f.environment), unavailable);
  await fs.mkdir(f.filename);
  assert.deepEqual(await readChinaCatalogStatus(f.environment), unavailable);
});

test('refuses final-file, configured-directory and ancestor symlinks plus hard-linked manifests', async t => {
  const actual = await fixture(t), other = await fixture(t);
  await fs.rm(other.filename); await fs.symlink(actual.filename, other.filename);
  assert.deepEqual(await readChinaCatalogStatus(other.environment), unavailable);
  const link = path.join(other.directory, 'directory-link'); await fs.symlink(actual.directory, link);
  assert.deepEqual(await readChinaCatalogStatus({...actual.environment, CATALOG_CHINA_LOCAL_GENERATION_DIR: link}), unavailable);
  const nested = path.join(actual.directory, 'nested'); await fs.mkdir(nested);
  await fs.copyFile(actual.filename, path.join(nested, 'GENERATION.json'));
  assert.deepEqual(await readChinaCatalogStatus({...actual.environment, CATALOG_CHINA_LOCAL_GENERATION_DIR: path.join(link, 'nested')}), unavailable);
  await fs.rm(other.filename); await fs.link(actual.filename, other.filename);
  assert.deepEqual(await readChinaCatalogStatus(actual.environment), unavailable);
  assert.deepEqual(await readChinaCatalogStatus(other.environment), unavailable);
});

test('accepts a manifest exactly at the size bound and does not trust a file changed during its read', async t => {
  const value = {...manifest(), padding: ''};
  value.padding = 'x'.repeat(1024 * 1024 - Buffer.byteLength(JSON.stringify(value)));
  const f = await fixture(t, value);
  assert.equal((await fs.stat(f.filename)).size, 1024 * 1024);
  assert.equal((await readChinaCatalogStatus(f.environment)).status, 'ready');
  const original = fs.open; let changed = false;
  t.mock.method(fs, 'open', async (...args: Parameters<typeof fs.open>) => {
    const handle = await original(...args);
    if (String(args[0]).endsWith('/GENERATION.json')) {
      const read = handle.read.bind(handle);
      handle.read = (async (...readArgs: any[]) => {
        const result = await (read as any)(...readArgs);
        if (!changed) { changed = true; await fs.appendFile(f.filename, ' '); }
        return result;
      }) as typeof handle.read;
    }
    return handle;
  });
  assert.deepEqual(await readChinaCatalogStatus(f.environment), unavailable);
  assert.equal(changed, true);
});

async function routeFixture() {
  const context = {user: null as any, reads: 0,
    result: {status: 'ready', sourceObservedAt, rows: 17, generationId} as ChinaCatalogStatus};
  const built = await build({entryPoints: ['apps/web/app/(crm)/api/crm/china-catalog-status/route.ts'], bundle: true,
    write: false, platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent', plugins: [{name: 'route-boundaries', setup(b) {
      b.onResolve({filter: /^(next\/server|@\/lib\/auth|@\/lib\/catalog\/china-catalog-status)$/}, args => ({path: args.path, namespace: 'fixture'}));
      b.onLoad({filter: /.*/, namespace: 'fixture'}, args => ({contents:
        args.path === 'next/server' ? 'export const NextResponse={json:(value,options)=>Response.json(value,options)};'
          : args.path === '@/lib/auth' ? 'export const getCurrentUser=async()=>globalThis.__chinaStatusRoute.user;'
            : 'export const readChinaCatalogStatus=async()=>{globalThis.__chinaStatusRoute.reads++;return globalThis.__chinaStatusRoute.result;};', loader: 'js'}));
    }}]});
  const module = {exports: {} as any};
  new Function('module', 'exports', 'require', 'globalThis', built.outputFiles[0].text)
    (module, module.exports, createRequire(import.meta.url), {__chinaStatusRoute: context});
  return {...module.exports, context};
}

test('owner GET authenticates before any manifest read, projects the union and always disables caching', async () => {
  const route = await routeFixture();
  for (const user of [null, {id: 'other', companyId: 'outside', role: 'owner'},
    {id: 'staff', companyId: 'dealer_topavto', role: 'admin'},
    {id: 'disabled', companyId: 'dealer_topavto', role: 'owner', status: 'disabled'}]) {
    route.context.user = user;
    const response = await route.GET(); assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), unavailable); assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.equal(route.context.reads, 0);
  }
  route.context.user = {id: 'owner', companyId: 'dealer_topavto', role: 'owner', status: 'active'};
  const ready = await route.GET(); assert.equal(ready.status, 200); assert.equal(route.context.reads, 1);
  assert.deepEqual(await ready.json(), route.context.result); assert.equal(ready.headers.get('cache-control'), 'private, no-store');
  route.context.result = unavailable;
  const missing = await route.GET(); assert.equal(missing.status, 200); assert.equal(route.context.reads, 2);
  assert.deepEqual(await missing.json(), unavailable); assert.equal(missing.headers.get('cache-control'), 'private, no-store');
  assert.equal(route.PUT, undefined);
});
