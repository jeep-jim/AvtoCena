import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseAutohomeDraft} from '../apps/web/lib/autocalc/autohome';
import {sourceIdentity} from '../apps/web/lib/autocalc/sources';
import {importedOffer} from '../apps/web/lib/dealers/import-offer';
const page=JSON.parse(readFileSync('tests/fixtures/autocalc/autohome-74683.json','utf8'));
const config=readFileSync('tests/fixtures/autocalc/autohome-74683-config.json','utf8');
const html=(p:any)=>`<script id="__NEXT_DATA__">${JSON.stringify({props:{pageProps:p}})}</script>`;
const url='https://www.autohome.com.cn/spec/74683/#pvareaid=6861993';
test('actual AutoHome 74683 imports its own RAV4 specification and photos into special offer',()=>{
 assert.equal(sourceIdentity(url)?.id,'74683');assert.equal(sourceIdentity('https://car.autohome.com.cn/config/spec/74683.html')?.id,'74683');assert.equal(sourceIdentity('https://autohome.com.cn.evil.example/spec/74683/'),null);
 const d=parseAutohomeDraft(html(page),'74683',url,`var config = ${config};`);
 assert.equal(d.price,'189800');assert.equal(d.currency,'CNY');assert.equal(d.draft.engineCc,'1987');assert.equal(d.draft.powerHp,'171');assert.equal(d.draft.powerKw,'126');assert.equal(d.images.length,5);
 const patch=importedOffer(d);assert.equal(patch.make,'Toyota');assert.equal(patch.engineCc,1987);assert.equal(patch.priceUsd,undefined);assert.equal(patch.customsIncluded,undefined);
});
test('AutoHome rejects another spec and does not turn rounded litres or electric peak kW into certified fields',()=>{
 assert.throws(()=>parseAutohomeDraft(html(page),'75766',url),/другую/);
 const d=parseAutohomeDraft(html(page),'74683',url);assert.equal(d.draft.engineCc,undefined);
 const ev=structuredClone(page);ev.specDetails.specinfo.funeldetail='纯电动';
 const e=parseAutohomeDraft(html(ev),'74683',url);assert.equal(e.draft.powerHp,undefined);assert.equal(e.draft.power30MinKw,undefined);
});
