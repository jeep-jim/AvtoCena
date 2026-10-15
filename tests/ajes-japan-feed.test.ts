import test from 'node:test';
import assert from 'node:assert/strict';
import {ajesQuery,ajesLot,ajesImageUrl} from '../apps/web/lib/catalog/ajes-query';
import {createAjesClient} from '../apps/web/lib/catalog/ajes-client';
import {reserveAjesRequest} from '../apps/web/lib/catalog/ajes-quota';
import {StorageConflictError,type JsonStorage} from '../apps/web/lib/data';
import {defaultCollectionControls,collectionEnabled} from '../apps/web/lib/catalog/collection-controls-schema';
import {validateCollectionControls} from '../apps/web/lib/catalog/collection-controls';
const row={ID:'test123',MARKA_NAME:'TOYOTA',MODEL_NAME:'TEST',YEAR:'2023',AUCTION_TYPE:'2',STATUS:'Sold',FINISH:'935000',START:'100000',PW:'49',PRIV:'FF,FULLTIME4WD',IMAGES:'https://7.tru.ru/imgs/testABC&h=50'};

test('query grammar rejects SQL/unknown fields and bounds pages, ages and table',()=>{
  for(const input of [{sql:'select * from stats'},{table:'stats;drop'},{id:"x' or 1=1"},{make:"TOYOTA'"},{model:'x\\y'},{page:-1},{pageSize:10000},{yearFrom:2009},{yearFrom:2025,yearTo:2020},{id:'ok',make:'TOYOTA'},{budgetTo:2000000}])assert.throws(()=>ajesQuery(input));
  const q=ajesQuery({make:'Toyota',model:'C-HR',page:2,pageSize:24});
  assert.match(q.sql,/status='Sold' and finish>0/);assert.match(q.sql,/auction_type!=1/);assert.match(q.sql,/limit 24,24$/);assert.match(q.sql,/marka_name='TOYOTA'/);
  assert.equal(ajesQuery({id:'abc',table:'stats'}).sql,"select * from stats where id='abc'");
});
test('sold price is FINISH only; USS, old, unsold and missing prices never become offers',()=>{
  for(const change of [{AUCTION_TYPE:'1'},{YEAR:'2009'},{STATUS:'Not sold'},{FINISH:'0',AVG_PRICE:'1000000'},{FINISH:'garbage'},{ID:"x'"}])assert.equal(ajesLot({...row,...change},'stats',false),null);
  const lot=ajesLot(row,'stats',false)!;
  assert.equal(lot.finalPriceJpy,935000);assert.equal(lot.startPriceJpy,null);assert.equal(lot.sourceDrive,'FF,FULLTIME4WD');assert.equal((lot as any).powerHp,undefined);assert.equal((lot as any).totalRub,undefined);
  const active=ajesLot(row,'main',false)!;assert.equal(active.finalPriceJpy,null);assert.equal(active.startPriceJpy,100000);
});
test('direct image variants reject foreign/private URLs and only detail marks a sheet',()=>{
  for(const url of ['http://7.tru.ru/imgs/abc','https://7.tru.ru.evil.test/imgs/abc','https://127.0.0.1/imgs/abc','https://7.tru.ru/imgs/abc?code=secret','https://user@7.tru.ru/imgs/abc'])assert.equal(ajesImageUrl(url),null);
  assert.equal(ajesImageUrl('https://7.tru.ru/imgs/abc&w=320&h=50'),'https://7.tru.ru/imgs/abc&w=320');
  assert.equal(ajesLot(row,'stats',false)!.images[0].role,'vehicle');assert.equal(ajesLot(row,'stats',true)!.images[0].role,'auction_sheet');
});
test('duplicate user requests coalesce; cache hits still obey source switch',async()=>{
  let enabled=true,calls=0,reserved=0;
  const client=createAjesClient({password:()=> 'test-secret',assertEnabled:async()=>{if(!enabled)throw Error('disabled');},reserve:async()=>{reserved++;},fetcher:async(url,options)=>{calls++;assert.equal(options?.redirect,'error');assert.equal(new URL(String(url)).searchParams.get('ip'),'127.0.0.1');return new Response(JSON.stringify([row]),{headers:{'API-Rest':'19990'}});}});
  const [a,b]=await Promise.all([client.read({},'127.0.0.1'),client.read({},'127.0.0.1')]);
  assert.deepEqual(a,b);assert.equal(calls,1);assert.equal(reserved,1);assert.equal(a.quota.remaining,19990);assert.ok(!JSON.stringify(a).includes('test-secret'));
  enabled=false;await assert.rejects(client.read({},'127.0.0.1'),/disabled/);assert.equal(calls,1);
});
test('provider failures never expose its URL/body/secret and are not cached as no results',async()=>{
  let calls=0;
  const client=createAjesClient({password:()=> 'test-secret',assertEnabled:async()=>{},reserve:async()=>{},fetcher:async()=>{calls++;if(calls===1)throw Error('http://example/?code=test-secret');return new Response(JSON.stringify([row]));}});
  await assert.rejects(client.read({},'127.0.0.1'),e=>String(e)==='Error: ajes_request_failed');
  assert.equal((await client.read({},'127.0.0.1')).items.length,1);assert.equal(calls,2);
});
test('wrong detail identity, oversized response and invalid JSON fail closed',async()=>{
  for(const response of [new Response(JSON.stringify([{...row,ID:'wrong'}])),new Response('secret error page'),new Response('[]',{headers:{'content-length':'3000000'}})]){
    const client=createAjesClient({password:()=> 'test',assertEnabled:async()=>{},reserve:async()=>{},fetcher:async()=>response});
    await assert.rejects(client.read({id:'test123'},'127.0.0.1'),/ajes_(identity_mismatch|invalid_response|response_too_large)/);
  }
});
function storage(){
 const objects=new Map<string,{value:any;etag:number}>();
 return {readJsonWithMeta:async(key:string)=>{const v=objects.get(key);return{found:!!v,value:v?structuredClone(v.value):null,etag:v?String(v.etag):undefined};},writeJson:async(key:string,value:any,condition:any)=>{const old=objects.get(key);if((condition.ifNoneMatch&&old)||(condition.ifMatch&&condition.ifMatch!==String(old?.etag)))throw new StorageConflictError();objects.set(key,{value:structuredClone(value),etag:(old?.etag??0)+1});}} as unknown as JsonStorage;
}
test('durable quota uses conditional reservations and independent pools, including failures',async()=>{
  const s=storage(),now=Date.now();
  const attempts=await Promise.allSettled(Array.from({length:5},()=>reserveAjesRequest(s,'stats',now,3)));
  assert.equal(attempts.filter(r=>r.status==='fulfilled').length,3);
  await assert.rejects(reserveAjesRequest(s,'stats',now+24*3600000,3),/quota_exhausted/);
  await reserveAjesRequest(s,'main',now,3);await reserveAjesRequest(s,'stats',now+25*3600000,3);
});
test('legacy controls gain only new disabled feed; corruption and old source revival remain blocked',()=>{
  const legacy=defaultCollectionControls();delete legacy.sources.ajes_japan_feed;
  const controls=validateCollectionControls(legacy);assert.equal(collectionEnabled(controls,'ajes_japan_feed'),false);assert.equal(collectionEnabled(controls,'akebono_green'),true);
  controls.sources.ajes_japan_feed.enabled=true;assert.equal(collectionEnabled(controls,'ajes_japan_feed'),true);
  controls.markets.japan.enabled=false;assert.equal(collectionEnabled(controls,'ajes_japan_feed'),false);
  delete legacy.sources.che168_feed;assert.throws(()=>validateCollectionControls(legacy));
});
