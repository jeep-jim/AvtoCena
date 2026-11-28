import test from 'node:test';
import assert from 'node:assert/strict';
import {createAjesClient,AjesUnavailable,readAjesModelDirectory} from '../apps/web/lib/catalog/ajes-client';
import {DetailReadCache} from '../apps/web/lib/catalog/detail-read-cache';
import {resolveAjesQueryModels} from '../apps/web/lib/catalog/ajes-model-resolution';
import {ajesCatalogQuery,ajesLot,ajesQuery,ajesSourceCacheSql} from '../apps/web/lib/catalog/ajes-query';
import {DatabaseSync} from 'node:sqlite';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {ajesOffer} from '../apps/web/lib/catalog/ajes-offer';
import {publicOffer} from '../apps/web/lib/catalog/storage';
import {EncyclopediaIdentityResolver} from '../apps/web/lib/catalog/encyclopedia-identity';
import {readEncyclopediaIdentityResolver} from '../apps/web/lib/catalog/encyclopedia-identity-data';
import {canonicalCatalogBrand} from '../apps/web/lib/catalog/brands';

function rejectSupplierQueue(t:any,message:string){
 const original=DetailReadCache.prototype.get;
 t.mock.method(DetailReadCache.prototype,'get',function(this:DetailReadCache<any>,...args:Parameters<typeof original>){
  return args[3]==='prepared'?original.apply(this,args):Promise.reject(Error(message));
 });
}

test('model directory queue failures recover exact saved names without contacting the supplier',async t=>{
 rejectSupplierQueue(t,'detail_cache_queue_full');
 let calls=0;const saved={items:[],models:[{make:'TOYOTA',model:'COROLLA',total:7}],page:1,pageSize:500,received:1,observedAt:new Date(Date.now()-3600000).toISOString()};
 const client=createAjesClient({password:()=> 'fixture',assertEnabled:async()=>{},reserve:async()=>{throw Error('provider forbidden');},readQuery:async sql=>{calls++;assert.equal(ajesSourceCacheSql(sql),ajesSourceCacheSql(ajesQuery({table:'stats',make:'TOYOTA',aggregate:'models',page:1}).sql));return saved;}});
 const result=await readAjesModelDirectory(client,{table:'stats',make:'TOYOTA'},'203.0.113.1');
 assert.deepEqual(result.models,saved.models);assert.equal(result.stale,true);assert.equal(calls,2);assert.equal('stale' in saved,false);
});
test('retained model directory cannot cross expiry, page or source switch',async t=>{
 rejectSupplierQueue(t,'detail_cache_queue_timeout');
 const base={items:[],models:[{make:'TOYOTA',model:'COROLLA',total:7}],page:1,pageSize:500,received:1,observedAt:new Date().toISOString()};
 for(const saved of [{...base,page:2},{...base,pageSize:24},{...base,observedAt:'2000-01-01'},{...base,models:undefined}]){
  const client=createAjesClient({password:()=> 'fixture',assertEnabled:async()=>{},reserve:async()=>{},readQuery:async()=>saved});
  await assert.rejects(readAjesModelDirectory(client,{table:'stats',make:'TOYOTA'},'203.0.113.1'),/local_busy/);
 }
 let disabled=false;const client=createAjesClient({password:()=> 'fixture',assertEnabled:async()=>{if(disabled)throw Error('source_disabled');},reserve:async()=>{},readQuery:async()=>{disabled=true;return base;}});
 await assert.rejects(readAjesModelDirectory(client,{table:'stats'},'203.0.113.1'),/source_disabled/);
});
test('directory failure permits an exact list query but marks unresolved families incomplete',async()=>{
 const input={table:'stats',make:'TOYOTA',model:'COROLLA',page:1};
 const recoverable=['visitor_restricted','local_busy','request_failed','request_timeout','connect_timeout','quota_busy','quota_exhausted','invalid_response','empty_response','response_too_large','query_too_large','http_429','http_500','http_503','directory_too_large','directory_page_repeated'];
 for(const error of [...recoverable.map(reason=>new AjesUnavailable(reason)),Error('detail_cache_queue_timeout'),Error('detail_cache_queue_full')]){
  const result=await resolveAjesQueryModels(input,async()=>{throw error;});
  assert.deepEqual(result,{query:{...input,modelFamilies:'COROLLA'},modelDirectoryUnavailable:true});assert.equal(input.model,'COROLLA');
 }
 const result=await resolveAjesQueryModels(input,async()=>({models:[{model:'COROLLA'},{model:'COROLLA CROSS'},{model:'CAMRY'}]}));
 assert.equal(result.query.model,'COROLLA|COROLLA CROSS');assert.equal(result.modelDirectoryUnavailable,false);
 for(const error of [new Error('source_disabled'),new Error('programming failure'),...['not_configured','client_ip_missing','quota_invalid','identity_mismatch','http_400','http_401','http_404'].map(reason=>new AjesUnavailable(reason))])await assert.rejects(resolveAjesQueryModels(input,async()=>{throw error;}),e=>e===error);
});


