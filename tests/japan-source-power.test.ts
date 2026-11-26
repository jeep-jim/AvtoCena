import test,{mock} from 'node:test';
import assert from 'node:assert/strict';
import {parseJapanSourcePower,japanSupplierPower,japanSupplierPowerLabel,japanUnknownPower,japanPowerFilterSummary,japanPowerFilterNotice} from '../apps/web/lib/catalog/japan-source-power';
import {ajesResultFilter} from '../apps/web/lib/catalog/ajes-result-filter';
import {ajesPowerEstimateHp} from '../apps/web/lib/catalog/ajes-power-estimate';
import {ajesCatalogQuery,ajesLot,ajesQuery,ajesSourceCacheSql} from '../apps/web/lib/catalog/ajes-query';
import {ajesOffer} from '../apps/web/lib/catalog/ajes-offer';
import {createAjesClient} from '../apps/web/lib/catalog/ajes-client';
import {publicOffer} from '../apps/web/lib/catalog/storage';
import {offerParameterDraft} from '../apps/web/lib/catalog/offer-parameter-draft';
import {readFilteredAjesPage} from '../apps/web/lib/catalog/ajes-filtered-page';
import {applyJapanOwnerSpecifications} from '../apps/web/lib/catalog/japan-owner-specifications';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const row={ID:'power-fixture',MARKA_NAME:'TOYOTA',MODEL_NAME:'TEST',YEAR:2023,AUCTION_TYPE:2,STATUS:'Sold',FINISH:935000,TIME:'P',PW:'150',ENG_V:1490,IMAGES:''};
const rate={currency:'JPY',sourcePrice:935000,effectiveRate:0.6,cbrRate:60,nominal:100,rateDate:'2026-11-26',rateSource:'cbr'} as any;
function offer(power:unknown,id='power-fixture',fuel='P'){
 return ajesOffer(ajesLot({...row,ID:id,PW:power,TIME:fuel},'stats',false)!,rate,'2026-11-26T04:00:00Z');
}

const sourcePage=(query:any,items:any[],received=items.length,flags:Record<string,unknown>={})=>({items,page:query.page||1,pageSize:query.pageSize||24,received,partial:false,stale:false,observedAt:'2026-11-26T06:02:33.366Z',...flags});
async function catalogPowerFixture(read:(query:any)=>unknown|Promise<unknown>){
 const state={queries:[] as any[],counts:0,priced:[] as string[][],query:ajesCatalogQuery,filter:ajesResultFilter,project:publicOffer,read:async(query:any)=>{state.queries.push(query);return read(query);}};
 (globalThis as any).__japanPowerPageFixture=state;
 const stubs:Record<string,string>={
  'server-only':'','next/headers':"export const headers=async()=>new Map([['x-real-ip','127.0.0.1']]);",
  './ajes-runtime':"export const ajesClient={read:async()=>{globalThis.__japanPowerPageFixture.counts++;throw Error('unexpected source aggregate');}};",
  './ajes-public':'export const cappedAjesQuery=async q=>q;export const readAjesPublic=q=>globalThis.__japanPowerPageFixture.read(q);',
  './ajes-query':'export const ajesCatalogQuery=p=>globalThis.__japanPowerPageFixture.query(p);export class AjesFilterUnavailable extends Error{};export class AjesInputError extends Error{};',
  './ajes-client':'export const readAjesModelDirectory=async()=>({models:[]});export const readAjesMakeDirectory=async()=>({makes:[]});export class AjesUnavailable extends Error{};',
  './ajes-result-filter':'export const ajesResultFilter=p=>globalThis.__japanPowerPageFixture.filter(p);',
  './storage':'export const publicOffer=x=>globalThis.__japanPowerPageFixture.project(x);','./market-page':'export const sortCatalogRows=x=>x;',
  './live-business-pricing':'export const applyActiveBusinessPricingBatch=async rows=>{globalThis.__japanPowerPageFixture.priced.push(rows.map(row=>row.id));return rows;};',
  './collection-controls':'export const assertCollectionEnabled=async()=>{};',
  './japan-preview-parameters':'export const japanPreviewParameters=()=>({});',
  '../encyclopedia/calculation-evidence':'export const hasEncyclopediaCalculationEvidence=()=>false;',
 };
 const bundle=await build({entryPoints:['apps/web/lib/catalog/ajes-catalog.ts'],bundle:true,platform:'node',format:'cjs',write:false,external:['react'],plugins:[{name:'power-page-fixture',setup(builder){
  builder.onResolve({filter:/.*/},args=>args.path in stubs?{path:args.path,namespace:'power-page-fixture'}:undefined);
  builder.onLoad({filter:/.*/,namespace:'power-page-fixture'},args=>({contents:stubs[args.path]}));
 }}]});
 const module={exports:{} as any},require=createRequire(import.meta.url);
 new Function('require','module','exports',bundle.outputFiles[0].text)((id:string)=>id==='react'?{cache:(fn:any)=>fn}:require(id),module,module.exports);
 return {state,read:module.exports.readAjesCatalogPage,close:()=>{delete (globalThis as any).__japanPowerPageFixture;}};
}

