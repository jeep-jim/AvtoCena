import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {ajesPricingCorrectionIds,createAjesCountPricingContext,type AjesCountPricingInputs} from '../apps/web/lib/catalog/ajes-count-pricing-context';

const fixture=():AjesCountPricingInputs=>({runtimeSha:'a'.repeat(40),day:'2026-11-28',
 editorial:{revision:'r1',entries:{}},calculationDigest:'b'.repeat(64),configuration:{version:3,rfDeliveryRub:50000},
 rates:[['JPY',{effectiveRate:0.61,rateDate:'2026-11-28'},true]],
 knowledge:{version:1,revision:'k1',models:{}},previews:{version:1,entries:{}}});
const snapshot=(input:AjesCountPricingInputs)=>({editorial:input.editorial,calculationIndex:{digest:input.calculationDigest}} as any);
const offer=(id:string)=>({id:`ajes-stats-${id}`,market:'japan' as const,sourceId:'ajes_japan_feed',sourceOfferId:id,operational:{raw:{}}});

test('exact price count is discarded if any actual pricing authority changes during work',async()=>{
 for(const change of [
  (i:AjesCountPricingInputs)=>{i.editorial.revision='r2';},
  (i:AjesCountPricingInputs)=>{i.calculationDigest='c'.repeat(64);},
  (i:AjesCountPricingInputs)=>{i.knowledge.revision='k2';},
  (i:AjesCountPricingInputs)=>{i.configuration={version:4};},
  (i:AjesCountPricingInputs)=>{i.rates=[['JPY',null]];},
  (i:AjesCountPricingInputs)=>{i.day='2026-11-29';},
  (i:AjesCountPricingInputs)=>{i.previews.entries['ajes-stats-one']={market:'japan',sourceId:'ajes_japan_feed',sourceOfferId:'one',savedAt:'new'};},
 ]){
  const initial=fixture(),current=structuredClone(initial);
  const context=await createAjesCountPricingContext(snapshot(initial),{read:async()=>structuredClone(current),price:async offers=>offers});
  await assert.rejects(context.run(async()=>{change(current);return 73;}),/ajes_count_context_changed/);
 }
});

test('stable pricing epoch preserves order and membership; use outside its fence is rejected',async()=>{
 const input=fixture();let calls=0;
 const context=await createAjesCountPricingContext(snapshot(input),{read:async()=>structuredClone(input),price:async offers=>{calls++;return offers.map(o=>({...o,totalRub:750000}));}});
 assert.match(context.digest,/^[a-f0-9]{64}$/);
 const rows=[offer('one'),offer('two')];
 await assert.rejects(context.price(rows),/outside_context/);
 assert.equal(calls,0);
 const result=await context.run(()=>context.price(rows));
 assert.deepEqual(result.map(o=>o.id),rows.map(o=>o.id));
 assert.deepEqual(result.map(o=>o.totalRub),[750000,750000]);
 assert.equal(calls,1);
 for(const invalid of [{...offer('one'),market:'china'},{...offer('one'),sourceOfferId:'other'},{...offer('one'),operational:undefined}])
  await assert.rejects(context.run(()=>context.price([invalid as any])),/ajes_count_price_identity/);
 assert.equal(calls,1,'foreign or compact records must never reach a detail-fetching preview stage');
});

test('capture binds the list snapshot before price work begins',async()=>{
 const input=fixture(),other=fixture();other.editorial.revision='other';
 await assert.rejects(createAjesCountPricingContext(snapshot(input),{read:async()=>other,price:async offers=>offers}),/context_changed/);
});

test('identity corrections include only finite existing AJ records and targeted knowledge',()=>{
 const input=fixture();
 input.editorial.entries={
  'ajes-stats-edit':{market:'japan',sourceId:'ajes_japan_feed',sourceOfferId:'edit'},
  'ajes-stats-mismatch':{market:'japan',sourceId:'ajes_japan_feed',sourceOfferId:'wrong'},
  'other-market':{market:'china',sourceId:'che168',sourceOfferId:'other-market'},
 } as any;
 input.previews.entries={
  'ajes-stats-saved':{market:'japan',sourceId:'ajes_japan_feed',sourceOfferId:'saved'},
  'ajes-stats-foreign':{market:'korea',sourceId:'encar',sourceOfferId:'foreign'},
 };
 input.knowledge.models={a:{one:{offerId:'ajes-stats-donor',targetOfferId:'ajes-stats-target'},two:{offerId:'encyclopedia:some:variant',targetOfferId:'other-market'}}} as any;
 assert.deepEqual(ajesPricingCorrectionIds(input),['ajes-stats-donor','ajes-stats-edit','ajes-stats-saved','ajes-stats-target']);
});