test('actual catalog wrapper keeps exact model cards on directory failure and never publishes a false zero',async()=>{
 const {build}=await import('esbuild');const {createRequire}=await import('node:module');const require=createRequire(import.meta.url);
 const state={empty:false,lists:0,counts:0,queries:[] as any[]};(globalThis as any).__modelRecovery=state;
 const stubs:Record<string,string>={
  'server-only':'','next/headers':"export const headers=async()=>new Map([['x-real-ip','127.0.0.1']]);",
  './ajes-runtime':"export const ajesClient={read:async()=>{globalThis.__modelRecovery.counts++;throw Error('count must not run');}};",
  './ajes-public':`export const readAjesPublicEvidenceSnapshot=()=>{throw Error("unexpected power snapshot");};export const cappedAjesQuery=async q=>q;export const readAjesPublic=async q=>{const s=globalThis.__modelRecovery;s.lists++;s.queries.push(q);return {page:q.page||1,pageSize:24,received:s.empty?0:24,items:s.empty?[]:[{id:'toyota-exact'}],observedAt:'now'};};`,
  './ajes-client':"export class AjesUnavailable extends Error{constructor(reason){super(reason);this.reason=reason;}};export const readAjesModelDirectory=async()=>{throw new AjesUnavailable('local_busy');};export const readAjesMakeDirectory=async()=>({makes:[]});",
  './ajes-result-filter':"export const ajesResultFilter=()=>({active:false,priceFilter:false,matches:()=>true});",
  './storage':"export const publicOffer=x=>x;",'./market-page':"export const sortCatalogRows=x=>x;",
  './live-business-pricing':"export const applyActiveBusinessPricingBatch=async x=>x;",
  './ajes-count-pricing-context':"export const captureAjesCountPricingContext=async()=>{throw Error('unexpected price-filter context');};",
  './collection-controls':"export const assertCollectionEnabled=async()=>{};",
  './japan-preview-parameters':"export const japanPreviewParameters=()=>{throw Error('not attested');};",'../encyclopedia/calculation-evidence':"export const hasEncyclopediaCalculationEvidence=()=>false;",
 };
 try{
  const built=await build({entryPoints:['apps/web/lib/catalog/ajes-catalog.ts'],bundle:true,platform:'node',format:'cjs',write:false,external:['react'],plugins:[{name:'model-recovery-fixture',setup(b){b.onResolve({filter:/.*/},a=>a.path in stubs?{path:a.path,namespace:'stub'}:undefined);b.onLoad({filter:/.*/,namespace:'stub'},a=>({contents:stubs[a.path]}));}}]});
  const mod={exports:{} as any};new Function('require','module','exports',built.outputFiles[0].text)((id:string)=>id==='react'?{cache:(fn:any)=>fn}:require(id),mod,mod.exports);
  const params={market:'japan',make:'TOYOTA',model:'COROLLA',city:'Новокузнецк'};
  const result=await mod.exports.readAjesCatalogPage(params);
  assert.equal(result.items[0].id,'toyota-exact');assert.equal(result.partial,true);assert.equal(result.total,null);assert.equal(result.countSummary,null);
  assert.equal(state.queries[0].make,'TOYOTA');assert.equal(state.queries[0].model,'COROLLA');assert.equal(state.counts,0);
  state.empty=true;await assert.rejects(mod.exports.readAjesCatalogPage(params),/directory_unavailable/);
  await assert.rejects(mod.exports.readAjesCountSummary(JSON.stringify(params)),/directory_unavailable/);
  assert.equal(state.lists,2);assert.equal(state.counts,0);
 }finally{delete (globalThis as any).__modelRecovery;}
});

const legacy={table:'stats',make:'Mazda',model:'3',page:1,pageSize:24};
const directory=(names:string[])=>async()=>({models:names.map(model=>({model}))});
const matched=['MAZDA3','MAZDA3 FASTBACK','MAZDA3 SEDAN','MAZDA 3 SPORT'];
const excluded=['CX-3','CX-30','MAZDA30','323','MPV','AXELA'];
const forbidIdentity=async()=>{assert.fail('unrelated or exact source selection must not load canonical aliases');};

