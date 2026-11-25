import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const workflows=path.resolve('.github/workflows');
const old=[
  'catalog-refresh-china.yml',
  'catalog-prepare-owned-china.yml',
  'stage-owned-china-generation.yml',
  'accept-owned-china-generation.yml',
  'catalog-che168-verify-publication.yml',
  'catalog-v2-china.yml'
];
const read=name=>fs.readFileSync(path.join(workflows,name),'utf8');

test('six retired China writers cannot be triggered from current main workflows',()=>{
  for(const name of old)assert.equal(fs.existsSync(path.join(workflows,name)),false,name);
  // The one-time Docker bootstrap is retired after the accepted 283188-car generation.
  assert.equal(fs.existsSync(path.join(workflows,'catalog-next-china-release.yml')),false);
});
test('old sequential queue never dispatches China or makes UAE wait for China',()=>{
  const src=read('catalog-v3-sequential-queue.yml');
  assert.doesNotMatch(src,/^  china:\s*$/m);
  assert.doesNotMatch(src,/needs:\s*\[[^\]]*china[^\]]*\]/);
  assert.match(src,/^  korea:/m);
  assert.match(src,/^  uae:\s*\n\s+needs:\s*\[plan, korea\]/m);
});
test('shared legacy V3 writer is rejected for China before collect/publish',()=>{
  const src=read('catalog-v3-market-10k-reusable.yml');
  assert.match(src,/^  validate:\s*\n\s+if:\s*inputs\.market != 'china'/m);
  assert.match(src,/^  collect:\s*\n\s+needs:\s*validate/m);
  assert.match(src,/^  publish:\s*\n\s+needs:\s*\[validate, collect\]/m);
});
test('shared legacy catalog refresh refuses China while preserving other market callers',()=>{
  const src=read('catalog-market-refresh.yml');
  assert.match(src,/^  plan:\s*\n\s+if:\s*inputs\.market != 'china'/m);
  for(const market of ['korea','uae','georgia','europe'])
    assert.ok(src.includes(market),'other market '+market+' must remain supported');
});
