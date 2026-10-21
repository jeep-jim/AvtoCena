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

test('layout, legacy redirect and calculation contain disabled sources for every paid market',async()=>{
 const mocks:Record<string,string>={
  'react':`export const cache=f=>f;`,
  'next/cache':`export const unstable_cache=f=>f;`,
  './collection-controls':`export class CollectionDisabledError extends Error{}`,
  './ajes-client':`export class AjesUnavailable extends Error{}`,
  './editorial':`export const readCatalogEditorial=async()=>({});export const editorialHidden=()=>false;export const applyCatalogEditorial=x=>x;`,
  './storage':`import {CollectionDisabledError} from './collection-controls';import {AjesUnavailable} from './ajes-client';export const getOfferWithoutEditorial=async()=>{if(globalThis.__layoutFailure==='disabled')throw new CollectionDisabledError();if(globalThis.__layoutFailure==='supplier')throw new AjesUnavailable();throw Error('unexpected')};export const getOfferFromCurrentShard=async()=>null;export const getOfferFromCurrentProjection=async()=>null;export const isJapanCatalogOfferId=()=>false;`,
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
 for(const reason of ['disabled','supplier'])for(const market of ['china','korea','stats']){
  (globalThis as any).__layoutFailure=reason;
  const html=renderToStaticMarkup(await m.exports.Layout({params:Promise.resolve({id:'ajes-'+market+'-123'}),children:'Unavailable content'}));
  assert.ok(html.includes('Unavailable content'));assert.equal(html.includes('application/ld+json'),false);
  const params=Promise.resolve({id:'ajes-'+market+'-123'});
  const redirect=await m.exports.GET(new Request('https://avtocena.com/api/catalog/offer-redirect/ajes-'+market+'-123'),{params});
  assert.equal(redirect.status,307);assert.equal(redirect.headers.get('location'),'/cars/offer/avtomobil--ajes-'+market+'-123');
  const calculation=await m.exports.POST(new Request('https://avtocena.com/api/catalog/offer/x/calculate',{method:'POST',body:'{}'}),{params});
  assert.equal(calculation.status,reason==='disabled'?410:503);assert.ok((await calculation.json()).error);

 }
 (globalThis as any).__layoutFailure='unexpected';await assert.rejects(m.exports.Layout({params:Promise.resolve({id:'ajes-china-123'}),children:'content'}),/unexpected/);
 delete (globalThis as any).__layoutFailure;
});
