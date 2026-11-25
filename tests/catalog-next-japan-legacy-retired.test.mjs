import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root='.github/workflows/';
const read=name=>fs.readFileSync(root+name,'utf8');
const blocked=[
  ['catalog-v2-japan.yml','japan'],
  ['catalog-v3-japan-republish-collected.yml','republish'],
  ['catalog-japan-strict-merge-publish.yml','publish'],
  ['catalog-japan-publish-verified-aggregate.yml','prepare']
];
test('superseded Japan bulk publishers are disabled, not invoked by on-demand AJ',()=>{
  for(const [file,job] of blocked) {
    const content=read(file);
    assert.match(content,new RegExp('^  '+job+':\\s*\\n(?:    #[^\\n]*\\n)*    if: false','m'),file);
  }
});
test('shared V3 publisher cannot write China or Japan, other market jobs survive',()=>{
  const src=read('catalog-v3-market-10k-reusable.yml');
  assert.match(src,/^  validate:\s*\n\s+(?:#[^\n]*\n\s+)*if: inputs\.market != 'china' && inputs\.market != 'japan'/m);
  assert.match(src,/^  collect:\s*\n\s+needs: validate/m);
  assert.match(src,/^  publish:\s*\n\s+needs: \[validate, collect\]/m);
  const all=read('catalog-v4-all-markets-30k.yml');
  assert.doesNotMatch(all,/^  japan:\s*$/m);
  assert.doesNotMatch(all,/^  china:\s*$/m);
  assert.match(all,/^  korea:\s*$/m);
  assert.match(all,/^  uae:\s*\n\s+needs: korea/m);
  assert.match(all,/^  europe:\s*$/m);
});
test('live Japan is on demand, not full source mirror, and accepted China runtime stays frozen',()=>{
  const china=fs.readFileSync('docs/markets/china.md','utf8');
  const japan=fs.readFileSync('docs/markets/japan.md','utf8');
  assert.match(china,/d536c1547c4d82a339ed68ced7d8503f09b6810b/);
  assert.match(japan,/Полный дамп, зеркало и массовый обход/);
  const daily=read('catalog-next-china-daily.yml');
  assert.match(daily,/cron: '0 14 \* \* \*'/);
  assert.doesNotMatch(daily,/japan|ajes|catalog-publish-market/i);
});