test('the existing V2 safe source spelling proves Mazda/3 → MAZDA3, without a Latin AXELA alias',async()=>{
 const resolver=await readEncyclopediaIdentityResolver();assert.ok(resolver);
 const brand=resolver.resolveBrand('Mazda')!,match=resolver.resolveModel(brand.brand.id,'3');
 assert.equal(match?.model.id,'mazda/mazda3');assert.equal(match?.model.canonicalName,'MAZDA3');
 assert.ok(match?.model.sourceNames?.some(value=>typeof value!=='string'&&value.value==='3'&&value.safe===true));
 assert.notEqual(resolver.resolveModel(brand.brand.id,'AXELA')?.model.id,'mazda/mazda3');
});

test('legacy Mazda/3 selects the complete real MAZDA3 family while excluding CX-3, MPV and AXELA',async()=>{
 const models=[...matched,...excluded],before=structuredClone(legacy);
 const result=await resolveAjesQueryModels(legacy,directory(models));
 assert.deepEqual(result,{query:{...legacy,model:matched.join('|')},modelDirectoryUnavailable:false});
 assert.deepEqual(legacy,before,'discovery does not rewrite the caller or any listing');
 assert.deepEqual(models,[...matched,...excluded]);
 const sql=ajesQuery(result.query as any).sql;
 assert.ok(sql.includes(`model_name in (${matched.map(name=>`'${name}'`).join(',')})`));
 assert.doesNotMatch(sql,/model_name (?:=|in \()[^)]*'(?:CX-3|MPV|AXELA|MAZDA30)'/);
});

test('legacy resolution preserves source spelling and an existing exact base plus all its variants',async()=>{
 const source=['3','3 MPS','Mazda3','Mazda3 Fastback','MAZDA 3 SEDAN','CX-3','MPV'];
 const result=await resolveAjesQueryModels(legacy,directory(source));
 assert.equal(result.query.model,'3|3 MPS|Mazda3|Mazda3 Fastback|MAZDA 3 SEDAN');
 assert.equal(result.modelDirectoryUnavailable,false);
 const exact=await resolveAjesQueryModels({...legacy,model:'Mazda3 Fastback'},directory(source),forbidIdentity);
 assert.deepEqual(exact.query,{...legacy,model:'Mazda3 Fastback'});
});

test('a large legacy family retains the real base and more than twenty variants through the existing bounded SQL',async()=>{
 const names=['MAZDA3','MAZDA 3',...Array.from({length:20},(_,i)=>'MAZDA3 VERSION '+i),
  ...Array.from({length:20},(_,i)=>'MAZDA 3 VERSION '+i),'MAZDA3MPS','MAZDA  3 VERSION 1','ＭＡＺＤＡ３ VERSION 1'];
 const result=await resolveAjesQueryModels(legacy,directory([...names,...excluded]));
 assert.equal(result.query.modelFamilies,'MAZDA3|MAZDA 3');assert.equal(result.modelDirectoryUnavailable,false);
 assert.ok(result.query.model!.split('|').length<=20);
 for(const name of ['MAZDA3MPS','MAZDA  3 VERSION 1','ＭＡＺＤＡ３ VERSION 1'])assert.ok(result.query.model!.split('|').includes(name));
 const db=database([...names,...excluded]);
 try{
  const rows=db.prepare(ajesQuery({...result.query,pageSize:48} as any).sql).all();
  assert.equal(rows.length,45);assert.deepEqual(new Set(rows.map(row=>row.model_name)),new Set(names));
 }finally{db.close();}
});

test('pipe selections preserve their other source model and the legacy-only lookup stays scoped to one Mazda make',async()=>{
 const resolver=await readEncyclopediaIdentityResolver();let reads=0;
 const result=await resolveAjesQueryModels({...legacy,model:'3|CX-3'},directory([...matched,...excluded]),async()=>{reads++;return resolver;});
 assert.equal(reads,1);assert.equal(result.query.model,[...matched,'CX-3'].join('|'));
 for(const query of [{...legacy,make:'BMW'},{...legacy,make:'Mazda,Toyota'},
  {...legacy,model:'CX-3'},{...legacy,model:'MAZDA3'},{...legacy,model:'AXELA'}])
  await resolveAjesQueryModels(query,directory([...matched,...excluded]),forbidIdentity);
 await resolveAjesQueryModels({...legacy,make:undefined},async()=>{assert.fail('the unchanged make-free path does not read a directory');},forbidIdentity);
});

