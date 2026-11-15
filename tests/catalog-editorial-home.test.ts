import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {getJsonStorage,StorageConflictError} from '../apps/web/lib/data';
import {buildBudgetCountIndex} from '../apps/web/lib/catalog/budget-count-index';
import {readCatalogEditorial,withCatalogEditorial} from '../apps/web/lib/catalog/editorial';
import {editorialHomeContext,editorialHomePath,prepareEditorialHome,readEditorialHome,resetEditorialHomeCache} from '../apps/web/lib/catalog/editorial-home';
import {PUBLIC_CATALOG_MARKETS} from '../apps/web/lib/catalog/runtime-config';
import {buildCatalogOverviewFromProjections,prepareCatalogProjectionRows,readHomeCatalogSnapshot,searchOffers,resetCatalogReadCachesForTests} from '../apps/web/lib/catalog/storage';

const clock=Date.parse('2026-11-11T12:00:00Z');
const wire=(value:unknown)=>JSON.parse(JSON.stringify(value));
const card=(id:string)=>({id,market:'europe',make:'BMW',model:'X3',year:2024,engineCc:1598,powerHp:123,fuel:'petrol',powertrainKind:'combustion',transmission:'automatic',drive:'fwd',bodyType:'suv',cardImageUrl:'https://example.com/car.jpg',cardProjectionVersion:3,publicSpecificationVerified:true,calculationStatus:'ready',updatedAt:'2026-11-01T00:00:00Z',totalRub:1_000_000,publicVisibleRub:1_000_000}) as any;
async function fixture(t:any,compact=true,pricing:'ordinary'|'unpriced'|'seller'='ordinary'){
 t.mock.timers.enable({apis:['Date'],now:clock});
 const unpriced=pricing==='unpriced';
 const market=unpriced?'uae':'europe';
 const generationId='editorial-home-proof',source=Array.from({length:28},(_,i)=>({...card(`car-${i}`),market,make:i===26?'Audi':'BMW',sourceGroup:i%2?'new':'used',totalRub:1_000_000+i*10_000,publicVisibleRub:1_000_000+i*10_000,
  ...(unpriced?{sourceGroup:'dubicars_uae_exact',sourcePrice:null,totalRub:null,publicVisibleRub:undefined,calculationStatus:'needs_data',cardImageUrl:undefined,images:[],engineCc:undefined,powerHp:undefined}: {}),
  ...(pricing==='seller'?{sourcePrice:10000,sourceCurrency:'USD',sellerPriceRub:1000000,catalogPricingMode:'seller',totalRub:null,publicVisibleRub:undefined,calculationStatus:'needs_data',publicSpecificationVerified:false,engineCc:undefined,powerHp:undefined,
   calculationSnapshot:{currencyRate:{currency:'USD',sourcePrice:10000,effectiveRate:100,rateSource:'cbr',rateDate:'2026-11-11'}}}: {})}));
 const rows=prepareCatalogProjectionRows(source),overview=await buildCatalogOverviewFromProjections(generationId,rows);
 const index=buildBudgetCountIndex(generationId,rows,new Map(rows.map((row,i)=>[row.id,Math.floor(i/8)])),3);
 const manifest={generationId,markets:Object.fromEntries(PUBLIC_CATALOG_MARKETS.map(m=>[m,{count:m===market?rows.length:0}]))};
 const initial={revision:'edit-1',entries:{'car-0':{id:'car-0',market,status:'hidden'}}};
 const values=new Map<string,any>([['catalog/manifest.json',manifest],['catalog-editorial/current.json',initial],[`catalog/generations/${generationId}/indexes/overview.json`,overview]]);
 const raw=JSON.stringify(overview),storage=getJsonStorage(),oldRead=storage.readJsonWithMeta,oldWrite=storage.writeJson;
 const reads:string[]=[],writes:Array<{key:string;condition:any}>=[];
 let forbidSearch=false,onRead:(key:string)=>void=()=>{},onWrite:(key:string)=>void=()=>{};
 storage.readJsonWithMeta=async<T>(key:string,fallback:T)=>{
  reads.push(key);onRead(key);
  let value=values.get(key);
  if(key.includes('/budget-')||key.includes('/projection/')||key.includes('/current/projection/')){
   assert.equal(forbidSearch,false,'prepared home must not repeat selector/projection search');
   if(compact&&key.endsWith('/budget-count-v3.json'))value=index;
   if(compact&&key.includes('/budget-cards-v3/')){const block=Number(key.split('/').at(-1)!.replace('.json',''));value={generationId,items:rows.slice(block*8,block*8+8)};}
   if(key.includes('/projection/'))value={generationId,items:rows};
  }
  return {found:value!==undefined,value:(value??fallback) as T,etag:value!==undefined?'"old"':undefined};
 };
 storage.writeJson=async(key,value,condition)=>{writes.push({key,condition});onWrite(key);values.set(key,wire(value));};
 t.after(()=>{storage.readJsonWithMeta=oldRead;storage.writeJson=oldWrite;t.mock.timers.reset();resetCatalogReadCachesForTests();});
 resetCatalogReadCachesForTests();
 return {generationId,rows,overview,manifest,values,reads,writes,raw,storage,
  forbidSearch:(value:boolean)=>{forbidSearch=value;},onRead:(fn:(key:string)=>void)=>{onRead=fn;},onWrite:(fn:(key:string)=>void)=>{onWrite=fn;},
  prepare:()=>prepareEditorialHome({storage,search:market=>searchOffers({market,pageSize:12,sort:'updatedAt'})}),
  context:()=>editorialHomeContext(values.get('catalog-editorial/current.json').revision),
 };
}