test('power selection returns 23 fresh rows from the requested source page without reading a failing next page',async()=>{
 const fixture=await catalogPowerFixture(query=>{
  if(query.page!==1)throw Error('next source page unavailable');
  return sourcePage(query,Array.from({length:23},(_,i)=>offer('',`fresh-${i}`)),24);
 });
 try{
  const result=await fixture.read({market:'japan',powerTo:'160',city:'Новокузнецк'});
  assert.deepEqual(fixture.state.queries.map(query=>query.page),[1]);assert.equal(fixture.state.counts,0);
  assert.equal(result.items.length,23);assert.equal(result.received,24);assert.equal(result.hasMore,true);
  assert.equal(result.total,null);assert.equal(result.countSummary,null);assert.equal(result.nextCursor,undefined);
  assert.equal(result.observedAt,'2026-11-26T06:02:33.366Z');assert.equal(result.generationId,result.observedAt);
  for(const flag of ['partial','stale','scanLimited','interrupted'])assert.equal(result[flag],false,flag);
  assert.deepEqual(result.powerFilterSummary,{shown:23,localPower:0,supplierPower:0,unknownPower:23});
  assert.ok(result.items.every((item:any)=>item.japanPowerUnknown===true));
 }finally{fixture.close();}
});

test('power numbered pages preserve source offsets without borrowing or repeating cars',async()=>{
 const fixture=await catalogPowerFixture(query=>sourcePage(query,
  (query.page===1?Array.from({length:23},()=>undefined):query.page===2?[150,200,'',180]:[120]).map((pw,i)=>offer(pw,`page-${query.page}-${i}`)),query.page===3?1:24));
 try{
  const results=[];
  for(const page of ['1','2','3'])results.push(await fixture.read({market:'japan',powerTo:'160',page}));
  assert.deepEqual(fixture.state.queries.map(query=>query.page),[1,2,3]);
  assert.deepEqual(results.map(result=>result.items.length),[23,2,1]);
  assert.deepEqual(results.map(result=>result.hasMore),[true,true,false]);
  assert.ok(results.every(result=>result.nextCursor===undefined&&result.total===null&&result.countSummary===null));
  const ids=results.flatMap(result=>result.items.map((item:any)=>item.id));assert.equal(new Set(ids).size,26);
  assert.deepEqual(results[1].items.map((item:any)=>item.id),['ajes-stats-page-2-0','ajes-stats-page-2-2']);
  assert.equal(fixture.state.counts,0);
 }finally{fixture.close();}
});