test('empty or unrelated source directories never invent a MAZDA3 option or substitute AXELA',async()=>{
 assert.deepEqual(await resolveAjesQueryModels(legacy,directory([]),forbidIdentity),{query:legacy,modelDirectoryUnavailable:false});
 const unrelated=await resolveAjesQueryModels(legacy,directory(['AXELA','CX-3','MPV']));
 assert.deepEqual(unrelated,{query:legacy,modelDirectoryUnavailable:false});
});

test('a stale legacy directory preserves known model names without claiming the family complete or empty',async()=>{
 for(const names of [['MAZDA3 FASTBACK'],[]]){
  const result=await resolveAjesQueryModels(legacy,async()=>({...(await directory(names)()),stale:true}));
  assert.equal(result.modelDirectoryUnavailable,true);
  const db=database([...names,...excluded]);
  try{assert.deepEqual(db.prepare(ajesQuery(result.query as any).sql).all().map(row=>row.model_name),names);}finally{db.close();}
 }
 const other={...legacy,make:'TOYOTA',model:'COROLLA'};
 const result=await resolveAjesQueryModels(other,async()=>({models:[{model:'COROLLA'}],stale:true}),forbidIdentity);
 assert.equal(result.modelDirectoryUnavailable,true,'saved model metadata cannot attest completeness for any Japanese make');
});

test('Audi A4 keeps every observed body and spelling across the bounded family SQL path',async()=>{
 const names=['A4',...Array.from({length:21},(_,i)=>'A4 AVANT VERSION '+i),
  'A4-AVANT','A4L','A 4 ALLROAD','Ａ４ CABRIOLET'];
 const excluded=['A40','A40 AVANT','RS4','OTHER A4'];
 const input={table:'stats',make:'AUDI',model:'A4',page:1,pageSize:48};
 const result=await resolveAjesQueryModels(input,directory([...names,...excluded]),forbidIdentity);
 assert.equal(result.modelDirectoryUnavailable,false);
 const db=database([...names,...excluded],'AUDI');
 try{
  const query=ajesQuery(result.query as any),rows=db.prepare(query.sql).all();
  assert.deepEqual(new Set(rows.map(row=>row.model_name)),new Set(names));
  const count=db.prepare(ajesQuery({...result.query,aggregate:'count'} as any).sql).get()!;
  assert.equal(Number(count['count(*)']),names.length,'list and count use the same complete source model predicate');
 }finally{db.close();}
 assert.equal(input.model,'A4');
});

test('large observed source spellings compact literal prefixes without dropping more than twenty aliases',async()=>{
 const names=['A4',...['A  4','A4-AVANT','Ａ４','A4L'].flatMap(prefix=>Array.from({length:21},(_,i)=>prefix+' VERSION '+i))];
 const excluded=['A40','A4L2','RS4','OTHER A4'];
 const result=await resolveAjesQueryModels({table:'stats',make:'AUDI',model:'A4',page:1,pageSize:48},directory([...names,...excluded]),forbidIdentity);
 assert.equal(result.modelDirectoryUnavailable,false);
 const db=database([...names,...excluded],'AUDI');
 try{
  const rows=[1,2].flatMap(page=>db.prepare(ajesQuery({...result.query,page} as any).sql).all());
  assert.deepEqual(new Set(rows.map(row=>row.model_name)),new Set(names));
 }finally{db.close();}
});

test('stale Audi model metadata retains known spellings and the typed base family without claiming a complete match',async()=>{
 const result=await resolveAjesQueryModels({table:'stats',make:'AUDI',model:'A4',page:1,pageSize:48},
  async()=>({models:[{model:'A4 AVANT'}],stale:true}),forbidIdentity);
 assert.equal(result.modelDirectoryUnavailable,true);
 const db=database(['A4','A4 AVANT','A4 ALLROAD QUATTRO','A40'],'AUDI');
 try{
  const rows=db.prepare(ajesQuery(result.query as any).sql).all();
  assert.deepEqual(new Set(rows.map(row=>row.model_name)),new Set(['A4','A4 AVANT','A4 ALLROAD QUATTRO']));
 }finally{db.close();}
});

