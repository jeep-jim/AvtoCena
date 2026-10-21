import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {claimPageRecovery} from '../apps/web/lib/public-page-recovery';
test('page recovery preserves route and cannot reload repeatedly',()=>{
 const map=new Map<string,string>();const store={getItem:(k:string)=>map.get(k)||null,setItem:(k:string,v:string)=>{map.set(k,v);}};
 assert.equal(claimPageRecovery(store,'/cars?make=Toyota','e',1000),true);
 assert.equal(claimPageRecovery(store,'/cars?make=Toyota','e',1001),false);
 assert.equal(claimPageRecovery(store,'/cars?make=Toyota','e',301001),true);
 assert.equal(claimPageRecovery({getItem:()=>{throw Error('blocked');},setItem:()=>{}},'/','e'),false);
});
test('supplier refusal stays local to the offer; unexpected errors still surface',async()=>{
 const mocks:any={
  'react':`export const cache=f=>f;`,
  'next/cache':`export const unstable_cache=f=>f;`,
  './collection-controls':`export class CollectionDisabledError extends Error{}`,
  './ajes-client':`export class AjesUnavailable extends Error{constructor(reason){super(reason);this.reason=reason}}`,
  './editorial':`export const readCatalogEditorial=async()=>({});export const editorialHidden=()=>false;export const applyCatalogEditorial=x=>x;`,
  './storage':`import {CollectionDisabledError} from './collection-controls';import {AjesUnavailable} from './ajes-client';export const getOfferWithoutEditorial=async()=>{if(globalThis.__pageFailure==='disabled')throw new CollectionDisabledError();if(globalThis.__pageFailure==='supplier')throw new AjesUnavailable('visitor_restricted');if(globalThis.__pageFailure==='unexpected')throw Error('unexpected');return {id:'ajes-stats-123'}};export const getOfferFromCurrentShard=async()=>null;export const getOfferFromCurrentProjection=async()=>null;export const isJapanCatalogOfferId=()=>false;`
 };
 const bundle=await build({entryPoints:['apps/web/lib/catalog/offer-page-data.ts'],bundle:true,platform:'node',format:'cjs',write:false,plugins:[{name:'mocks',setup(b){b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));}}]});
 const m={exports:{} as any};new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(import.meta.url),m,m.exports);
 (globalThis as any).__pageFailure='supplier';assert.deepEqual(await m.exports.readOfferDetailForPage('ajes-stats-123'),{offer:null,unavailable:true});
 (globalThis as any).__pageFailure='disabled';assert.deepEqual(await m.exports.readOfferDetailForPage('ajes-china-123'),{offer:null,unavailable:true,disabled:true});
 (globalThis as any).__pageFailure='unexpected';await assert.rejects(m.exports.readOfferDetailForPage('ajes-stats-123'),/unexpected/);
 delete (globalThis as any).__pageFailure;assert.equal((await m.exports.readOfferDetailForPage('ajes-stats-123')).offer.id,'ajes-stats-123');
});
