import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {cachedJapanCountSummary,japanCountQueryKey,readJapanCountSummary,rememberJapanCountSummary,subscribeJapanCount} from '../apps/web/components/catalog/japan-count-request';
import {createAjesSourceCountSummary} from '../apps/web/lib/catalog/ajes-source-count';
import {ajesVisibleCount} from '../apps/web/lib/catalog/ajes-count-display';

const observedAt='2026-11-28T08:00:00Z';
const freshNow=Date.parse('2026-11-28T08:05:00Z');
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
const turn=()=>new Promise(resolve=>setImmediate(resolve));
function summary(canonicalQuery:Record<string,string>,total:number,sourceObservedAt=observedAt){
 return createAjesSourceCountSummary({total,stale:false,observedAt:sourceObservedAt},{
  requestedQueryHash:hash(JSON.stringify(canonicalQuery)),sourceQueryHash:hash('controlled scalar SQL'),
  evidenceEpoch:hash('controlled local evidence'),sourceScopeComplete:true,directoryComplete:true,
 });
}
const response=(countSummary:unknown)=>new Response(JSON.stringify({ok:true,total:null,countSummary}),{status:200});

test('count identity retains every actual filter and city while canonicalizing aliases and page presentation',()=>{
 const params={brand:[' Audi ','ignored'],model:'A4',body:'sedan',budget:'2000000',budgetFrom:'500000',city:'Новокузнецк',powerTo:'160',
  yearFrom:'2020',yearTo:'2025',fuel:'petrol',drive:'awd',transmission:'automatic',engineFrom:'1000',engineTo:'2000',color:'white',
  grade:'4',hasPrice:'1',page:'7',pageSize:'24',after:'cursor',marketPage:'2',sort:'totalRubDesc',view:'list',source:'ajes',countOnly:'1'};
 const expected={bodyType:'sedan',budgetFrom:'500000',budgetTo:'2000000',city:'Новокузнецк',color:'white',drive:'awd',engineFrom:'1000',engineTo:'2000',
  fuel:'petrol',grade:'4',hasPrice:'1',make:'Audi',market:'japan',model:'A4',powerTo:'160',transmission:'automatic',yearFrom:'2020',yearTo:'2025'};
 assert.equal(japanCountQueryKey(params),JSON.stringify(expected));
 assert.equal(japanCountQueryKey({...expected,sort:'totalRub',page:'2',after:'next'}),JSON.stringify(expected));
 for(const [key,value] of Object.entries(expected).filter(([key])=>key!=='market'))
  assert.notEqual(japanCountQueryKey({...expected,[key]:value+'-changed'}),JSON.stringify(expected),key+' is part of the full selection');
 assert.equal(japanCountQueryKey({brand:'Honda',make:'Audi',body:'van',bodyType:'sedan',budget:'9',budgetTo:'10'}),
  JSON.stringify({bodyType:'sedan',budgetTo:'10',make:'Audi',market:'japan'}),'explicit canonical filters take precedence over aliases');
});

test('the general Japan page shares one independent COUNT through append and sort without making a LIST read',async t=>{
 t.mock.method(Date,'now',()=>freshNow);
 const canonical={city:'Новокузнецк',market:'japan'},source=summary(canonical,654060);
 const requests:URL[]=[];let finish!:(value:Response)=>void;
 t.mock.method(globalThis,'fetch',async(input,options)=>{
  requests.push(new URL(String(input),'https://avtocena.com'));assert.equal(options?.cache,'no-store');assert.ok(options?.signal);
  return new Promise<Response>(resolve=>{finish=resolve;});
 });
 const first=readJapanCountSummary({city:'Новокузнецк',page:'1',sort:'totalRubDesc'});
 const duplicate=readJapanCountSummary({city:'Новокузнецк',page:'2',after:'next',sort:'totalRub'});
 assert.equal(first,duplicate,'two consumers of the same membership share the in-flight scalar');
 assert.equal(requests.length,1);assert.equal(requests[0].pathname,'/api/catalog/search');
 assert.deepEqual(Object.fromEntries(requests[0].searchParams),{city:'Новокузнецк',market:'japan',countOnly:'1'});
 finish(response(source));assert.deepEqual(await first,source);
 const retained=await readJapanCountSummary({city:'Новокузнецк',page:'3',after:'another',sort:'totalRubDesc'});
 assert.equal(requests.length,1,'append/page/sort changes do not reread a fresh aggregate or LIST');
 assert.equal(retained.total,654060);assert.equal(retained.observedAt,observedAt);
 for(const loaded of [24,48]){
  const visible=ajesVisibleCount(retained,loaded);assert.equal(visible.total,undefined);assert.equal(visible.loadedCount,loaded);
  assert.equal(visible.status,'bounded','the source count stays distinct from an admitted exact total');
 }
});

