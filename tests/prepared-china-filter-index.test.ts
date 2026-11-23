import './helpers/server-only-hook.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {
 createPreparedChinaFilterIndex,selectPreparedChinaFilterPage,preparedChinaFilterEntry,
 assertPreparedChinaFilterEntry,resetPreparedChinaFilterIndexCacheForTests,
} from '../apps/web/lib/catalog/prepared-china-filter-index';
import {selectPreparedChinaCompatibilityRows,orderPreparedChinaCompatibilityRows} from '../apps/web/lib/catalog/storage';
import type {CatalogSearchParams} from '../apps/web/lib/catalog/types';
import {openPreparedChinaSnapshot} from '../apps/web/lib/catalog/prepared-china-fixture-activation';
import {preparedPriceCardDigest,preparedPriceCardMarketDigest} from '../apps/web/lib/catalog/prepared-price-card-block';
import {summarizeChinaSelectorPart} from '../apps/web/lib/catalog/prepared-china-streaming-selector';

const generationId='gen_1795166586455_filters',marketDigest='a'.repeat(64),context={generationId,marketDigest};
const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
function offer(i:number,patch:Record<string,unknown>={}){
 const totalRub=i%7===0?16_000_000+i*1234:1_000_000+i*1234;
 return {id:'filter-'+i,market:'china',make:i%4===0?'BMW':'Toyota',model:i%4===0?'X1':'Corolla',year:2020+i%6,
  mileageKm:i%9===0?null:i*1200,engineCc:i%11===0?null:1498,powerHp:[150,200,null,160.005,160.02][i%5],
  utilizationPowerKw:null,powertrainKind:'combustion',fuel:i%3===0?'diesel':'petrol',bodyType:i%4===0?'suv':'sedan',
  transmission:i%4===0?'dct':'at',drive:i%3===0?'awd':'fwd',totalRub,publicVisibleRub:totalRub,
  calculationStatus:'ready',publicSpecificationVerified:true,cardProjectionVersion:3,cardImageUrl:'https://example.com/car.jpg',
  calculationSnapshot:{pricingConfidence:'exact',deliveryPricingBasis:{subtotalRub:totalRub,deliveryRub:100_000,percents:[]}},
  sourceGroup:i%9===0?'':i%2?'source-a':'source-b',updatedAt:'2026-11-'+String(1+i%20).padStart(2,'0')+'T00:00:00.000Z',
  ...patch} as any;
}
const position=(i:number,id:string)=>({id,chunk:'chunk-'+String(Math.floor(i/500)+1).padStart(4,'0'),part:Math.floor(i%500/128),offset:i%500%128});
async function fixture(rows:any[],scope=context){
 resetPreparedChinaFilterIndexCacheForTests();
 const writer=createPreparedChinaFilterIndex(scope),objects=new Map<string,Buffer>(),reads:string[]=[];
 rows.forEach((row,i)=>writer.add(row,position(i,row.id)));
 const ref=await writer.publish(async(key,body)=>{objects.set(key,body);});
 const get=async(key:string,sha:string)=>{reads.push(key);const body=objects.get(key);assert.ok(body,'unexpected object read '+key);assert.equal(hash(body),sha);return body;};
 return {ref,objects,reads,get,select:(query:CatalogSearchParams,start=0,pageSize=24,countOnly=false)=>
  selectPreparedChinaFilterPage({...scope,rows:rows.length},ref,query,{start,pageSize,countOnly},get)};
}

test('prepared ordinary filters preserve exact membership, default ordering, source balance and pagination',async()=>{
 const rows=Array.from({length:140},(_,i)=>offer(i));
 rows[0]=offer(0,{make:'Toyota',model:'Yaris',encyclopediaDisplayIdentity:{rawModel:'Yaris L'}});
 rows[1]=offer(1,{make:'Toyota',model:'Hilux',trim:'Double Cab',bodyType:'van'});
 rows[2]=offer(2,{fuel:'electric',powertrainKind:'electric',powerHp:300,utilizationPowerKw:80});
 rows[3]=offer(3,{fuel:'hybrid',powertrainKind:'other_hybrid',powerHp:300,utilizationPowerKw:null});
 rows[4]=offer(4,{make:'Isuzu',model:'Elf',bodyType:'truck'});
 const f=await fixture(rows);
 const predicates=[{powerTo:160},{powerFrom:160.02},{powerFrom:140,powerTo:160},{yearFrom:2022,yearTo:2024},
  {mileageTo:40_000},{engineFrom:1400,engineTo:1600},{make:'Toyota'},{make:'BMW',model:'X1'},
  {model:'Yaris L'},{bodyType:'pickup'},{drive:'awd',transmission:'at'},
  {fuel:'diesel',yearFrom:2021,powerTo:160},{powerTo:160,city:'Новокузнецк'}];
 for(const predicate of predicates){
  const query={market:'china',...predicate} as CatalogSearchParams;
  const expected=await selectPreparedChinaCompatibilityRows(rows,query);orderPreparedChinaCompatibilityRows(expected,query);
  for(const start of [0,24,72,168]){
   const actual=await f.select(query,start);
   assert.equal(actual?.total,expected.length,JSON.stringify(query));
   assert.deepEqual(actual?.positions.map(row=>row[0]),expected.slice(start,start+24).map(row=>row.id),JSON.stringify(query)+' page '+start);
  }
  const count=await f.select(query,0,24,true);
  assert.deepEqual(count,{total:expected.length,positions:[]});
 }
 assert.equal(f.reads.length,2,'repeated queries only load one compact directory and one compact part');
});

