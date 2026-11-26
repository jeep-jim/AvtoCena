import test,{mock} from 'node:test';
import assert from 'node:assert/strict';
import {parseJapanSourcePower,japanSupplierPower,japanSupplierPowerLabel,japanUnknownPower,japanPowerFilterSummary,japanPowerFilterNotice} from '../apps/web/lib/catalog/japan-source-power';
import {ajesResultFilter} from '../apps/web/lib/catalog/ajes-result-filter';
import {ajesPowerEstimateHp} from '../apps/web/lib/catalog/ajes-power-estimate';
import {ajesLot,ajesQuery,ajesSourceCacheSql} from '../apps/web/lib/catalog/ajes-query';
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