test('an all-over-limit source page keeps explicit continuation and never reports a zero catalogue total',async()=>{
 const fixture=await catalogPowerFixture(query=>sourcePage(query,Array.from({length:24},(_,i)=>offer(180,`over-${i}`)),24));
 try{
  const result=await fixture.read({market:'japan',powerTo:'160'});
  assert.deepEqual(fixture.state.queries.map(query=>query.page),[1]);assert.deepEqual(result.items,[]);
  assert.equal(result.hasMore,true);assert.equal(result.nextCursor,undefined);assert.equal(result.total,null);assert.equal(result.countSummary,null);
  assert.equal(result.scanLimited,false);assert.equal(result.stale,false);
  assert.deepEqual(result.powerFilterSummary,{shown:0,localPower:0,supplierPower:0,unknownPower:0});
 }finally{fixture.close();}
});

test('only a fresh exhausted first power page establishes an exact filtered count',async()=>{
 const fixture=await catalogPowerFixture(query=>sourcePage(query,[150,200,''].map((pw,i)=>offer(pw,`last-${i}`)),3));
 try{
  const result=await fixture.read({market:'japan',powerTo:'160'});
  assert.equal(result.hasMore,false);assert.equal(result.items.length,2);assert.equal(result.total,2);
  assert.deepEqual(result.countSummary,{total:2,upperBound:false,stale:false,observedAt:result.observedAt});
  assert.deepEqual(result.powerFilterSummary,{shown:2,localPower:0,supplierPower:1,unknownPower:1});
  assert.equal(result.nextCursor,undefined);assert.equal(fixture.state.queries.length,1);
 }finally{fixture.close();}
});

test('source-page power selection preserves stale and partial evidence instead of promoting it to fresh or exact',async()=>{
 for(const flags of [{stale:true},{partial:true},{partial:true,stale:true}]){
  const fixture=await catalogPowerFixture(query=>sourcePage(query,[offer('', 'saved')],1,flags));
  try{
   const result=await fixture.read({market:'japan',powerTo:'160'});
   assert.equal(result.stale,Boolean(flags.stale));assert.equal(result.partial,Boolean(flags.partial));
   assert.equal(result.observedAt,'2026-11-26T06:02:33.366Z');assert.equal(result.total,null);assert.equal(result.countSummary,null);
   assert.equal(result.hasMore,false);assert.equal(result.items.length,1);assert.equal(fixture.state.queries.length,1);
  }finally{fixture.close();}
 }
});

test('power combined with body, fuel, drive and color still applies every local condition to the requested page',async()=>{
 const matching={bodyType:'sedan',fuel:'petrol',drive:'awd',color:'белый'};
 const rows=[
  {...offer(150,'combined-known'),...matching},{...offer('','combined-unknown'),...matching},
  {...offer(200,'combined-high'),...matching},{...offer('','combined-body'),...matching,bodyType:'suv'},
  {...offer('','combined-fuel'),...matching,fuel:'diesel'},{...offer('','combined-drive'),...matching,drive:'fwd'},
  {...offer('','combined-color'),...matching,color:'красный'},
 ];
 const fixture=await catalogPowerFixture(query=>sourcePage(query,rows,24));
 try{
  const result=await fixture.read({market:'japan',powerTo:'160',...matching,city:'Новокузнецк'});
  assert.deepEqual(result.items.map((item:any)=>item.id),['ajes-stats-combined-known','ajes-stats-combined-unknown']);
  assert.equal(fixture.state.queries.length,1);assert.equal(result.hasMore,true);assert.equal(result.total,null);
  for(const key of ['fuel','drive','color'] as const)assert.equal(fixture.state.queries[0][key],matching[key]);
  assert.deepEqual(result.powerFilterSummary,{shown:2,localPower:0,supplierPower:1,unknownPower:1});
 }finally{fixture.close();}
});