test('missing, unsafe or ambiguous canonical evidence preserves exact source fallback as incomplete',async()=>{
 const brand={id:'mazda',canonicalName:'Mazda',aliases:[]};
 const model={id:'mazda/mazda3',brandId:'mazda',canonicalName:'MAZDA3',aliases:[],sourceNames:[{value:'3',safe:false}]};
 const unsafe=new EncyclopediaIdentityResolver({brands:[brand],models:[model]});
 const ambiguous=new EncyclopediaIdentityResolver({brands:[brand],models:[{...model,sourceNames:[{value:'3',safe:true}]},
  {id:'mazda/unreviewed',brandId:'mazda',canonicalName:'Other',aliases:[{value:'3',safe:true}]}]});
 const spellingConflict=new EncyclopediaIdentityResolver({brands:[brand],models:[{...model,sourceNames:[{value:'3',safe:true},{value:'MAZDA 3',safe:true}]},
  {id:'mazda/unreviewed',brandId:'mazda',canonicalName:'Other',aliases:[{value:'MAZDA 3',safe:true}]}]});
 for(const read of [async()=>null,async()=>{throw Error('local metadata unavailable');},async()=>unsafe,async()=>ambiguous,async()=>spellingConflict]){
  const result=await resolveAjesQueryModels(legacy,directory(['3','MAZDA3 FASTBACK']),read);
  assert.deepEqual(result,{query:{...legacy,modelFamilies:'3'},modelDirectoryUnavailable:true});
 }
 const failure=await resolveAjesQueryModels(legacy,async()=>{throw new AjesUnavailable('request_timeout');},forbidIdentity);
 assert.deepEqual(failure,{query:{...legacy,modelFamilies:'3'},modelDirectoryUnavailable:true});
});

test('twenty user choices can resolve to more than twenty actual source aliases without losing any',async()=>{
 const other=Array.from({length:19},(_,i)=>'OTHER '+i),query={...legacy,model:['3',...other].join('|')};
 const names=['3','MAZDA3','MAZDA 3',...other],result=await resolveAjesQueryModels(query,directory(names));
 assert.equal(result.modelDirectoryUnavailable,false);assert.ok(result.query.resolvedModels);
 const db=database([...names,'CX-3','MAZDA30']);
 try{assert.deepEqual(new Set(db.prepare(ajesQuery(result.query as any).sql).all().map(row=>row.model_name)),new Set(names));}finally{db.close();}
});

test('large legacy families use the actual source spelling rather than a normalized SQL prefix',async()=>{
 for(const spelling of ['MAZDA  3','ＭＡＺＤＡ３']){
  const names=Array.from({length:21},(_,i)=>spelling+' VERSION '+i);
  const result=await resolveAjesQueryModels(legacy,directory(names));
  assert.equal(result.modelDirectoryUnavailable,false);assert.equal(result.query.modelFamilies,spelling);
  const db=database([...names,...excluded]);
  try{assert.deepEqual(new Set(db.prepare(ajesQuery(result.query as any).sql).all().map(row=>row.model_name)),new Set(names));}finally{db.close();}
 }
});

test('server-resolved one-word aliases exceed the UI choice count safely and cannot enter through public params',async()=>{
 const names=['A4',...Array.from({length:26},(_,i)=>'A4'+String.fromCharCode(65+i))];
 const result=await resolveAjesQueryModels({table:'stats',make:'AUDI',model:'A4',page:1,pageSize:48},directory([...names,'A40','A4Z2']),forbidIdentity);
 assert.equal(result.modelDirectoryUnavailable,false);assert.deepEqual(result.query.resolvedModels?.exact,names);
 const db=database([...names,'A40','A4Z2'],'AUDI');
 try{
  assert.deepEqual(new Set(db.prepare(ajesQuery(result.query as any).sql).all().map(row=>row.model_name)),new Set(names));
  assert.equal(Number(db.prepare(ajesQuery({...result.query,aggregate:'count'} as any).sql).get()!['count(*)']),names.length);
 }finally{db.close();}
 assert.throws(()=>ajesQuery({model:names.join('|')}),/ajes_invalid_query/,'the public choice validator remains bounded');
 const publicQuery=ajesCatalogQuery({market:'japan',make:'AUDI',model:'A4',resolvedModels:{exact:['A40'],families:[]}});
 assert.equal(publicQuery.model,'A4');assert.equal(publicQuery.resolvedModels,undefined,'a URL cannot supply internal source aliases');
 for(const resolvedModels of [{exact:["A4' OR 1=1"],families:[]},{exact:[],families:['A4%']},{exact:[],families:[]},{exact:['A4'],families:[],sql:'anything'},null])
  assert.throws(()=>ajesQuery({resolvedModels} as any),/ajes_invalid_query/);
 assert.throws(()=>ajesQuery({model:'A4',resolvedModels:{exact:['A40'],families:[]}}),/ajes_invalid_query/);
});