for(const compact of [true,false])test(`separate prepared home preserves exact ${compact?'compact':'projection fallback'} results and raw rollback pages`,async t=>{
 const f=await fixture(t,compact),expected=await searchOffers({market:'europe',pageSize:12,sort:'updatedAt'});
 const result=await f.prepare();assert.equal(result.prepared,true);
 assert.equal(f.writes.length,1);assert.ok(f.writes[0].key.includes('/editorial-home-v1/2026-11-11/'));
 assert.deepEqual(f.writes[0].condition,{ifNoneMatch:'*'});
 assert.equal(JSON.stringify(f.overview),f.raw,'legacy raw overview remains byte-for-byte identical');
 resetCatalogReadCachesForTests();f.reads.length=0;f.forbidSearch(true);
 const home=await readHomeCatalogSnapshot(10);
 assert.equal(home.marketCounts.europe,expected.total);
 assert.deepEqual(wire(home.items),wire(expected.items.slice(0,10)),'exact public cards, price fields and source-balanced order are preserved');
 assert.equal(f.reads.filter(key=>key.includes('/editorial-home-v1/')).length,1);
 assert.equal(f.writes.length,1,'visitor never writes');
 assert.equal('sourceCounts' in home,false,'internal source proof is not exposed');
 for(const elapsed of [31_000,306_000]){
  t.mock.timers.setTime(clock+elapsed);f.reads.length=0;
  assert.deepEqual(wire((await readHomeCatalogSnapshot(10)).items),wire(expected.items.slice(0,10)));
  assert.ok(f.reads.filter(key=>key.includes('/editorial-home-v1/')).length<=1,'one bounded snapshot read, no selector fan-out');
 }
 // Removing the last hidden entry restores raw legacy count/sample immediately.
 f.values.set('catalog-editorial/current.json',{revision:'edit-2',entries:{}});
 resetCatalogReadCachesForTests();f.reads.length=0;
 const restored=await readHomeCatalogSnapshot(10);
 assert.equal(restored.marketCounts.europe,f.rows.length);
 assert.deepEqual(restored.items,f.overview.markets.europe.items.slice(0,10));
 assert.equal(f.reads.some(key=>key.includes('/editorial-home-v1/')),false);
});

test('manual seller-price edit retains actual fallback card and price semantics',async t=>{
 const f=await fixture(t);
 const index=f.values.get('catalog-editorial/current.json');
 index.entries['car-1']={id:'car-1',market:'europe',status:'visible',sellerPrice:{amount:1500000,currency:'RUB'}};
 const expected=await readHomeCatalogSnapshot(12);
 await f.prepare();resetCatalogReadCachesForTests();f.forbidSearch(true);
 assert.deepEqual(wire((await readHomeCatalogSnapshot(12)).items),wire(expected.items));
});

