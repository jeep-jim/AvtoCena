import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {japanVehicleExcluded,japanVehicleSqlExclusion} from '../apps/web/lib/catalog/japan-vehicle-policy';
import {ajesLot,ajesQuery,ajesSourceCacheSql} from '../apps/web/lib/catalog/ajes-query';
import {readPreviousJapanVehiclePolicyRows} from '../apps/web/lib/catalog/ajes-query-cache';
import {japanPowerSnapshot} from '../apps/web/lib/catalog/ajes-power-page';
import {ajesOffer} from '../apps/web/lib/catalog/ajes-offer';
import {createAjesClient} from '../apps/web/lib/catalog/ajes-client';
import {findSavedAjesSearch,savedAjesFacets} from '../apps/web/lib/catalog/ajes-saved-search';

const row={ID:'passenger001',MARKA_NAME:'TOYOTA',MODEL_NAME:'NOAH',GRADE:'X',YEAR:'2021',AUCTION_TYPE:'2',STATUS:'Sold',FINISH:'100000',ENG_V:'2000',PW:'152',TIME:'P'};
const ip='203.0.113.12';
const base={password:()=> 'fixture',assertEnabled:async()=>{},reserve:async()=>{}};
const observedAt=()=>new Date().toISOString();
const snapshot=(items:any[],patch:any={})=>({schemaVersion:2,items,page:1,pageSize:24,received:items.length,rejected:0,stale:false,observedAt:observedAt(),...patch});
const rate={currency:'JPY',sourcePrice:100000,sourcePriceRub:50000,cbrRate:50,nominal:100,effectiveRate:.5,rateSource:'cbr',rateDate:'2026-11-26'} as const;

test('Japan explicit buses, trucks and machinery are excluded without inventing missing gross mass',()=>{
 for(const patch of [
  {model:'TEST BUS'},{model:'TEST MINIBUS'},{model:'TEST MICRO-BUS'},{trim:'MINI BUS'},
  {model:'TEST COACH'},{bodyType:'coach'},{bodyType:'minibus'},{bodyType:'автобус'},{trim:'マイクロバス'},
  {vehicleCategory:'M2'},{vehicleCategory:'M3'},{vehicleCategory:'M2G'},
  {model:'TEST TRUCK'},{bodyType:'truck'},{vehicleCategory:'N2'},
  {model:'TEST DUMP'},{trim:'CRANE'},{bodyType:'forklift'},{trim:'ダンプ'},
  {model:'TEST EXCAVATOR'},{bodyType:'ambulance'},{model:'TEST FIRE ENGINE'},
  {make:'HITACHI',model:'TEST'},{make:'HINO',model:'UNLISTED'},
  {make:'TOYOTA',model:'COASTER-BIG VAN'},{make:'ISUZU',model:'ELF'},
 ]){
  const offer={market:'japan',make:'TOYOTA',model:'TEST',...patch};
  assert.equal(japanVehicleExcluded(offer),true,JSON.stringify(patch));
  assert.equal(japanVehicleExcluded({...offer,grossVehicleWeightKg:3000}),true,JSON.stringify(patch));
 }
});

test('passenger and light vans, pickups and unrelated grade words remain admitted',()=>{
 for(const offer of [
  {make:'DAIHATSU',model:'HIJET VAN',bodyType:'van',vehicleCategory:'N1'},
  {make:'NISSAN',model:'CLIPPER VAN',bodyType:'van',vehicleCategory:'N1'},
  {make:'TOYOTA',model:'HIACE',bodyType:'van',vehicleCategory:'M1'},
  {make:'TOYOTA',model:'HIACE',trim:'WELCAB WHEELCHAIR',bodyType:'van'},
  {make:'TOYOTA',model:'NOAH',bodyType:'minivan'},
  {make:'HONDA',model:'FIT',trim:'BUSINESS PACKAGE'},
  {make:'LEXUS',model:'SC430',trim:'COACH EDITION'},
  {make:'TOYOTA',model:'HILUX TRUCK',vehicleCategory:'N1'},
  {make:'FORD',model:'RANGER',bodyType:'pickup',vehicleCategory:'N1'},
 ]){
  assert.equal(japanVehicleExcluded({market:'japan',...offer}),false,JSON.stringify(offer));
  assert.equal(japanVehicleExcluded({market:'japan',...offer,grossVehicleWeightKg:3500}),false,JSON.stringify(offer));
 }
 assert.equal(japanVehicleExcluded({market:'japan',make:'TOYOTA',model:'HIACE',info:'BUS TRUCK CRANE',equipment:'FORKLIFT'}),false);
 assert.equal(japanVehicleExcluded({market:'china',make:'TEST',model:'BUS',grossVehicleWeightKg:5000}),false,'Japan-only helper does not change another market');
});