function database(names:string[],make='MAZDA'){
 const db=new DatabaseSync(':memory:');
 db.exec('create table stats(id text,year integer,auction_type integer,status text,finish integer,marka_name text,model_name text,rate text,kpp text,time text,auction_date text,images text)');
 const add=db.prepare('insert into stats values(?,?,?,?,?,?,?,?,?,?,?,?)');
 names.forEach((name,index)=>add.run('legacy-'+index,2021,2,'Sold',120000,make,name,'5','AT','P','2026-11-27',
  'https://7.tru.ru/imgs/fixtureABC&h=50'));
 return db;
}

async function realPath(t:any,names=matched,modelDirectoryStale=false,source:{make?:string;directory?:'fresh'|'stale'|'unavailable'}={}){
 const db=database(names,source.make);t.after(()=>db.close());
 const state={queries:[] as any[],neighborQueries:[] as any[],project:publicOffer,current:{id:'china-legacy',market:'china',make:'Mazda',model:'3'},
  snapshot:{editorial:{revision:'fixture-model-resolution',entries:{}},calculationIndex:null},
  read:async(q:any)=>{
   state.queries.push(structuredClone(q));
   const query=ajesQuery(q);
   if(query.kind==='makes'&&source.directory==='unavailable')throw new AjesUnavailable('local_busy');
   // SQLite's BLOB cast preserves the counter's binary ID equality without
   // changing the real compiler's model predicates or recorded query.
   const rows=db.prepare(query.sql.replace(/distinct binary id/g,'distinct cast(id as blob)')).all(),observedAt=new Date().toISOString();
   const common={page:query.page,pageSize:query.pageSize,received:rows.length,stale:query.kind==='models'&&modelDirectoryStale||query.kind==='makes'&&source.directory==='stale',partial:false,observedAt};
   if(query.kind==='makes')return {...common,items:[],makes:rows.map(row=>({make:row.marka_name,total:Number(row['count(*)'])}))};
   if(query.kind==='models')return {...common,items:[],models:rows.map(row=>({make:row.marka_name,model:row.model_name,total:Number(row['count(*)'])}))};
   if(query.kind==='count')return {...common,items:[],total:Number(Object.values(rows[0])[0]),...(q.countIdentity?{distinctTotal:Number(rows[0].census_distinct_ids)}:{})};
   return {...common,items:rows.map(row=>{
    const lot=ajesLot(Object.fromEntries(Object.entries(row).map(([key,value])=>[key.toUpperCase(),value])),'stats',false)!;assert.ok(lot);
    return ajesOffer(lot,{currency:'JPY',sourcePrice:120000,rateSource:'cbr',effectiveRate:0.5,rateDate:'2026-11-27'} as any,observedAt);
   })};
  }};
 (globalThis as any).__legacyMazda=state;t.after(()=>{delete (globalThis as any).__legacyMazda;});
 const mocks:Record<string,string>={
  'server-only':'','next/headers':'export const headers=async()=>new Map([["x-real-ip","203.0.113.1"]]);',
  'ajes-runtime':'export const ajesClient={read:q=>globalThis.__legacyMazda.read(q)};',
  'ajes-public':'export const readAjesPublicEvidenceSnapshot=()=>globalThis.__legacyMazda.snapshot;export const cappedAjesQuery=async q=>q;export const readAjesPublic=q=>globalThis.__legacyMazda.read(q);',
  '../data':'export const getJsonStorage=()=>({readJson:async()=>null,writeJson:async()=>{}});',
  storage:'export const publicOffer=row=>globalThis.__legacyMazda.project(row);export const getUnavailableOffer=async()=>null;export const searchOffers=async query=>{globalThis.__legacyMazda.neighborQueries.push(query);return {items:[],total:0};};',
  'collection-controls':'export const assertCollectionEnabled=async()=>{};',
  'market-page':'export const sortCatalogRows=x=>x;',
  'live-business-pricing':'export const applyActiveBusinessPricingBatch=async rows=>rows;',
  'ajes-count-pricing-context':'export const captureAjesCountPricingContext=async()=>{throw Error("unexpected price-filter context");};',
  'japan-preview-parameters':'export const japanPreviewParameters=()=>{throw Error("not attested");};',
  'offer-page-data':'export const getOfferDetailRecord=async()=>globalThis.__legacyMazda.current;',
  'related-model-family':'export const readRelatedModelFamily=async(_make,model)=>model;',
  'green-corner':'export const readGreenCorner=async()=>({items:[]});export const publicGreenOffer=x=>x;',
  presentation:'export const presentCatalogOffer=row=>({makeLabel:row.make,modelLabel:row.model,marketLabel:row.market});',
  'runtime-config':'export const PUBLIC_CATALOG_MARKETS=["china","japan"];',
 };
 const out=await build({stdin:{contents:'export * from "./apps/web/lib/catalog/ajes-catalog.ts"; export * from "./apps/web/app/api/catalog/recommendations/data.ts";',resolveDir:process.cwd()},
  bundle:true,platform:'node',format:'cjs',write:false,packages:'external',tsconfig:'apps/web/tsconfig.json',define:{'process.env.AVTOCENA_RELEASE_SHA':JSON.stringify('a'.repeat(40))},plugins:[{name:'legacy-mazda-source',setup(b){
   b.onResolve({filter:/.*/},args=>{
    // Only the counter cache uses fixture storage; identity discovery retains
    // its real local data-root reader and the checked-in alias evidence.
    if(args.path==='../data'&&!args.importer.endsWith('/catalog/ajes-catalog.ts'))return;
    const name=args.path in mocks?args.path:args.path.split('/').at(-1)!;return name in mocks?{path:name,namespace:'fixture'}:undefined;
   });
   b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:mocks[args.path],resolveDir:process.cwd()}));
  }}]});
 const require=createRequire(import.meta.url),mod={exports:{} as any};
 new Function('require','module','exports',out.outputFiles[0].text)((id:string)=>id==='react'?{cache:(fn:any)=>fn}:require(id),mod,mod.exports);
 return {api:mod.exports,state,db};
}