test('a large filter reads compact artifacts, retains unknown-power exclusion and never reads full projections',async()=>{
 const rows=Array.from({length:17_000},(_,i)=>offer(i,{sourceGroup:'paid-che168'}));
 const f=await fixture(rows),result=await f.select({market:'china',powerTo:160});
 assert.equal(result?.positions.length,24);
 assert(result!.total>1000);
 assert.equal(f.reads.length,4,'one directory plus three bounded metadata parts');
 assert(f.reads.every(key=>key.includes('/filters-v1/')));
 assert.equal(result!.positions.some(row=>row[10]===null&&row[11]===null),false);
 for(const entry of result!.positions){
  const original=rows.find(row=>row.id===entry[0]);
  assertPreparedChinaFilterEntry(original,entry);
  assert.throws(()=>assertPreparedChinaFilterEntry({...original,powerHp:999},entry),/projection_parity/);
 }
 const bytes=[...f.objects.values()].reduce((sum,b)=>sum+b.length,0);
 assert(bytes<4*1024*1024,'large metadata sample stays compact');
});

test('unsupported predicates and uncertain city ordering retain the existing path',async()=>{
 const f=await fixture([offer(1)]);
 for(const query of [{market:'china',sort:'totalRub'},{market:'china',budgetTo:2_000_000},{market:'china',color:'white'},{market:'korea',powerTo:160}])
  assert.equal(await f.select(query as CatalogSearchParams),null);
 assert.equal(f.reads.length,0);
 const low=await fixture([offer(1,{totalRub:10,publicVisibleRub:10,calculationSnapshot:{pricingConfidence:'exact',deliveryPricingBasis:{subtotalRub:10,deliveryRub:100,percents:[]}}})]);
 assert.equal(await low.select({market:'china',powerTo:160,city:'Новокузнецк'}),null);
});

test('producer rejects duplicate identity/location and immutable integrity/coverage failures never become empty success',async()=>{
 const writer=createPreparedChinaFilterIndex(context),row=offer(1);
 writer.add(row,position(0,row.id));
 assert.throws(()=>writer.add(row,position(1,row.id)),/duplicate/);
 assert.throws(()=>writer.add(offer(2),position(0,'filter-2')),/duplicate/);
 const f=await fixture([offer(1),offer(2)]);
 const input={start:0,pageSize:24,countOnly:false},query={market:'china',powerTo:160} as CatalogSearchParams;
 await assert.rejects(selectPreparedChinaFilterPage({...context,rows:3},f.ref,query,input,f.get),/directory/);
 await assert.rejects(selectPreparedChinaFilterPage({...context,marketDigest:'b'.repeat(64),rows:2},f.ref,query,input,f.get),/directory/);
 await assert.rejects(selectPreparedChinaFilterPage({...context,rows:2},{version:1,sha256:'broken'},query,input,f.get),/scope/);
 resetPreparedChinaFilterIndexCacheForTests();
 await assert.rejects(selectPreparedChinaFilterPage({...context,rows:2},f.ref,query,input,async(key)=>{
  const body=f.objects.get(key)!;return key.includes('/parts/')?Buffer.from(body.toString().replace('gzip','bad!')):body;
 }),/integrity/);
});

test('filter metadata keeps explicit missing certification distinct from a high peak rating',()=>{
 const unknown=offer(2,{fuel:'electric',powertrainKind:'electric',powerHp:300,utilizationPowerKw:null});
 const exact=offer(3,{fuel:'electric',powertrainKind:'electric',powerHp:300,utilizationPowerKw:80});
 assert.equal(preparedChinaFilterEntry(unknown,position(0,unknown.id))[11],null);
 assert.equal(preparedChinaFilterEntry(exact,position(1,exact.id))[11],80);
});