test('only explicit permitted gross mass or listing-bound source class can exclude an otherwise eligible van',()=>{
 const offer={market:'japan',sourceId:'ajes_japan_feed',sourceOfferId:'bound001',make:'TOYOTA',model:'HIACE',bodyType:'van',vehicleCategory:'M1'};
 const specification=(name:string,value:string,id='bound001')=>({...offer,operational:{sourceSpecifications:{sourceId:'ajes_japan_feed',sourceOfferId:id,groups:[{items:[{name,value}]}]}}});
 assert.equal(japanVehicleExcluded({...offer,grossVehicleWeightKg:3501}),true);
 assert.equal(japanVehicleExcluded({...offer,grossVehicleWeightKg:3500}),false);
 assert.equal(japanVehicleExcluded({...offer,curbWeightKg:4000,payloadKg:5000}),false);
 assert.equal(japanVehicleExcluded(specification('Gross vehicle weight (kg)','3,501 kg')),true);
 assert.equal(japanVehicleExcluded(specification('Curb weight (kg)','4000 kg')),false);
 assert.equal(japanVehicleExcluded(specification('Payload (kg)','4000 kg')),false);
 assert.equal(japanVehicleExcluded(specification('Gross vehicle weight (kg)','4000 kg','other')),false);
 assert.equal(japanVehicleExcluded(specification('Body type','minibus')),true);
 assert.equal(japanVehicleExcluded(specification('Body type','minibus','other')),false);
 assert.equal(japanVehicleExcluded({...specification('Body type','minibus'),sourceId:undefined,sourceOfferId:undefined}),false);
});

test('AJ main/stats list and detail normalization reapply policy to actual identity/class fields',()=>{
 for(const table of ['main','stats'] as const)for(const detail of [false,true]){
  for(const change of [{MODEL_NAME:'TEST BUS'},{GRADE:'CRANE'},{BODY_TYPE:'bus'},{VEHICLE_CATEGORY:'M2'},{MODEL_NAME:'TEST TRUCK'},{MARKA_NAME:'HITACHI'}])
   assert.equal(ajesLot({...row,...change},table,detail),null,JSON.stringify({table,detail,change}));
  for(const model of ['HIJET VAN','CLIPPER VAN','HIACE','NOAH'])
   assert.ok(ajesLot({...row,MODEL_NAME:model,BODY_TYPE:'van',VEHICLE_CATEGORY:'M1'},table,detail),`${table}/${detail}/${model}`);
 }
 const lot=ajesLot({...row,MODEL_NAME:'HIACE',BODY_TYPE:'van',VEHICLE_CATEGORY:'M1'},'stats',true)!;
 assert.equal(lot.bodyType,'van');assert.equal(lot.vehicleCategory,'M1');
 const offer=ajesOffer(lot,rate,observedAt());
 assert.equal(offer.bodyType,'van');assert.equal(offer.vehicleCategory,'M1');assert.equal(offer.sourcePrice,100000);
 assert.equal(offer.operational?.raw?.sourcePower,'152');assert.equal(offer.powerHp,undefined);
});

test('source pruning is present before list/aggregate pagination and preserves generic vans and passenger editions',()=>{
 const clause=japanVehicleSqlExclusion();
 for(const table of ['main','stats'] as const)for(const aggregate of [undefined,'count','makes','models','colors'] as const){
  const query=ajesQuery({table,...(aggregate?{aggregate}:{page:2})});
  assert.ok(query.sql.includes(clause),`${table}/${aggregate||'list'}`);
  if(!aggregate)assert.ok(query.sql.indexOf(clause)<query.sql.indexOf(' limit '));
 }
 const patterns=[...clause.matchAll(/not regexp '([^']+)'/g)].map(match=>new RegExp(match[1],'iu'));
 assert.equal(patterns.length,2);
 assert.ok(clause.includes("concat_ws(' ',model_name,grade)"));
 const admitted=(model:string,grade:string|null)=>!patterns[0].test([model,grade].filter(value=>value!==null).join(' '))&&!patterns[1].test(model);
 for(const [model,grade] of [['TEST BUS','X'],['TEST','CRANE'],['TEST COACH','X'],['TEST','FORKLIFT']])assert.equal(admitted(model,grade),false);
 for(const [model,grade] of [['HIJET VAN','X'],['CLIPPER VAN',null],['HIACE','WELCAB'],['SC430','COACH EDITION'],['FIT','BUSINESS PACKAGE']])assert.equal(admitted(model!,grade),true);
 // Pruning is a subset. Encoded/Unicode and less common machinery still reach
 // the authoritative local guard; a short URL never relaxes product admission.
 for(const [model,trim] of [['TEST','マイクロバス'],['TEST','EXCAVATOR'],['TEST','FORK LIFT']]){
  assert.equal(admitted(model,trim),true);
  assert.equal(japanVehicleExcluded({market:'japan',make:'TOYOTA',model,trim}),true);
 }
 assert.ok(new URLSearchParams({sql:clause}).toString().length<350,'pruning must leave room for existing power/drive predicates');
});

