import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {autoApiPage} from '../scripts/lib/auto-api-che168-client.mjs';
import {assertLegacyRawWriterDisabled, RAW_COORDINATION_POLICY_KEY} from '../apps/web/lib/catalog/raw-coordination-gate.mjs';
import {RAW_COORDINATION_KEY} from '../scripts/lib/catalog-raw-coordination.mjs';

const workflow = fs.readFileSync(new URL('../.github/workflows/encar-paid-intake-check.yml', import.meta.url), 'utf8');
const snippets = [...workflow.matchAll(/node[^\n]* <<'JS'\n([\s\S]*?)\n          JS/g)]
  .map(match => match[1].replace(/^          /gm, ''));
assert.equal(snippets.length, 2, 'Both actual workflow provider steps must be exercised');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const registryId = 'f'.repeat(32);
const policy = {version: 1, mode: 'required', protocolVersion: 1, registryId};
const registry = {version: 1, scope: 'nonjp_raw_lifecycle_v1', registryId};
const blocked = /legacy_encar_collection_blocked_use_catalog_refresh_korea/;

function fixture({values = [], unreadable = null, pageCount = 2, afterProvider, afterWrite} = {}) {
  const data = new Map(values), calls = [], writes = [];
  const storage = {
    driver: 'object',
    async readJson(key, fallback) {
      assert.ok([RAW_COORDINATION_POLICY_KEY, RAW_COORDINATION_KEY].includes(key));
      calls.push({type: 'control', key});
      if (key === unreadable) throw Error('test_control_unreadable');
      return data.has(key) ? structuredClone(data.get(key)) : fallback;
    },
    async writeJson(key, value) {
      calls.push({type: 'write', key});
      writes.push({key, value: structuredClone(value)});
      await afterWrite?.({key, value, data, writes});
    },
  };
  const client = () => async (endpoint, {page}) => {
    assert.equal(endpoint, 'offers');
    calls.push({type: 'provider', page});
    const result = {result: [{inner_id: String(page), data: {fixture: true}}],
      meta: {page, next_page: page < pageCount ? page + 1 : null}};
    await afterProvider?.({page, data});
    return result;
  };
  async function run(index) {
    const bindings = {
      './scripts/lib/auto-api-che168-client.mjs': {autoApiChe168Client: client, autoApiPage},
      './apps/web/lib/data.ts': {getJsonStorage: () => storage},
      './apps/web/lib/catalog/raw-coordination-gate.mjs': {assertLegacyRawWriterDisabled},
    };
    const names = [], imports = [];
    const body = snippets[index].replace(/^import \{([^}]+)\} from '([^']+)';$/gm, (_, fields, module) => {
      assert.ok(Object.hasOwn(bindings, module), `Unexpected workflow import ${module}`);
      for (const name of fields.split(',').map(value => value.trim())) {
        assert.ok(Object.hasOwn(bindings[module], name)); names.push(name); imports.push(bindings[module][name]);
      }
      return '';
    });
    assert.ok(names.includes('assertLegacyRawWriterDisabled'));
    // Execute the saved workflow body, using its real coordinator reader and
    // page parser. Only the external provider and storage I/O are replaced.
    return new AsyncFunction(...names, 'process', 'console', body)(...imports,
      {env: {ACCOUNT_KEY: 'fixture', GITHUB_RUN_ID: '43880000000', GITHUB_RUN_ATTEMPT: '1'}}, {log() {}});
  }
  return {data, calls, writes, run};
}

test('legacy workflow is manual-only and retains main, protected environment and exact storage scope', () => {
  assert.equal(workflow.match(/^on:\n([\s\S]*?)^permissions:/m)?.[1].trim(), 'workflow_dispatch:');
  assert.match(workflow, /if: github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /environment: regcloud-staging/);
  for (const value of ['JSON_STORAGE_DRIVER: object', 'https://s3.regru.cloud', 'avtocena-staging-8120751',
    'migration-staging/full-20261011/']) assert.ok(workflow.includes(value));
  assert.ok(workflow.indexOf('- run: npm ci') < workflow.indexOf('- name: Verify inventory'));
});