for(const pricing of ['unpriced','seller'] as const)test(`admitted ${pricing} cards retain missing specifications and needs_data through preparation`,async t=>{
 const market=pricing==='unpriced'?'uae':'europe';
 const f=await fixture(t,pricing==='seller',pricing),expected=await searchOffers({market,pageSize:12,sort:'updatedAt'});
 assert.equal(expected.total,27);assert.equal(expected.items.length,12);
 assert.ok(expected.items.every(item=>item.totalRub===null&&item.calculationStatus==='needs_data'&&item.powerHp===undefined));
 if(pricing==='unpriced')assert.ok(expected.items.every(item=>item.images.length===0));
 else assert.ok(expected.items.every(item=>item.catalogPricingMode==='seller'&&item.sellerPriceRub===1000000));
 await f.prepare();resetCatalogReadCachesForTests();f.forbidSearch(true);
 const home=await readHomeCatalogSnapshot(10);
 assert.equal(home.marketCounts[market],expected.total);assert.deepEqual(wire(home.items),wire(expected.items.slice(0,10)));
});

const malformedCardChanges=[
 (item:any)=>({id:item.id,market:item.market}),
 (item:any)=>({...item,make:''}),
 (item:any)=>({...item,model:{}}),
 (item:any)=>({...item,year:'2024'}),
 (item:any)=>({...item,year:0}),
 (item:any)=>({...item,status:undefined}),
 (item:any)=>({...item,offerType:{}}),
 (item:any)=>({...item,images:undefined}),
 (item:any)=>({...item,images:[{}]}),
 (item:any)=>({...item,images:[{url:42}]}),
 (item:any)=>({...item,cardImageUrl:{}}),
];

test('preparation rejects truncated public cards before writing any snapshot',async t=>{
 const f=await fixture(t),expected=await searchOffers({market:'europe',pageSize:12,sort:'updatedAt'});
 for(const change of malformedCardChanges){
  await assert.rejects(prepareEditorialHome({storage:f.storage,search:async()=>({...expected,
   items:expected.items.map((item,i)=>i===0?change(item):item)})}),/catalog_editorial_home_search_incomplete/);
 }
 assert.equal(f.writes.length,0);assert.equal(JSON.stringify(f.overview),f.raw);
});

test('all hidden is a proved zero, with no fabricated source loss or empty-cache reuse',async t=>{
 const f=await fixture(t);
 f.values.set('catalog-editorial/current.json',{revision:'all-hidden',entries:Object.fromEntries(f.rows.map(row=>[row.id,{id:row.id,market:'europe',status:'hidden'}]))});
 await f.prepare();resetCatalogReadCachesForTests();f.forbidSearch(true);
 const home=await readHomeCatalogSnapshot(10);assert.equal(home.marketCounts.europe,0);assert.deepEqual(home.items,[]);
});

test('missing, mismatched and malformed proofs retain exact search fallback',async t=>{
 const f=await fixture(t),expected=await searchOffers({market:'europe',pageSize:10,sort:'updatedAt'});
 await f.prepare();const path=f.writes[0].key,valid=structuredClone(f.values.get(path));
 const damages=[
  (v:any)=>{v.generationId='other';},(v:any)=>{v.policyDate='2026-11-10';},
  (v:any)=>{v.context.editorialRevision='other';},(v:any)=>{v.context.calculationVersion='other';},
  (v:any)=>{v.context.release='other';},
  (v:any)=>{v.context.encyclopediaDigest='other';},(v:any)=>{v.markets.europe.sourceTotal--;},
  (v:any)=>{v.markets.europe.items.pop();},(v:any)=>{v.markets.europe.items[1]=v.markets.europe.items[0];},
  (v:any)=>{v.markets.europe.items[0].market='uae';},(v:any)=>{v.markets.europe.items[0].id='car-0';},
  (v:any)=>{v.markets.europe.items[0].operational={};},(v:any)=>{v.markets.europe.total=NaN;},
  (v:any)=>{v.markets.europe.items[0].images={};},(v:any)=>{v.markets.europe.items[0].images=[null];},
  ...malformedCardChanges.map(change=>(v:any)=>{v.markets.europe.items[0]=change(v.markets.europe.items[0]);}),
 ];
 for(const damage of damages){const value=structuredClone(valid);damage(value);f.values.set(path,value);resetCatalogReadCachesForTests();f.reads.length=0;
  const home=await readHomeCatalogSnapshot(10);assert.deepEqual(home.items,expected.items);assert.equal(home.marketCounts.europe,expected.total);
  assert.ok(f.reads.some(key=>key.includes('/budget-count-v3.json')),'invalid proof runs original search');
 }
 f.values.delete(path);resetCatalogReadCachesForTests();assert.deepEqual((await readHomeCatalogSnapshot(10)).items,expected.items);
});

