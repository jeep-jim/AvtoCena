import assert from 'node:assert/strict';
import test from 'node:test';
import { extractWorldAutoHttpClientSignals } from '../scripts/catalog-source-worldauto-http-client-contract-probe-v1.mjs';

test('extracts only declared client-module base transport signals', () => {
  const js = `123:{},47400:(t,n,e)=>{const c={baseURL:"https://api.worldauto.ge/v1"};e.d(n,{Ay:()=>client});const client=axios.create(c)},999:{}`;
  const result = extractWorldAutoHttpClientSignals(js);
  assert.equal(result.moduleFound, true);
  assert.deepEqual(result.baseUrlValues, ['https://api.worldauto.ge/v1']);
  assert.ok(result.worldAutoOrApiUrls.includes('https://api.worldauto.ge/v1'));
  assert.equal(result.context.includes('47400:'), true);
});

test('does not claim a client module when the webpack module id is absent', () => {
  const result = extractWorldAutoHttpClientSignals(`const baseURL='https://api.example.com';`);
  assert.equal(result.moduleFound, false);
  assert.deepEqual(result.baseUrlValues, []);
});