for (const [name, values] of [
  ['required policy and matching registry', [[RAW_COORDINATION_POLICY_KEY, policy], [RAW_COORDINATION_KEY, registry]]],
  ['policy without registry', [[RAW_COORDINATION_POLICY_KEY, policy]]],
  ['registry without policy', [[RAW_COORDINATION_KEY, registry]]],
  ['malformed persisted policy', [[RAW_COORDINATION_POLICY_KEY, {version: 0}]]],
]) test(`${name} blocks both actual provider steps before requests or writes`, async () => {
  for (const index of [0, 1]) {
    const f = fixture({values});
    await assert.rejects(f.run(index), blocked);
    assert.equal(f.calls.filter(row => row.type === 'provider').length, 0);
    assert.equal(f.writes.length, 0);
  }
});

test('unreadable policy or registry stops both provider steps', async () => {
  for (const unreadable of [RAW_COORDINATION_POLICY_KEY, RAW_COORDINATION_KEY]) for (const index of [0, 1]) {
    const f = fixture({unreadable});
    await assert.rejects(f.run(index), blocked);
    assert.equal(f.calls.filter(row => row.type === 'provider').length, 0);
    assert.equal(f.writes.length, 0);
  }
});

test('both absent preserve the existing page loop and complete receipt', async () => {
  const f = fixture();
  await f.run(0); await f.run(1);
  assert.deepEqual(f.calls.filter(row => row.type === 'provider').map(row => row.page), [1, 1, 2]);
  assert.deepEqual(f.writes.map(row => row.key), [
    'catalog/intake-staging/encar/43880000000/1/pages/1.json',
    'catalog/intake-staging/encar/43880000000/1/pages/2.json',
    'catalog/intake-staging/encar/43880000000/1/complete.json',
  ]);
  assert.equal(f.writes[2].value.pages, 2);
  assert.equal(f.writes[2].value.count, 2);
  assert.ok(Number.isFinite(Date.parse(f.writes[2].value.completedAt)));
  assert.deepEqual(f.calls.slice(0, 2).map(row => row.key), [RAW_COORDINATION_POLICY_KEY, RAW_COORDINATION_KEY]);
});

test('registry installed between workflow steps prevents the collection request', async () => {
  const f = fixture(); await f.run(0);
  f.data.set(RAW_COORDINATION_KEY, registry);
  await assert.rejects(f.run(1), blocked);
  assert.equal(f.calls.filter(row => row.type === 'provider').length, 1);
  assert.equal(f.writes.length, 0);
});

test('policy appearing during a provider request prevents its raw page PUT', async () => {
  const f = fixture({afterProvider: ({data}) => data.set(RAW_COORDINATION_POLICY_KEY, policy)});
  await assert.rejects(f.run(1), blocked);
  assert.equal(f.calls.filter(row => row.type === 'provider').length, 1);
  assert.equal(f.writes.length, 0);
});

test('registry appearing after a saved page prevents the next provider request', async () => {
  const f = fixture({afterWrite: ({data}) => data.set(RAW_COORDINATION_KEY, registry)});
  await assert.rejects(f.run(1), blocked);
  assert.equal(f.calls.filter(row => row.type === 'provider').length, 1);
  assert.equal(f.writes.length, 1);
  assert.ok(f.writes[0].key.endsWith('/pages/1.json'));
});

test('registry appearing after the final page prevents a false complete receipt', async () => {
  const f = fixture({pageCount: 1, afterWrite: ({data}) => data.set(RAW_COORDINATION_KEY, registry)});
  await assert.rejects(f.run(1), blocked);
  assert.equal(f.writes.length, 1);
  assert.ok(f.writes[0].key.endsWith('/pages/1.json'));
});