test('new editorial revision and next policy day cannot reuse the old prepared snapshot',async t=>{
 const f=await fixture(t);await f.prepare();const path=f.writes[0].key;
 f.values.set('catalog-editorial/current.json',{revision:'edit-2',entries:{'car-1':{id:'car-1',market:'europe',status:'hidden'}}});
 resetCatalogReadCachesForTests();const expected=await searchOffers({market:'europe',pageSize:10,sort:'updatedAt'});
 assert.deepEqual((await readHomeCatalogSnapshot(10)).items,expected.items);assert.ok(f.values.has(path),'history remains intact');
 t.mock.timers.setTime(clock+86400000);resetCatalogReadCachesForTests();
 await withCatalogEditorial(async()=>assert.deepEqual(await readEditorialHome(f.generationId,{europe:f.rows.length},['europe']),{}));
});

for(const failure of ['revision','generation','source-count','date','calculation','cas','readback','after-write-revision'])test(`preparation fails closed on ${failure} and does not overwrite legacy data`,async t=>{
 const f=await fixture(t),originalVersion=process.env.AVTOCENA_CALCULATION_VERSION;
 t.after(()=>{if(originalVersion===undefined)delete process.env.AVTOCENA_CALCULATION_VERSION;else process.env.AVTOCENA_CALCULATION_VERSION=originalVersion;});
 let searched=false;
 const mutate=()=>{
  if(failure==='revision'||failure==='after-write-revision')f.values.set('catalog-editorial/current.json',{revision:'changed',entries:{}});
  if(failure==='generation')f.values.set('catalog/manifest.json',{...f.manifest,generationId:'changed'});
  if(failure==='source-count')f.values.set('catalog/manifest.json',{...f.manifest,markets:{...f.manifest.markets,europe:{count:99}}});
  if(failure==='date')t.mock.timers.setTime(Date.parse('2026-11-11T17:00:00Z'));
  if(failure==='calculation')process.env.AVTOCENA_CALCULATION_VERSION='b'.repeat(64);
 };
 if(failure==='cas')f.onWrite(()=>{throw new StorageConflictError();});
 if(failure==='after-write-revision')f.onWrite(mutate);
 if(failure==='readback')f.onRead(key=>{if(f.writes.length&&key.includes('/editorial-home-v1/'))f.values.set(key,{bad:true});});
 await assert.rejects(prepareEditorialHome({storage:f.storage,search:async market=>{
  const result=await searchOffers({market,pageSize:12,sort:'updatedAt'});searched=true;
  if(!['cas','readback','after-write-revision'].includes(failure))mutate();return result;
 }}),/catalog_editorial_home_|storage_conflict/);
 assert.equal(searched,true);assert.ok(f.writes.length<=1,'no retry of CAS/context failures');
 assert.equal(JSON.stringify(f.overview),f.raw);assert.ok(f.writes.every(write=>write.key.includes('/editorial-home-v1/')));
});

test('fresh editorial fence bypasses cached visitor context and detects same-revision changes',async t=>{
 const f=await fixture(t);await readCatalogEditorial();
 const captured=f.values.get('catalog-editorial/current.json');let calls=0;
 await assert.rejects(prepareEditorialHome({storage:f.storage,search:async market=>{
  calls++;const result=await searchOffers({market,pageSize:12,sort:'updatedAt'});
  f.values.set('catalog-editorial/current.json',{...captured,entries:{}});return result;
 }}),/catalog_editorial_home_revision_changed/);
 assert.equal(calls,1);assert.equal(f.writes.length,0);
});

