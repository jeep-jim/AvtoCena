import assert from 'node:assert/strict';
import test from 'node:test';
import { extractWorldAutoBaseUrlConfig } from '../scripts/catalog-source-worldauto-baseurl-config-probe-v1.mjs';

test('extracts literal baseUrl from the source-declared config module', () => {
  const js = `111:{},21337:(t,n,e)=>{e.d(n,{A:()=>cfg});const cfg={baseUrl:"https://api.worldauto.ge/v2"}},999:{}`;
  const result = extractWorldAutoBaseUrlConfig(js);
  assert.equal(result.moduleFound, true);
  assert.deepEqual(result.baseUrlValues, ['https://api.worldauto.ge/v2']);
  assert.ok(result.urls.includes('https://api.worldauto.ge/v2'));
});

test('does not infer a base URL outside the target webpack module', () => {
  const result = extractWorldAutoBaseUrlConfig(`const baseUrl='https://api.example.com';`);
  assert.equal(result.moduleFound, false);
  assert.deepEqual(result.baseUrlValues, []);
});