test('already issued power cursors keep their exact source offset and skip through the existing continuation reader',async()=>{
 const fixture=await catalogPowerFixture(query=>sourcePage(query,Array.from({length:24},(_,i)=>offer('',`cursor-${query.page}-${i}`)),24));
 try{
  const result=await fixture.read({market:'japan',powerTo:'160',page:'2',after:'2.3'});
  assert.deepEqual(fixture.state.queries.map(query=>query.page),[2,3]);assert.equal(result.items.length,24);
  assert.equal(result.items[0].id,'ajes-stats-cursor-2-3');assert.equal(result.items.at(-1).id,'ajes-stats-cursor-3-2');
  assert.equal(new Set(result.items.map((item:any)=>item.id)).size,24);assert.equal(result.nextCursor,'3.3');
  assert.equal(result.hasMore,true);assert.equal(result.total,null);
 }finally{fixture.close();}
});

test('power plus delivered-price filtering retains the existing priced continuation path',async()=>{
 const pricedOffer=(power:unknown,id:string)=>({...offer(power,id),catalogPricingMode:undefined,totalRub:500000});
 const fixture=await catalogPowerFixture(query=>sourcePage(query,query.page===1?
  [pricedOffer(150,'price-first'),pricedOffer(200,'price-excluded')]:Array.from({length:24},(_,i)=>pricedOffer(150,`price-next-${i}`)),24));
 try{
  const result=await fixture.read({market:'japan',powerTo:'160',budgetTo:'900000'});
  assert.deepEqual(fixture.state.queries.map(query=>query.page),[1,2]);assert.equal(result.items.length,24);
  assert.equal(result.nextCursor,'2.23');assert.equal(result.hasMore,true);assert.equal(result.total,null);
  assert.deepEqual(fixture.state.priced.map(ids=>ids.length),[1,24]);
  assert.ok(!fixture.state.priced.flat().includes('ajes-stats-price-excluded'),'known excessive power is removed before price work');
 }finally{fixture.close();}
});

test('supplier integer horsepower accepts number or varchar digits, never selects a comma alternative',()=>{
 for(const value of [160,'160',' 160 ','00160'])assert.equal(parseJapanSourcePower(value),160);
 assert.equal(parseJapanSourcePower(2501),2501);
 for(const value of ['',0,-1,'0','150,180','180,150','160.5','160.0',1.5,'160 hp','1e2','160;drop',null,{},[],'9'.repeat(31),Number.MAX_SAFE_INTEGER+1])assert.equal(parseJapanSourcePower(value),undefined,String(value));
});

test('Japan power selection uses local facts first, scalar supplier hp second and retains labelled unknown rows',()=>{
 const filter=ajesResultFilter({market:'japan',powerFrom:80,powerTo:160});
 for(const [pw,expected] of [[80,true],[160,true],[79,false],[161,false],[2501,false],['',true],['170,52',true],['bad',true]] as const)assert.equal(filter.matches(offer(pw)),expected,String(pw));
 assert.equal(filter.matches({...offer(200),powerHp:150}),true);
 assert.equal(filter.matches({...offer(150),powerHp:180}),false);
 assert.equal(filter.matches({...offer(''),savedCalculationPreview:{parameters:{powerHp:180},totalRub:1000000}}),true);
 assert.equal(japanUnknownPower({...offer(''),savedCalculationPreview:{parameters:{powerHp:150}}}),true);
 for(const market of ['china','korea','uae'])assert.equal(ajesResultFilter({market,powerTo:160}).matches({...offer(150),market}),false);
 assert.equal(filter.matches({...offer(150),id:'another-provider'}),false);
 assert.equal(filter.matches({...offer(150),sourceId:'another-provider'}),false);
 const owner={...offer(200),make:'HONDA',model:'STEPWGN',fuel:'petrol',powertrainKind:'combustion',operational:{chassisCode:'RP3',raw:{sourceFuel:'P',sourcePower:'200'}}};
 assert.equal(filter.matches(owner),true);
 assert.equal(japanSupplierPower(owner),undefined);
 const ownerDto=publicOffer(applyJapanOwnerSpecifications(owner as any));
 assert.equal(ownerDto.powerHp,150,'the existing reader owner override is an explicit public local value');
 assert.equal(ownerDto.japanSupplierPower,undefined);
 assert.equal(ownerDto.japanPowerUnknown,undefined);
 assert.deepEqual(japanPowerFilterSummary([ownerDto]),{shown:1,localPower:1,supplierPower:0,unknownPower:0});
});