test('an excluded nonempty wire response stays received/rejected data and does not trigger empty COUNT validation',async()=>{
 let requests=0;
 const client=createAjesClient({...base,fetcher:async url=>{requests++;assert.ok(!new URL(String(url)).searchParams.get('sql')!.startsWith('select count('));return Response.json([{...row,MODEL_NAME:'TEST BUS'}]);}});
 const result=await client.read({table:'stats'},ip);
 assert.deepEqual(result.items,[]);assert.equal(result.received,1);assert.equal(result.rejected,1);assert.equal(result.emptyPageEvidence,undefined);assert.equal(requests,1);
});

test('old cached main/stats lists and details cannot bypass the public client policy boundary',async()=>{
 for(const table of ['main','stats'] as const)for(const detail of [false,true])for(const stale of [false,true]){
  const valid=ajesLot(row,table,detail)!,forbidden={...valid,model:'TEST MINIBUS'};
  const saved=snapshot([forbidden],{pageSize:detail?1:24,observedAt:new Date(Date.now()-(stale?31*60000:0)).toISOString()});
  let calls=0;
  const client=createAjesClient({...base,readQuery:async()=>saved,readDetail:async()=>saved,fetcher:async()=>{calls++;return new Response('',{status:503});}});
  const result=await client.read({table,...(detail?{id:row.ID}:{})},ip);
  assert.deepEqual(result.items,[],JSON.stringify({table,detail,stale}));
  assert.equal(result.received,1);assert.equal(result.rejected,0);assert.equal(result.observedAt,saved.observedAt);assert.equal(Boolean(result.stale),stale);
  assert.equal(calls,stale?1:0);assert.equal(saved.items[0].model,'TEST MINIBUS','admission does not rewrite retained source data');
 }
});

test('partial recovery and saved make/model facets drop old forbidden vehicles without dropping passenger vans',()=>{
 const lot=ajesLot(row,'stats',false)!;
 const records=[
  {...lot,id:'passenger',make:'TOYOTA',model:'HIACE',bodyType:'van',vehicleCategory:'M1'},
  {...lot,id:'bus',make:'NISSAN',model:'TEST BUS'},
  {...lot,id:'machine',make:'HITACHI',model:'UNKNOWN'},
  {...lot,id:'heavy',make:'TOYOTA',model:'HIACE',grossVehicleWeightKg:4000},
 ];
 const snapshots=Object.fromEntries(records.map(record=>[record.id,snapshot([record])]));
 const recovered=findSavedAjesSearch({table:'stats'},snapshots)!;
 assert.deepEqual(recovered.items.map(lot=>lot.id),['passenger']);assert.equal(recovered.partial,true);assert.equal(recovered.stale,true);assert.equal('total' in recovered,false);
 assert.deepEqual(savedAjesFacets(snapshots),{makes:['TOYOTA'],models:[{make:'TOYOTA',model:'HIACE'}]});
});

