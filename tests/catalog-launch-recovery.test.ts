import test from 'node:test';
import assert from 'node:assert/strict';
import {autoPapaListingPagination,AutoPapaGeorgiaAdapter} from '../apps/web/lib/catalog/autopapa-georgia-source';
import {kcarListingBeforeYear} from '../apps/web/lib/catalog/kcar-exact-source';
import {recoveryDecision} from '../scripts/lib/catalog-recovery-policy.mjs';

const url='https://autopapa.ge/en/usd/search?page=924';
const pager=(links='')=>`<div class="boxPages"><div class="current">924</div>${links}</div></div></div>`;
test('AutoPapa follows verified pagination even when a page has no eligible cars',()=>{
 assert.deepEqual(autoPapaListingPagination(pager('<a rel="next" href="/en/usd/search?page=925&amp;s%5Byear_from%5D=2020">next</a>'),url),{nextCursor:'925',finished:false});
 assert.deepEqual(autoPapaListingPagination(pager('<a rel="prev" href="/en/usd/search?page=923">previous</a>'),url),{nextCursor:null,finished:true});
 for(const html of ['<h1>Access denied</h1>',pager('<a rel="next" href="https://example.com/en/usd/search?page=925">next</a>'),pager('<a rel="next" href="/en/usd/search?page=924">next</a>')]) assert.equal(autoPapaListingPagination(html,url),null);
 assert.equal(autoPapaListingPagination(pager(),url.replace('924','923')),null);
});
test('AutoPapa adapter can finish a verified empty last page but rejects unknown HTML',async()=>{
 const original=globalThis.fetch;
 try {
  globalThis.fetch=async()=>new Response(pager());
  const last=await new AutoPapaGeorgiaAdapter().fetchPage('924');
  assert.equal(last.finished,true);assert.equal(last.nextCursor,null);assert.deepEqual(last.items,[]);
  globalThis.fetch=async()=>new Response('<html>Unexpected maintenance screen</html>');
  await assert.rejects(new AutoPapaGeorgiaAdapter().fetchPage('924'),/parsed_zero/);
 }finally {globalThis.fetch=original;}
});
test('K Car skips old listing details only when both source dates prove the age',()=>{
 assert.equal(kcarListingBeforeYear({mfgDt:'201912',prdcnYr:'2019'},2020),true);
 for(const row of [{mfgDt:'201912',prdcnYr:'2020'},{mfgDt:'202001',prdcnYr:'2019'},{mfgDt:'201913',prdcnYr:'2019'},{mfgDt:'201912'},{prdcnYr:'2019'}]) assert.equal(kcarListingBeforeYear(row,2020),false);
 assert.equal(kcarListingBeforeYear({mfgDt:'201912',prdcnYr:'2019'},NaN),false);
});
test('a completed China tail and a recent publication never masquerade as full fresh collection',()=>{
 const now=Date.parse('2026-09-28T04:00:00Z');
 const base={market:'china',now,runs:[{status:'completed',conclusion:'success'}]};
 assert.equal(recoveryDecision({...base,journal:{version:2,collectionComplete:false,lastPublicationSuccess:new Date(now).toISOString(),sources:[{sourceId:'che168',initialCursor:'2001',stopReason:'source_finished'}]}}).reason,'completed_continuation_requires_cycle_verification');
 assert.equal(recoveryDecision({...base,journal:{version:2,lastCollectionSuccess:null,lastPublicationSuccess:new Date(now).toISOString()}}).reason,'missing_or_stale_collection');
});
