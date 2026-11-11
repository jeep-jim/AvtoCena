import assert from 'node:assert/strict';
import test from 'node:test';
import {appendJapanFilterQuery,rememberedJapanFilter,JAPAN_FILTER_KEYS,savedJapanFilterKey} from '../apps/web/lib/catalog/japan-filter-retention';
import {ajesCatalogQuery,ajesQuery,AjesFilterUnavailable} from '../apps/web/lib/catalog/ajes-query';

const chosen={chassis:'ZVW30',frameNumber:'ZVW30-1234567',lotNumber:'12345',auctionGrade:'4.5',salePeriod:'month'};
function paramsFor(market:string,stock='',fields=chosen){const params=new URLSearchParams({market,make:'TOYOTA',model:'PRIUS',budget:'1500000'});appendJapanFilterQuery(params,{market,stock,...fields});return params;}

test('Japan auction choices reach the real supplier query intact',()=>{
 const params=paramsFor('japan'),query=ajesCatalogQuery(Object.fromEntries(params));
 for(const key of JAPAN_FILTER_KEYS){assert.equal(params.get(key),chosen[key]);assert.equal(params.has(savedJapanFilterKey(key)),false);assert.equal(query[key],chosen[key]);}
 assert.doesNotThrow(()=>ajesQuery(query));
});
for(const market of ['korea','china'])test(`${market} retains Japan choices without sending unsupported supplier constraints`,()=>{
 assert.throws(()=>ajesCatalogQuery({market,...chosen}),AjesFilterUnavailable);
 const params=paramsFor(market),query=ajesCatalogQuery(Object.fromEntries(params));
 for(const key of JAPAN_FILTER_KEYS){assert.equal(params.has(key),false);assert.equal(params.get(savedJapanFilterKey(key)),chosen[key]);assert.equal(query[key],undefined);}
 assert.equal(query.make,'TOYOTA');assert.equal(params.get('budget'),'1500000');assert.doesNotThrow(()=>ajesQuery(query));
});
test('returning to Japan restores every choice after a URL round trip',()=>{
 const initial=Object.fromEntries(new URLSearchParams(paramsFor('korea').toString()));
 const restored=Object.fromEntries(JAPAN_FILTER_KEYS.map(key=>[key,rememberedJapanFilter(initial,key)])) as typeof chosen;
 const params=paramsFor('japan','',restored);for(const key of JAPAN_FILTER_KEYS)assert.equal(params.get(key),chosen[key]);
 assert.doesNotThrow(()=>ajesQuery(ajesCatalogQuery(Object.fromEntries(params))));
});
test('explicitly removing one remembered choice removes both keys and keeps the others',()=>{
 const params=paramsFor('korea');params.set('frameNumber',chosen.frameNumber);
 appendJapanFilterQuery(params,{...chosen,frameNumber:'',market:'korea',stock:''});
 assert.equal(params.has('frameNumber'),false);assert.equal(params.has(savedJapanFilterKey('frameNumber')),false);
 for(const key of JAPAN_FILTER_KEYS.filter(key=>key!=='frameNumber'))assert.equal(params.get(savedJapanFilterKey(key)),chosen[key]);
});
test('green-corner and mixed markets remember auction choices without applying them',()=>{
 for(const [market,stock] of [['japan','green'],['japan,korea',''],['','']]){
  const params=paramsFor(market,stock);for(const key of JAPAN_FILTER_KEYS){assert.equal(params.has(key),false);assert.equal(rememberedJapanFilter(Object.fromEntries(params),key),chosen[key]);}
 }
});