test('raw Japanese make selections and legacy display aliases reach the same exact source rows when the directory is available',async t=>{
 for(const make of ['LANDROVER','LAND ROVER','BENZ']){
  const {api,state}=await realPath(t,['SOURCE MODEL'],false,{make});
  for(const selected of [make,canonicalCatalogBrand(make)]){
   const params={market:'japan',make:selected,model:'SOURCE MODEL'};
   const page=await api.readAjesCatalogPage(params,undefined,{includeCount:false});
   assert.equal(page.items.length,1);assert.equal(page.partial,false);assert.equal(page.total,1);
   assert.equal((await api.readAjesResolvedPublic(params)).items.length,1);
   await assert.rejects(api.readAjesCountSummary(JSON.stringify(params)),/census_source_snapshot_unavailable/);
   const lists=state.queries.filter(q=>!q.aggregate);assert.ok(lists.every(q=>q.make===make));
  }
 }
});

test('an unavailable or stale make directory preserves exact rows but cannot attest a zero or complete alias selection',async t=>{
 for(const directory of ['unavailable','stale'] as const){
  const {api,state}=await realPath(t,['SOURCE MODEL'],false,{make:'BENZ',directory});
  const raw={market:'japan',make:'BENZ',model:'SOURCE MODEL'};
  const page=await api.readAjesCatalogPage(raw,undefined,{includeCount:false});
  assert.equal(page.items.length,1);assert.equal(page.partial,true);assert.equal(page.total,null);
  assert.equal((await api.readAjesResolvedPublic(raw)).partial,true);
  const models=await api.readAjesDirectory(raw);assert.equal(models.stale,true);
  assert.deepEqual(models.models.map((row:any)=>[row.make,row.model]),[['BENZ','SOURCE MODEL']]);
  await assert.rejects(api.readAjesCountSummary(JSON.stringify(raw)),/directory_unavailable/);
  assert.equal(state.queries.some(q=>q.aggregate==='count'),false,'an unresolved directory must not issue or publish a misleading COUNT');
  const legacy={market:'japan',make:'Mercedes-Benz'};
  if(directory==='unavailable'){
   await assert.rejects(api.readAjesCatalogPage(legacy,undefined,{includeCount:false}),/directory_unavailable/);
   await assert.rejects(api.readAjesResolvedPublic(legacy),/directory_unavailable/);
  }else{
   const saved=await api.readAjesResolvedPublic(legacy);assert.equal(saved.items.length,1);assert.equal(saved.partial,true);
  }
  await assert.rejects(api.readAjesCountSummary(JSON.stringify(legacy)),/directory_unavailable/);
 }
});

test('multi-make Japanese source values retain both raw aliases on a directory outage without widening the query',async t=>{
 const {api,state,db}=await realPath(t,['SOURCE MODEL'],false,{make:'BENZ',directory:'unavailable'});
 db.prepare('insert into stats values(?,?,?,?,?,?,?,?,?,?,?,?)').run('land-rover',2021,2,'Sold',120000,'LANDROVER','SOURCE MODEL','5','AT','P','2026-11-27','https://7.tru.ru/imgs/fixtureABC&h=50');
 const params={market:'japan',make:'BENZ,LANDROVER'};
 const result=await api.readAjesCatalogPage(params,undefined,{includeCount:false});
 assert.equal(result.items.length,2);assert.equal(result.partial,true);assert.equal(result.total,null);
 assert.ok(state.queries.filter(q=>!q.aggregate).every(q=>q.make==='BENZ,LANDROVER'));
 assert.deepEqual(new Set(result.items.map((row:any)=>row.make)),new Set(['BENZ','LANDROVER']));
});