test('public supplier hp and unknown state survive projection without changing prices or calculation power',()=>{
 for(const fuel of ['P','H','E']){
  const input=offer('150','public-'+fuel,fuel),before=JSON.stringify(input);
  const output=publicOffer(input) as any;
  assert.deepEqual(output.japanSupplierPower,{offerId:input.id,hp:150,unit:'hp',source:'ajes_pw'});
  assert.equal(japanSupplierPowerLabel(output),'150 л.с. · поставщик');
  for(const key of ['powerHp','powerKw','power30MinKw','utilizationPowerKw','operational','sourceId'])assert.equal(output[key],undefined,key);
  assert.equal(output.totalRub,null);assert.equal(output.catalogPricingMode,'seller');
  assert.equal(ajesPowerEstimateHp(input),undefined);assert.equal(ajesPowerEstimateHp(output),undefined);
  assert.equal(offerParameterDraft(input).powerHp,'');assert.equal(offerParameterDraft(input).power30MinKw,'');
  assert.equal(JSON.stringify(input),before);
  assert.equal(ajesResultFilter({market:'japan',powerTo:160}).matches(output),true);
  assert.equal(japanSupplierPower({...output,id:'ajes-stats-other'}),undefined);
  assert.equal(japanSupplierPower({...output,japanSupplierPower:{...output.japanSupplierPower,unit:'kw'}}),undefined);
  assert.equal(japanSupplierPower({...output,powerHp:180}),undefined);
  assert.deepEqual((publicOffer(output) as any).japanSupplierPower,output.japanSupplierPower);
 }
 const unknown=publicOffer(offer('150,180')) as any;
 assert.equal(unknown.japanPowerUnknown,true);assert.equal(unknown.japanSupplierPower,undefined);
 assert.equal(japanUnknownPower(unknown),true);
 const summary=japanPowerFilterSummary([publicOffer({...offer(200),make:'HONDA',model:'STEPWGN',fuel:'petrol',powertrainKind:'combustion'}),publicOffer(offer(120)),unknown]);
 assert.deepEqual(summary,{shown:3,localPower:1,supplierPower:1,unknownPower:1});
 assert.match(japanPowerFilterNotice(summary),/Мощность не указана: 1/);
 assert.match(japanPowerFilterNotice(summary),/не подтверждает право/);
});

test('power and ordinary queries share only the equivalent raw source selection',()=>{
 for(const table of ['stats','main'] as const)for(const query of [{},{make:'TOYOTA',page:2},{yearFrom:2020,yearTo:2023},{drive:'awd'}]){
  const ordinary=ajesQuery({table,...query}),power=ajesQuery({table,...query,powerTo:160});
  assert.equal(ajesSourceCacheSql(power.sql),ajesSourceCacheSql(ordinary.sql));
  assert.doesNotMatch(power.sql,/pw\s*(?:>=|<=|>|<)/i);
  assert.ok(new URLSearchParams({sql:power.sql}).toString().length<6000);
 }
 const original=ajesSourceCacheSql(ajesQuery({}).sql);
 for(const query of [{table:'main' as const},{page:2},{pageSize:12},{make:'HONDA'},{yearFrom:2020}])assert.notEqual(ajesSourceCacheSql(ajesQuery(query).sql),original);
});