test('conditional replacement requires an ETag and never retries a missing one',async t=>{
 const f=await fixture(t);await f.prepare();await f.prepare();
 assert.deepEqual(f.writes[1].condition,{ifMatch:'"old"'});
 const previous=f.storage.readJsonWithMeta;
 f.storage.readJsonWithMeta=async<T>(key:string,fallback:T)=>{
  const result=await previous.call(f.storage,key,fallback);
  return key.includes('/editorial-home-v1/')?{...result,etag:undefined}:result;
 };
 await assert.rejects(f.prepare(),/catalog_editorial_home_etag_required/);assert.equal(f.writes.length,2);
});

test('preparation admits at most two searches and joins a failed batch before returning',async t=>{
 const f=await fixture(t),index=f.values.get('catalog-editorial/current.json');
 for(const market of ['korea','uae']){
  f.manifest.markets[market].count=1;index.entries[market]={id:market,market,status:'hidden'};
 }
 let release!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve;});
 let active=0,maximum=0,settled=false;const called:string[]=[];
 const preparation=prepareEditorialHome({storage:f.storage,search:async market=>{
  called.push(market);active++;maximum=Math.max(maximum,active);
  try{if(market==='korea'){await Promise.resolve();throw Error('exact-search-failed');}await pending;return {generationId:f.generationId,total:0,items:[]};}
  finally{active--;}
 }}).finally(()=>{settled=true;});
 // Attach the rejection observer immediately; neither provider nor I/O is used.
 const rejected=assert.rejects(preparation,/exact-search-failed/);
 await new Promise(resolve=>setImmediate(resolve));assert.equal(settled,false);assert.equal(active,1);
 release();await rejected;
 assert.deepEqual(called,['korea','uae']);assert.equal(maximum,2);assert.equal(active,0);assert.equal(f.writes.length,0);
});

test('path is safely versioned and calculation contexts cannot collide',async()=>{
 const a=editorialHomeContext('a/../../b'),b={...a,encyclopediaDigest:'changed'};
 assert.notEqual(editorialHomePath('generation','2026-11-11',a),editorialHomePath('generation','2026-11-11',b));
 assert.throws(()=>editorialHomePath('../bad','2026-11-11',a),/scope_invalid/);
 assert.deepEqual(await readEditorialHome('../bad',{europe:1},['europe']),{});
 resetEditorialHomeCache();
});

test('actual CLI prelude maps the pinned controller source to the exact runtime context before imports',()=>{
 const source=readFileSync(new URL('../scripts/catalog-refresh-generation-pages.mjs',import.meta.url),'utf8');
 const prelude=source.slice(0,source.indexOf('const {getJsonStorage}')).replace(/^import .*;$/gm,'');
 const initialize=new Function('process','releaseMarkets',prelude),sha='a'.repeat(40),other='b'.repeat(40);
 const mapped:Record<string,string>={GITHUB_SHA:sha};initialize({env:mapped},()=>null);
 assert.equal(mapped.AVTOCENA_RELEASE_SHA,sha);
 const explicit:Record<string,string>={GITHUB_SHA:other,RELEASE_SOURCE_SHA:sha};initialize({env:explicit},()=>null);
 assert.equal(explicit.AVTOCENA_RELEASE_SHA,sha,'controller source outranks workflow checkout');
 for(const env of [{GITHUB_SHA:'not-a-sha'},{AVTOCENA_RELEASE_SHA:'invalid'},{GITHUB_SHA:sha,AVTOCENA_RELEASE_SHA:other}]){
  assert.throws(()=>initialize({env:{...env}},()=>null),/catalog_pages_release_(invalid|mismatch)/);
 }
 const absent:Record<string,string>={};initialize({env:absent},()=>null);assert.equal(absent.AVTOCENA_RELEASE_SHA,undefined,'no invented release identifier');
 const previous=process.env.AVTOCENA_RELEASE_SHA;
 try{
  process.env.AVTOCENA_RELEASE_SHA=mapped.AVTOCENA_RELEASE_SHA;
  const prepared=editorialHomePath('generation','2026-11-11',editorialHomeContext('edit-1'));
  process.env.AVTOCENA_RELEASE_SHA=sha;
  assert.equal(prepared,editorialHomePath('generation','2026-11-11',editorialHomeContext('edit-1')));
 }finally{if(previous===undefined)delete process.env.AVTOCENA_RELEASE_SHA;else process.env.AVTOCENA_RELEASE_SHA=previous;}
});