test('the old Mazda/3 URL resolves through real catalog, count and cross-market recommendation paths',async t=>{
 const {api,state}=await realPath(t,[...matched,...excluded]);
 const input={market:'japan',make:'Mazda',model:'3',city:'Новокузнецк'};
 const result=await api.readAjesCatalogPage(input,undefined,{includeCount:false});
 assert.equal(result.partial,false);assert.equal(result.total,matched.length);assert.equal(result.hasMore,false);
 assert.deepEqual(new Set(result.items.map((row:any)=>row.model)),new Set(matched));
 assert.ok(result.items.every((row:any)=>row.market==='japan'&&row.id.startsWith('ajes-stats-')));
 const direct=await api.readAjesResolvedPublic(input);
 assert.equal(direct.partial,false);assert.deepEqual(new Set(direct.items.map((row:any)=>row.model)),new Set(matched));
 await assert.rejects(api.readAjesCountSummary(JSON.stringify(input)),/census_source_snapshot_unavailable/);
 const recommendations=await api.loadRelatedRecommendations({id:'china-legacy',markets:['japan']});
 assert.equal(recommendations.partial,false);assert.equal(recommendations.familyModel,'3');
 assert.equal(recommendations.crossMarketGroups.length,1);assert.equal(recommendations.crossMarketGroups[0].market,'japan');
 assert.deepEqual(new Set(recommendations.crossMarketGroups[0].items.map((row:any)=>row.model)),new Set(matched));
 const resolved=state.queries.filter(query=>query.model);
 assert.ok(resolved.length>=3);assert.ok(resolved.every(query=>query.make==='MAZDA'));
 assert.deepEqual(new Set(resolved[0].model.split('|')),new Set(matched));
 assert.ok(resolved.every(query=>query.model===resolved[0].model),'catalog, COUNT and recommendations must use the same resolved source models');
 assert.ok(resolved.some(query=>query.aggregate==='count'));
 assert.ok(state.neighborQueries.every(query=>query.market==='china'&&(!query.model||query.model==='3')));
 assert.equal(input.model,'3');assert.equal(state.current.model,'3','no stored/current technical identity is rewritten');
});

test('a truly empty source directory stays an empty fresh catalog and cannot manufacture related cards',async t=>{
 const {api}=await realPath(t,[]),input={market:'japan',make:'Mazda',model:'3'};
 const result=await api.readAjesCatalogPage(input,undefined,{includeCount:false});
 assert.deepEqual(result.items,[]);assert.equal(result.total,0);assert.equal(result.partial,false);assert.equal(result.hasMore,false);
 const recommendations=await api.loadRelatedRecommendations({id:'china-legacy',markets:['japan']});
 assert.deepEqual(recommendations.crossMarketGroups,[]);assert.equal(recommendations.partial,false);
});

test('real legacy paths keep stale-directory cards partial and reject a false zero or exact COUNT',async t=>{
 const input={market:'japan',make:'Mazda',model:'3'};
 for(const names of [['MAZDA3 FASTBACK'],[]]){
  const {api,state}=await realPath(t,names,true);
  if(names.length){
   const result=await api.readAjesCatalogPage(input,undefined,{includeCount:false});
   assert.equal(result.partial,true);assert.equal(result.total,null);
   assert.deepEqual(result.items.map((row:any)=>row.model),names);
   const direct=await api.readAjesResolvedPublic(input);assert.equal(direct.partial,true);assert.equal(direct.items.length,1);
  }else{
   await assert.rejects(api.readAjesCatalogPage(input,undefined,{includeCount:false}),/directory_unavailable/);
   await assert.rejects(api.readAjesResolvedPublic(input),/directory_unavailable/);
  }
  await assert.rejects(api.readAjesCountSummary(JSON.stringify(input)),/directory_unavailable/);
  assert.equal(state.queries.some(query=>query.aggregate==='count'),false);
  const recommendations=await api.loadRelatedRecommendations({id:'china-legacy',markets:['japan']});
  assert.equal(recommendations.partial,true);
  assert.deepEqual(recommendations.crossMarketGroups.flatMap((group:any)=>group.items.map((row:any)=>row.model)),names);
 }
});