test('public list and detail apply policy before currency work and after local enrichment',async()=>{
 const require=createRequire(import.meta.url),lot=ajesLot(row,'stats',true)!;
 const fixture:any={result:snapshot([]),currencyCalls:0,enrichment:{}};
 (globalThis as any).__japanVehiclePolicyFixture=fixture;
 const stubs:Record<string,string>={
  'server-only':'','next/headers':`export const headers=async()=>new Map([['x-real-ip','${ip}']]);`,
  './ajes-runtime':'export const ajesClient={read:async()=>globalThis.__japanVehiclePolicyFixture.result};',
  './editorial':'export const readCatalogEditorial=async()=>({});export const editorialHidden=()=>false;export const applyCatalogEditorial=x=>x;',
  './japan-owner-specifications':'export const applyJapanOwnerSpecifications=x=>x;',
  './japan-drive':'export const enrichJapanDrive=x=>x;export const japanDriveSql=()=>"";',
  '../encyclopedia/japan-fuel-reference':'export const applyJapanFactoryFuel=x=>x;',
  '../encyclopedia/calculation-index':'export const readCalculationIndex=()=>null;export const applyEncyclopediaCalculation=x=>({...x,...globalThis.__japanVehiclePolicyFixture.enrichment[x.id]});',
  './rates':`export const convertToRub=async price=>{globalThis.__japanVehiclePolicyFixture.currencyCalls++;return {...${JSON.stringify(rate)},sourcePrice:price,sourcePriceRub:price*.5};};`,
 };
 try{
  const built=await build({entryPoints:['apps/web/lib/catalog/ajes-public.ts'],bundle:true,platform:'node',format:'cjs',write:false,plugins:[{name:'japan-admission-fixture',setup(b){b.onResolve({filter:/.*/},a=>a.path in stubs?{path:a.path,namespace:'stub'}:undefined);b.onLoad({filter:/.*/,namespace:'stub'},a=>({contents:stubs[a.path]}));}}]});
  const mod={exports:{} as any};new Function('require','module','exports',built.outputFiles[0].text)(require,mod,mod.exports);
  fixture.result=snapshot([{...lot,id:'bus',model:'TEST BUS'},{...lot,id:'machine',make:'HITACHI'},lot],{stale:true});
  const listed=await mod.exports.readAjesPublic({});
  assert.deepEqual(listed.items.map((offer:any)=>offer.id),['ajes-stats-'+row.ID]);assert.equal(fixture.currencyCalls,1);assert.equal(listed.stale,true);assert.equal(listed.received,3);
  fixture.result=snapshot([{...lot,model:'TEST BUS'}],{pageSize:1,partial:true,stale:true});
  assert.equal(await mod.exports.getAjesOffer('ajes-stats-'+row.ID),null);assert.equal(fixture.currencyCalls,1);
  fixture.result=snapshot([lot]);
  for(const enrichment of [{vehicleCategory:'M2'},{grossVehicleWeightKg:3501}]){
   fixture.enrichment={'ajes-stats-passenger001':enrichment};
   assert.deepEqual((await mod.exports.readAjesPublic({})).items,[]);
  }
  fixture.enrichment={'ajes-stats-passenger001':{bodyType:'van',vehicleCategory:'M1',grossVehicleWeightKg:3500}};
  const admitted=await mod.exports.getAjesOffer('ajes-stats-'+row.ID);
  assert.equal(admitted.id,'ajes-stats-'+row.ID);assert.equal(admitted.sourcePrice,100000);assert.equal(admitted.operational.raw.sourcePower,'152');
 }finally{delete (globalThis as any).__japanVehiclePolicyFixture;}
});

test('legacy Japan policy recovery preserves exact power phase and source offset, then reapplies current admission',async()=>{
 const powerSnapshot=japanPowerSnapshot(null,{revision:'fixture',entries:{}} as any);
 for(const phase of ['known','unknown'] as const){
  const context={phase,snapshot:powerSnapshot},query={table:'stats' as const,powerTo:160,page:2,pageSize:48};
  const current=ajesQuery(query,null,context).sql,previous=ajesSourceCacheSql(current).replace(' and '+japanVehicleSqlExclusion(),'');
  const valid=ajesLot(row,'stats',false)!,saved=snapshot([valid,{...valid,id:'removed-bus',model:'TEST BUS'}],{page:2,pageSize:48,total:999,countSummary:{total:999},emptyPageEvidence:{old:true},observedAt:new Date(Date.now()-3600000).toISOString()});
  const keys:string[]=[];let calls=0;
  const client=createAjesClient({...base,readLegacyQuery:sql=>readPreviousJapanVehiclePolicyRows(sql,async key=>{keys.push(key);return key===previous?saved:null;}),fetcher:async()=>{calls++;return new Response('',{status:503});}});
  const result=await client.read(query,ip,context);
  assert.deepEqual(keys,[previous]);assert.equal(calls,1);assert.match(previous,/limit 48,48$/);
  assert.ok(previous.includes(phase==='unknown'?'pw is null or not':'(pw+0)<=160'),'the previous policy key retains this exact power phase');
  assert.deepEqual(result.items.map((lot:any)=>lot.id),[row.ID]);assert.equal(result.partial,true);assert.equal(result.stale,true);assert.equal(result.received,2);assert.equal(result.observedAt,saved.observedAt);
  assert.equal('total' in result,false);assert.equal('countSummary' in result,false);assert.equal('emptyPageEvidence' in result,false);assert.equal(saved.items.length,2);
 }
});

test('legacy Japan policy recovery never reads aggregate keys or guesses a different source page size',async()=>{
 let calls=0;
 for(const aggregate of ['count','makes','models','colors'] as const)assert.equal(await readPreviousJapanVehiclePolicyRows(ajesQuery({aggregate}).sql,async()=>{calls++;return null;}),null);
 assert.equal(calls,0);
 const sql=ajesQuery({page:2,pageSize:48}).sql,keys:string[]=[];
 assert.equal(await readPreviousJapanVehiclePolicyRows(sql,async key=>{keys.push(key);return null;}),null);
 assert.equal(keys.length,1);assert.match(keys[0],/limit 48,48$/);assert.equal(keys[0].includes('limit 24,24'),false);
 assert.equal(await readPreviousJapanVehiclePolicyRows(keys[0],async()=>{calls++;return null;}),null);assert.equal(calls,0,'the compatibility helper does not recursively broaden an old key');
});