test('authenticated snapshots hydrate only selected page parts and keep pointer fencing and old-pack fallback',async()=>{
 const rows=Array.from({length:1024},(_,i)=>offer(i,{sourceGroup:'paid-che168'}));
 const chunks=Array.from({length:Math.ceil(rows.length/500)},(_,i)=>'chunk-'+String(i+1).padStart(4,'0'));
 const manifest:any={version:2,generationId,updatedAt:new Date().toISOString(),markets:{china:{count:rows.length,chunks,updatedAt:new Date().toISOString()}}};
 const digest=preparedPriceCardMarketDigest(manifest,'china'),f=await fixture(rows,{generationId,marketDigest:digest});
 const root=`catalog/generations/${generationId}/indexes/prepared-china-read-v1/`,validUntil=Date.now()+60_000;
 const put=(path:(sha:string)=>string,value:unknown)=>{const body=Buffer.from(JSON.stringify(value)),sha=hash(body);f.objects.set(root+path(sha),body);return sha;};
 const chunkSha256:string[]=[];
 for(let ci=0;ci<chunks.length;ci++){
  const chunk=chunks[ci],source=rows.slice(ci*500,(ci+1)*500),parts:any[]=[],selectors:any[]=[];
  for(let offset=0;offset<source.length;offset+=128){
   const part=parts.length,items=source.slice(offset,offset+128);
   const projectionSha256=put(sha=>`projections/${chunk}/${part}-${sha}.json`,{generationId,items});
   parts.push({market:'china',generationId,sourceChunk:chunk,part,rows:items.length,projectionSha256,
    marketInventoryDigest:digest,tariffValidUntil:validUntil,sourceIdsSha256:preparedPriceCardDigest(items.map(row=>row.id))});
   selectors.push(summarizeChinaSelectorPart(items));
  }
  chunkSha256.push(put(sha=>`chunks/${chunk}-${sha}.json`,{version:1,generationId,chunk,parts,selectors}));
 }
 const directory:any={version:1,generationId,marketDigest:digest,validUntil,rows:rows.length,chunkSha256,
  streamingSelector:true,navigationFacets:{generationId},filterIndex:f.ref};
 manifest.markets.china.preparedChinaPriceReadV1={directorySha256:put(sha=>`directory-${sha}.json`,directory)};
 let current=true;
 const open=()=>openPreparedChinaSnapshot(manifest,async(key,sha)=>f.get(key,sha!),async()=>{assert(current,'active_changed');});
 const snapshot=await open();f.reads.length=0;
 const query={market:'china',powerTo:160} as CatalogSearchParams;
 const selection=await snapshot.filterPage(query,{start:24,pageSize:24,countOnly:false});
 assert(selection);assert.equal(f.reads.length,2);assert(f.reads.every(key=>key.includes('/filters-v1/')));
 const loaded=new Map<string,any>(),meta=new Map<string,any>();
 for(const entry of selection.positions){
  if(!meta.has(entry[1]))meta.set(entry[1],await snapshot.readChunk(entry[1]));
  const key=entry[1]+':'+entry[2];
  if(!loaded.has(key))loaded.set(key,await meta.get(entry[1]).load(entry[2]));
  assertPreparedChinaFilterEntry(loaded.get(key).projection.items[entry[3]],entry);
 }
 assert(loaded.size<=24,'hydration touches no more parts than the page contains cars');
 const countReads=f.reads.length;
 assert.equal((await snapshot.filterPage(query,{start:0,pageSize:24,countOnly:true}))?.total,selection.total);
 assert.equal(f.reads.length,countReads,'count uses cached compact metadata, not card blocks');
 await snapshot.assertCurrent();current=false;await assert.rejects(snapshot.assertCurrent(),/active_changed/);current=true;
 delete directory.filterIndex;
 manifest.markets.china.preparedChinaPriceReadV1={directorySha256:put(sha=>`directory-${sha}.json`,directory)};
 const legacy=await open(),before=f.reads.length;
 assert.equal(await legacy.filterPage(query,{start:0,pageSize:24,countOnly:false}),null);
 assert.equal(f.reads.length,before,'absence does not trigger on-demand index generation or a speculative lookup');
});


test('dealer and public saved-search links select the own China cut with the same filters',async()=>{
 const {unsupportedPreparedChinaSource:blocked}=await import('../apps/web/lib/catalog/prepared-china-http-fixture');
 for(const source of [undefined,null,'','existing'])assert.equal(blocked(source,''),false);
 assert.equal(blocked('ajes',null),true);
 assert.equal(blocked('existing','green'),true);
 const rows=Array.from({length:72},(_,i)=>offer(i));
 const f=await fixture(rows);
 const query={market:'china',powerTo:160} as CatalogSearchParams;
 const matches=await selectPreparedChinaCompatibilityRows(rows,query);orderPreparedChinaCompatibilityRows(matches,query);
 for(const start of [0,24]){
  const page=await f.select(query,start);
  assert.equal(page?.total,matches.length);
  assert.deepEqual(page?.positions.map(x=>x[0]),matches.slice(start,start+24).map(x=>x.id));
 }
});