test('power toggle reuses the same fresh raw page without another supplier request or losing source PW',async()=>{
 let reads=0;
 const client=createAjesClient({password:()=> 'fixture-secret',assertEnabled:async()=>{},reserve:async()=>{},fetcher:async()=>{reads++;return new Response(JSON.stringify([row,{...row,ID:'unknown',PW:''}]));}});
 const ordinary=await client.read({table:'stats'},'127.0.0.1');
 const filtered=await client.read({table:'stats',powerTo:160},'127.0.0.1');
 const otherPower=await client.read({table:'stats',powerTo:100},'127.0.0.1');
 assert.equal(reads,1);assert.deepEqual(filtered,ordinary);assert.deepEqual(otherPower,ordinary);
 assert.equal(filtered.items[0].sourcePower,'150');assert.equal(filtered.items[1].sourcePower,'');
});

test('power query reuses persisted ordinary page, without treating another page or stale result as fresh',async()=>{
 const ordinarySql=ajesQuery({}).sql;
 const saved={schemaVersion:2,stale:false,partial:false,items:[ajesLot(row,'stats',false)],page:1,pageSize:24,received:1,observedAt:new Date().toISOString()};
 for(const [patch,expected] of [[{},0],[{page:2},1],[{observedAt:new Date(Date.now()-31*60000).toISOString()},1]] as const){
  let reads=0;
  const client=createAjesClient({password:()=> 'fixture-secret',assertEnabled:async()=>{},reserve:async()=>{},readQuery:async sql=>sql===ordinarySql?{...saved,...patch}:null,fetcher:async()=>{reads++;return new Response(JSON.stringify([row]));}});
  const result=await client.read({powerTo:160},'127.0.0.1');
  assert.equal(reads,expected);assert.equal(result.stale,false);assert.equal(result.items[0].sourcePower,'150');
 }
});

test('fresh restored details expire at the original observation deadline, not 30 minutes after restart',async()=>{
 let now=Date.now(),reads=0;
 const clock=mock.method(Date,'now',()=>now);
 const saved={schemaVersion:2,items:[ajesLot(row,'stats',true)],page:1,pageSize:1,received:1,observedAt:new Date(now-29*60000).toISOString()};
 try{
  const client=createAjesClient({password:()=> 'fixture-secret',assertEnabled:async()=>{},reserve:async()=>{},readDetail:async()=>saved,fetcher:async()=>{reads++;return new Response(JSON.stringify([row]));}});
  const first=await client.read({id:row.ID},'127.0.0.1');assert.equal(reads,0);assert.equal(first.observedAt,saved.observedAt);
  now+=60_001;
  await client.read({id:row.ID},'127.0.0.1');assert.equal(reads,1);
 }finally{clock.mock.restore();}
});

test('power requests retain the ordinary source deadline and native failures cool down without renewing it',async()=>{
 let now=Date.now(),reads=0;
 const clock=mock.method(Date,'now',()=>now);
 const saved={schemaVersion:2,items:[ajesLot(row,'stats',false)],page:1,pageSize:24,received:1,observedAt:new Date(now-31*60000).toISOString()};
 const deadlines:number[]=[];
 const originalTimer=globalThis.setTimeout;
 const timer=mock.method(globalThis,'setTimeout',((callback:any,delay:any,...args:any[])=>{deadlines.push(Number(delay));return originalTimer(callback,delay,...args);}) as typeof setTimeout);
 try{
  const client=createAjesClient({password:()=> 'fixture-secret',assertEnabled:async()=>{},reserve:async()=>{},readQuery:async()=>saved,fetcher:async()=>{reads++;throw new TypeError('private connection failure');}});
  assert.equal((await client.read({powerTo:160},'127.0.0.1')).stale,true);
  assert.ok(deadlines.includes(20_000));assert.ok(!deadlines.includes(4500));
  now+=10_000;await client.read({powerTo:100},'127.0.0.1');assert.equal(reads,1);
  now+=19_000;await client.read({powerTo:160},'127.0.0.1');assert.equal(reads,1);
  now+=1_001;await client.read({powerTo:160},'127.0.0.1');assert.equal(reads,2);
  await client.read({powerTo:160},'127.0.0.2');assert.equal(reads,3);
 }finally{timer.mock.restore();clock.mock.restore();}
});