test('a filtered count-only request sends budget, power, model, source filters and city together',async t=>{
 t.mock.method(Date,'now',()=>freshNow);
 const canonical={bodyType:'sedan',budgetTo:'1800000',city:'Казань',drive:'awd',fuel:'petrol',make:'Audi',market:'japan',model:'A4',powerTo:'160',yearFrom:'2020'};
 let reads=0;
 t.mock.method(globalThis,'fetch',async input=>{
  reads++;const query=new URL(String(input),'https://avtocena.com').searchParams;
  assert.deepEqual(Object.fromEntries(query),{...canonical,countOnly:'1'});
  return response(summary(canonical,592));
 });
 const result=await readJapanCountSummary({brand:'Audi',body:'sedan',budget:'1800000',city:'Казань',drive:'awd',fuel:'petrol',model:'A4',powerTo:'160',yearFrom:'2020',page:'2',after:'old'});
 assert.equal(reads,1);assert.equal(result.total,592);
 assert.equal(result.sourceCountProof?.requestedQueryHash,hash(JSON.stringify(canonical)));
});

test('a late response from an obsolete filter cannot publish into the new filter, and identical subscribers share a read',async t=>{
 t.mock.method(Date,'now',()=>freshNow);
 const a={city:'Томск',make:'Audi',market:'japan'},b={city:'Томск',make:'Honda',market:'japan'};
 const requests=new Map<string,(value:Response)=>void>(),published:string[]=[];
 t.mock.method(globalThis,'fetch',async input=>{
  const make=new URL(String(input),'https://avtocena.com').searchParams.get('make')!;
  assert.equal(requests.has(make),false,'one scalar per same-query concurrent subscribers');
  return new Promise<Response>(resolve=>requests.set(make,resolve));
 });
 const stopA=subscribeJapanCount(a,value=>published.push('old:'+value.total));
 const readA=readJapanCountSummary(a);stopA();
 const stopB=subscribeJapanCount(b,value=>published.push('new:'+value.total));
 const stopB2=subscribeJapanCount({...b,sort:'totalRubDesc'},value=>published.push('same:'+value.total));
 const readB=readJapanCountSummary(b);
 assert.equal(requests.size,2);
 requests.get('Honda')!(response(summary(b,200)));await readB;await turn();
 assert.deepEqual(published,['new:200','same:200']);
 requests.get('Audi')!(response(summary(a,300)));await readA;await turn();
 assert.deepEqual(published,['new:200','same:200'],'the cancelled selection never replaces the new aggregate');
 assert.equal(cachedJapanCountSummary(japanCountQueryKey(a))?.total,300,'an obsolete response belongs only to its own filter cache');
 assert.equal(cachedJapanCountSummary(japanCountQueryKey(b))?.total,200);
 stopB();stopB2();
});

test('a response for another query and an unproved page-size total never become an aggregate',async t=>{
 t.mock.method(Date,'now',()=>freshNow);
 const canonical={city:'Омск',make:'Toyota',market:'japan'};
 let reads=0;
 t.mock.method(globalThis,'fetch',async()=>{
  reads++;
  return response(reads===1?summary({city:'Омск',make:'Honda',market:'japan'},900):{total:24,stale:false,observedAt,upperBound:false});
 });
 await assert.rejects(readJapanCountSummary(canonical),/japan_count_query_mismatch/);
 assert.equal(cachedJapanCountSummary(japanCountQueryKey(canonical)),null);
 await assert.rejects(readJapanCountSummary(canonical),/japan_count_query_mismatch/);
 assert.equal(cachedJapanCountSummary(japanCountQueryKey(canonical)),null);
 assert.equal(ajesVisibleCount(null,24).total,undefined);assert.equal(reads,2);
 await turn();assert.equal(reads,2,'a failure does not start an automatic retry loop');
});

test('an expired count survives one failed refresh with its original date and then ages out without becoming zero',async t=>{
 let now=freshNow;t.mock.method(Date,'now',()=>now);
 const canonical={city:'Иркутск',market:'japan'},source=summary(canonical,654060);let reads=0;
 t.mock.method(globalThis,'fetch',async()=>++reads===1?response(source):new Response('{}',{status:503}));
 await readJapanCountSummary(canonical);now=Date.parse('2026-11-28T08:30:01Z');
 await assert.rejects(readJapanCountSummary(canonical),/japan_count_unavailable/);
 const retained=cachedJapanCountSummary(japanCountQueryKey(canonical));
 assert.equal(retained?.total,654060);assert.equal(retained?.stale,true);assert.equal(retained?.observedAt,observedAt);
 assert.equal(ajesVisibleCount(retained,48).status,'stale');assert.equal(ajesVisibleCount(retained,48).total,undefined);
 await turn();await turn();assert.equal(reads,2,'expiry and a failed request never create recursive refreshes');
 now=Date.parse('2026-12-05T08:00:00Z');
 assert.equal(cachedJapanCountSummary(japanCountQueryKey(canonical)),null);
 assert.equal(ajesVisibleCount(cachedJapanCountSummary(japanCountQueryKey(canonical)),48).total,undefined);
});

test('a valid SSR aggregate is reused without a second client COUNT and without renewing its observation',async t=>{
 t.mock.method(Date,'now',()=>freshNow);
 const canonical={city:'Красноярск',market:'japan',powerTo:'160'},source=summary(canonical,654060);
 rememberJapanCountSummary(japanCountQueryKey(canonical),source);
 t.mock.method(globalThis,'fetch',async()=>{assert.fail('a fresh SSR count must be reused');});
 const result=await readJapanCountSummary({...canonical,sort:'totalRubDesc',page:'2'});
 assert.equal(result.total,654060);assert.equal(result.observedAt,observedAt);assert.equal(result.stale,false);
});