test('complete AJ records reuse calculation stages and local saved inputs without supplier detail reads',async()=>{
 const calls:any[]=[];const input=fixture();
 input.previews.entries['ajes-stats-saved']={market:'japan',sourceId:'ajes_japan_feed',sourceOfferId:'saved'};
 (globalThis as any).__japanCountPrice={calls};
 try{
  const built=await build({entryPoints:['apps/web/lib/catalog/ajes-count-pricing-context.ts'],bundle:true,platform:'node',format:'cjs',write:false,
   plugins:[{name:'stage-fixture',setup(b){
    b.onResolve({filter:/.*/},args=>args.kind==='entry-point'||args.path.startsWith('node:')?undefined:{path:args.path,namespace:'stage-fixture'});
    b.onLoad({filter:/.*/,namespace:'stage-fixture'},args=>{
     const prefix='const {calls}=globalThis.__japanCountPrice;';
     const code=args.path.endsWith('/live-business-pricing')?`export const applyActiveBusinessPriceBatch=async(rows,options,markets)=>{calls.push(['business',rows.map(o=>o.id),markets]);return rows;};`
      :args.path.endsWith('/display-identity')?`export const applyEncyclopediaDisplayIdentityBatch=async rows=>{calls.push(['identity']);return rows;};`
      :args.path.endsWith('/saved-offer-calculation')?`export const getSavedOfferCalculation=async(offer,version,knowledge)=>{calls.push(['saved',offer.id,knowledge.revision]);return {offerId:offer.id};};`
      :args.path.endsWith('/saved-calculation-previews')?`export const SAVED_PREVIEW_PATH='local-previews';export const savedPreviewEntry=(record,offer)=>({preview:{totalRub:800000}});export const readSavedPreviewIndex=()=>{throw Error('unexpected supplier detail refresh');};`
      :args.path.endsWith('/japan-delivered-preview')?`export const attachJapanDeliveredPreviews=async(rows,config)=>{calls.push(['japan',config]);return rows.map(o=>o.savedCalculationPreview?o:{...o,japanDeliveredPreview:{totalRub:700000}});};`
      :args.path.endsWith('/management-previews')?`export const attachManagementPreviews=async(rows,markets)=>{calls.push(['management',rows.map(o=>o.id)]);return rows;};`
      :args.path.endsWith('/rates')?`export const convertToRub=()=>{};export const catalogPricingNow=()=>0;`
      :args.path.endsWith('/editorial')?`export const readCatalogEditorial=()=>{};`
      :args.path.endsWith('/calculation-index')?`export const readCalculationIndex=()=>{};`
      :args.path.endsWith('/effective-market-settings')?`export const getEffectiveMarketVersion=()=>{};`
      :args.path.endsWith('/management-knowledge')?`export const readManagementKnowledge=()=>{};`
      :args.path.endsWith('/data')?`export const readDataJson=()=>{};`
      :`throw Error('unexpected import');`;
     return {contents:prefix+code};
    });
   }}]});
  const mod={exports:{} as any};new Function('require','module','exports',built.outputFiles[0].text)(createRequire(import.meta.url),mod,mod.exports);
  const result=await mod.exports.priceAjesCountOffers([offer('plain'),offer('saved')],input);
  assert.equal(result[0].japanDeliveredPreview.totalRub,700000);
  assert.equal(result[1].savedCalculationPreview.totalRub,800000);
  assert.deepEqual(calls.filter(v=>v[0]==='saved'),[['saved','ajes-stats-saved','k1']]);
  assert.deepEqual(calls.filter(v=>v[0]==='management').map(v=>v[1]),[['ajes-stats-plain'],['ajes-stats-saved']]);
  assert.deepEqual(calls[0][2],[{id:'japan',effectiveVersion:input.configuration}]);
 }finally{delete (globalThis as any).__japanCountPrice;}
});