test('filtered continuation preserves matching and unknown cars without inventing a supplier total',async()=>{
 const all=[150,200,'',160,180,'bad'].map((pw,i)=>offer(pw,'row'+i));
 const filter=ajesResultFilter({market:'japan',powerTo:160});
 const read=async(page:number)=>{const rows=all.slice((page-1)*2,page*2);return {received:rows.length,items:rows.filter(filter.matches)};};
 const first=await readFilteredAjesPage({page:1,pageSize:2,read});
 const second=await readFilteredAjesPage({page:1,pageSize:2,after:first.nextCursor,read});
 assert.deepEqual([...first.items,...second.items].map(v=>v.id),['ajes-stats-row0','ajes-stats-row2','ajes-stats-row3','ajes-stats-row5']);
 const partial=await readFilteredAjesPage({page:1,pageSize:24,read:async()=>({received:3,items:[all[0],all[2]],partial:true,stale:true})});
 assert.equal(partial.partial,true);assert.equal(partial.stale,true);assert.equal('total' in partial,false);
 assert.deepEqual(japanPowerFilterSummary(partial.items),{shown:2,localPower:0,supplierPower:1,unknownPower:1});
});

test('actual grid and list cards cannot hide unknown PW behind an obsolete compact estimate',async()=>{
 const mocks:Record<string,string>={
  CatalogSelectionContext:'export const useCatalogView=()=>globalThis.__japanPowerCardView;',
  DealerBrowsingContext:'export const useDealerBrowsing=()=>null;',
  useSavedCalculationPreview:'export const useSavedCalculationPreview=()=>undefined;',
  FavoriteToggle:'export const FavoriteToggle=()=>null;',
  CatalogCover:'export const CatalogCover=()=>null;',
  CatalogPrice:'export const CatalogPrice=()=>null;',
  IntentPrefetchLink:'export const IntentPrefetchLink=({children})=>children;',
  'RecyclingPower.module.css':'export default {};',
 };
 const bundle=await build({entryPoints:['apps/web/components/catalog/CatalogCard.tsx'],bundle:true,platform:'node',format:'cjs',write:false,loader:{'.css':'empty'},jsx:'automatic',packages:'external',plugins:[{name:'card-context',setup(builder){
  builder.onResolve({filter:/.*/},args=>{const name=args.path.split('/').at(-1)!;return mocks[name]?{path:name,namespace:'card-context'}:undefined;});
  builder.onLoad({filter:/.*/,namespace:'card-context'},args=>({contents:mocks[args.path],loader:'js'}));
 }}]});
 const module={exports:{} as any};new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(import.meta.url),module,module.exports);
 const raw=offer('79,98','legacy-estimate');
 const unknown=publicOffer({...raw,japanPowerEstimate:{offerId:raw.id,values:[79,98],requiresConfirmation:true}} as any);
 assert.equal(unknown.japanPowerUnknown,true);
 try{
  for(const view of ['grid','list']){
   (globalThis as any).__japanPowerCardView=view;
   const html=renderToStaticMarkup(createElement(module.exports.CatalogCard,{offer:unknown}));
   assert.match(html,/data-japan-power-unknown="true"/);assert.match(html,/Мощность не указана/);
   assert.doesNotMatch(html,/79 \/ 98|79 л\.с\.|98 л\.с\./);
   const supplied=renderToStaticMarkup(createElement(module.exports.CatalogCard,{offer:publicOffer(offer(150))}));
   assert.match(supplied,/data-japan-supplier-power="true"/);assert.match(supplied,/150 л\.с\. · поставщик/);
  }
 }finally{delete (globalThis as any).__japanPowerCardView;}
});
