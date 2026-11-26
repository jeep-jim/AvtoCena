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
  './prepared-china-http-fixture':`export class PreparedChinaFixtureUnavailable extends Error{};export const hasPreparedChinaHttpFixture=()=>false;export const hasIndependentChinaHttpFixture=()=>false;export const preparedChinaNormalRegcloudEnabled=()=>false;export const assertIndependentChinaFallbackAllowed=async()=>{throw Error('unexpected prepared lookup')};export const readPreparedChinaFixtureOffer=async()=>{throw Error('unexpected prepared lookup')};`,
  './editorial':`export const readCatalogEditorial=async()=>{globalThis.__pageReads++;return {entries:{}};};export const matchingEditorial=()=>undefined;export const editorialHidden=()=>false;export const applyCatalogEditorial=x=>x;`,
  './storage':`import {CollectionDisabledError} from './collection-controls';import {AjesUnavailable} from './ajes-client';export const getOfferWithoutEditorial=async()=>{globalThis.__pageReads++;if(globalThis.__pageFailure==='disabled')throw new CollectionDisabledError();if(globalThis.__pageFailure==='supplier')throw new AjesUnavailable('visitor_restricted');if(globalThis.__pageFailure==='unexpected')throw Error('unexpected');return {id:'ajes-stats-123'}};export const getOfferFromCurrentShard=async()=>{globalThis.__pageReads++;return null;};export const getOfferFromCurrentProjection=async()=>{globalThis.__pageReads++;return null;};export const isJapanCatalogOfferId=()=>false;`
 };
 const bundle=await build({entryPoints:['apps/web/lib/catalog/offer-page-data.ts'],bundle:true,platform:'node',format:'cjs',write:false,plugins:[{name:'mocks',setup(b){b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));}}]});
 const m={exports:{} as any};new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(import.meta.url),m,m.exports);
 (globalThis as any).__pageReads=0;
 (globalThis as any).__pageFailure='supplier';assert.deepEqual(await m.exports.readOfferDetailForPage('ajes-stats-123'),{offer:null,unavailable:true});
 (globalThis as any).__pageFailure='disabled';assert.deepEqual(await m.exports.readOfferDetailForPage('ajes-stats-123'),{offer:null,unavailable:true,disabled:true});
 (globalThis as any).__pageFailure='unexpected';await assert.rejects(m.exports.readOfferDetailForPage('ajes-stats-123'),/unexpected/);
 const reads=(globalThis as any).__pageReads;
 for(const id of ['ajes-china-123','ajes-korea-123']){
  assert.deepEqual(await m.exports.readOfferDetailForPage(id),{offer:null,unavailable:false});
  assert.equal(await m.exports.getOfferForPage(id),null);assert.equal(await m.exports.getOfferDetailRecord(id),null);
 }
 assert.equal((globalThis as any).__pageReads,reads,'retired AJ IDs never read storage or editorial data');
 delete (globalThis as any).__pageFailure;assert.equal((await m.exports.readOfferDetailForPage('ajes-stats-123')).offer.id,'ajes-stats-123');
 delete (globalThis as any).__pageReads;
});

test('layout, legacy redirect and calculation distinguish active source failures from retired AJ IDs',async()=>{
 const mocks:Record<string,string>={
  'react':`export const cache=f=>f;`,
  'next/cache':`export const unstable_cache=f=>f;`,
  './collection-controls':`export class CollectionDisabledError extends Error{}`,
  './ajes-client':`export class AjesUnavailable extends Error{}`,
  './prepared-china-http-fixture':`export class PreparedChinaFixtureUnavailable extends Error{};export const hasPreparedChinaHttpFixture=()=>false;export const hasIndependentChinaHttpFixture=()=>false;export const preparedChinaNormalRegcloudEnabled=()=>false;export const assertIndependentChinaFallbackAllowed=async()=>{throw Error('unexpected prepared lookup')};export const readPreparedChinaFixtureOffer=async()=>{throw Error('unexpected prepared lookup')};`,
  './editorial':`export const readCatalogEditorial=async()=>{globalThis.__layoutReads++;return {entries:{}};};export const matchingEditorial=()=>undefined;export const editorialHidden=()=>false;export const applyCatalogEditorial=x=>x;`,
  './storage':`import {CollectionDisabledError} from './collection-controls';import {AjesUnavailable} from './ajes-client';export const getOfferWithoutEditorial=async()=>{globalThis.__layoutReads++;if(globalThis.__layoutFailure==='disabled')throw new CollectionDisabledError();if(globalThis.__layoutFailure==='supplier')throw new AjesUnavailable();throw Error('unexpected')};export const getOfferFromCurrentShard=async()=>{globalThis.__layoutReads++;return null;};export const getOfferFromCurrentProjection=async()=>{globalThis.__layoutReads++;return null;};export const isJapanCatalogOfferId=()=>false;`,
  '@/lib/dealers/showcase-model':`export const parseSpecialId=()=>null;`,
  '@/lib/catalog/offer-url':`export const offerRouteId=v=>v;export const offerPath=()=>{throw Error('no unavailable slug')};`,
  '@/lib/catalog/saved-offer-calculation':`export const getSavedOfferCalculation=async()=>{throw Error('must not calculate unavailable car')};`,
  '@/components/catalog/OfferSpecGridStabilizer':`export const OfferSpecGridStabilizer=()=>null;`,
  '@/lib/catalog/spec-normalization':`export const normalizeVehicleOfferSpecs=v=>v;`,
  '@/lib/catalog/image-quality':`export const rankedCatalogImageUrls=()=>[];`,
  '@/lib/catalog/public-priority':`export const catalogOfferVisibleRub=()=>0;`,
  '@/lib/ai-discovery':`export const absoluteAvtocenaUrl=v=>v;export const catalogOfferUrl=v=>v;`,
  '@/lib/catalog/power-sanity':`export const publicCatalogPowerHp=()=>0;`,
  '@/lib/catalog/presentation':`export const presentCatalogOffer=v=>v;`,
  '@/lib/catalog/calculation-request-origin':`export const isCalculationOriginAllowed=()=>true;`,
  '@/lib/catalog/customer-parameters':`export const validateCustomerParameters=v=>v;`,
  '@/lib/catalog/customs-pricing':`export const calculateOfferWithCustomerParametersDetailed=()=>{throw Error('must not calculate unavailable car')};`,
  'next/server':`export const NextResponse={json:(body,{status=200,headers}={})=>new Response(JSON.stringify(body),{status,headers})};`,
 };
 const bundle=await build({stdin:{contents:`export {default as Layout} from './apps/web/app/(public)/cars/offer/[id]/layout';export {GET} from './apps/web/app/api/catalog/offer-redirect/[id]/route';export {POST} from './apps/web/app/api/catalog/offer/[id]/calculate/route';`,resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',jsx:'automatic',packages:'external',write:false,plugins:[{name:'layout-mocks',setup(b){b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));}}]});
 const m={exports:{} as any};new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(import.meta.url),m,m.exports);
 const {renderToStaticMarkup}=await import('react-dom/server');
 (globalThis as any).__layoutReads=0;
 for(const reason of ['disabled','supplier'])for(const id of ['ajes-stats-123','paid-china-123','paid-korea-123','paid-uae-123']){
  (globalThis as any).__layoutFailure=reason;
  const html=renderToStaticMarkup(await m.exports.Layout({params:Promise.resolve({id}),children:'Unavailable content'}));
  assert.ok(html.includes('Unavailable content'));assert.equal(html.includes('application/ld+json'),false);
  const params=Promise.resolve({id});
  const redirect=await m.exports.GET(new Request('https://avtocena.com/api/catalog/offer-redirect/'+id),{params});
  assert.equal(redirect.status,307);assert.equal(redirect.headers.get('location'),'/cars/offer/avtomobil--'+id);
  const calculation=await m.exports.POST(new Request('https://avtocena.com/api/catalog/offer/x/calculate',{method:'POST',body:'{}'}),{params});
  assert.equal(calculation.status,reason==='disabled'?410:503);assert.ok((await calculation.json()).error);

 }
 (globalThis as any).__layoutFailure='unexpected';await assert.rejects(m.exports.Layout({params:Promise.resolve({id:'ajes-stats-123'}),children:'content'}),/unexpected/);
 const reads=(globalThis as any).__layoutReads;
 for(const id of ['ajes-china-123','ajes-korea-123']){
  const params=Promise.resolve({id});
  const html=renderToStaticMarkup(await m.exports.Layout({params,children:'Unavailable content'}));
  assert.ok(html.includes('Unavailable content'));assert.equal(html.includes('application/ld+json'),false);
  const redirect=await m.exports.GET(new Request('https://avtocena.com/api/catalog/offer-redirect/'+id),{params});
  assert.equal(redirect.status,307);assert.equal(redirect.headers.get('location'),'/cars/offer/avtomobil--'+id);
  const calculation=await m.exports.POST(new Request('https://avtocena.com/api/catalog/offer/x/calculate',{method:'POST',body:'{}'}),{params});
  assert.equal(calculation.status,404);assert.ok((await calculation.json()).error);
 }
 assert.equal((globalThis as any).__layoutReads,reads,'retired AJ IDs cannot trigger source or editorial reads from layout, redirect or calculation');
 delete (globalThis as any).__layoutFailure;
 delete (globalThis as any).__layoutReads;
});
