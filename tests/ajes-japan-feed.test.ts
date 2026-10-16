import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
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
  const extended=ajesQuery({lotNumber:'001234',chassis:'LA250S',engineFrom:600,engineTo:1500,mileageFrom:0,mileageTo:50000});
  assert.match(extended.sql,/lot='001234'/);assert.match(extended.sql,/kuzov='LA250S'/);assert.match(extended.sql,/eng_v>=600 and eng_v<=1500/);
  for(const q of [{lotNumber:"1'"},{lotNumber:123},{engineFrom:2000,engineTo:1000},{mileageFrom:100,mileageTo:0}])assert.throws(()=>ajesQuery(q));
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
test('supplier bot refusal never exposes echoed credentials or substitutes visitor IP',async()=>{
  let calls=0;
  const client=createAjesClient({password:()=> 'test-secret',assertEnabled:async()=>{},reserve:async()=>{},fetcher:async url=>{
    calls++;assert.equal(new URL(String(url)).searchParams.get('ip'),'203.0.113.9');
    return new Response('bot2 us'+'test-secret');
  }});
  await assert.rejects(client.read({},'203.0.113.9'),e=>String(e)==='Error: ajes_visitor_restricted');
  assert.equal(calls,1);
});
test('gzip wrapper and already decoded fetch responses both work with bounded decompression',async()=>{
  for(const body of [gzipSync(JSON.stringify([row])),Buffer.from(JSON.stringify([row]))]){
    const client=createAjesClient({password:()=> 'test',assertEnabled:async()=>{},reserve:async()=>{},fetcher:async(url)=>{assert.equal(new URL(String(url)).pathname,'/gzip/');return new Response(body);}});
    assert.equal((await client.read({id:'test123'},'127.0.0.1')).items.length,1);
  }
  const bomb=gzipSync(' '.repeat(3*1024*1024));
  const client=createAjesClient({password:()=> 'test',assertEnabled:async()=>{},reserve:async()=>{},fetcher:async()=>new Response(bomb)});
  await assert.rejects(client.read({},'127.0.0.1'),/invalid_response/);
});
test('only opened valid details persist; fresh saved detail survives process restart; disabled source cannot read it',async()=>{
  let saved:any=null,calls=0,writes=0,enabled=true;
  const deps={password:()=> 'test',assertEnabled:async()=>{if(!enabled)throw Error('disabled');},reserve:async()=>{},readDetail:async()=>saved,saveDetail:async(_t:any,_id:any,value:any)=>{saved=value;writes++;},fetcher:async()=>{calls++;return new Response(JSON.stringify([row]));}};
  await createAjesClient(deps).read({},'127.0.0.1');assert.equal(writes,0);
  await createAjesClient(deps).read({id:'test123'},'127.0.0.1');assert.equal(writes,1);
  await createAjesClient(deps).read({id:'test123'},'127.0.0.1');assert.equal(calls,2);
  saved.observedAt=new Date(Date.now()-31*60000).toISOString();
  await createAjesClient(deps).read({id:'test123'},'127.0.0.1');assert.equal(calls,3);
  enabled=false;await assert.rejects(createAjesClient(deps).read({id:'test123'},'127.0.0.1'),/disabled/);assert.equal(calls,3);
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

import {ajesOffer,ajesOfferId} from '../apps/web/lib/catalog/ajes-offer';
import {isSellerPricedOffer} from '../apps/web/lib/catalog/seller-price-contract';
import {publicationWithdrawn} from '../apps/web/lib/catalog/publication-policy';
import {rankedCatalogImageUrls,catalogAuctionSheetUrls} from '../apps/web/lib/catalog/image-quality';
test('paid Japanese sold record has only auction price and honest editable specifications',()=>{
 const lot=ajesLot({...row,PW:'52,64',IMAGES:row.IMAGES+'#https://7.tru.ru/imgs/carABC'},'stats',true)!;
 const offer=ajesOffer(lot,{currency:'JPY',cbrRate:53,nominal:100,effectiveRate:.53,rateDate:'2026-10-15',rateSource:'cbr',sourcePrice:935000,sourcePriceRub:495550},'2026-10-15T10:00:00Z');
 assert.equal(isSellerPricedOffer(offer),true);assert.equal(offer.totalRub,null);assert.equal(offer.sellerPriceRub,495550);
 for(const key of ['powerHp','fuel','drive','transmission'])assert.equal((offer as any)[key],undefined);
 assert.equal(publicationWithdrawn(offer),false);assert.equal(ajesOfferId(offer.id),true);
 assert.equal(publicationWithdrawn({...offer,sourceId:'jptrade_japan_stat'}),true);
 assert.equal(publicationWithdrawn({...offer,id:'japan-old'}),true);
 assert.equal(publicationWithdrawn({...offer,id:'green-123'}),false);
 assert.deepEqual(catalogAuctionSheetUrls(offer),['https://7.tru.ru/imgs/testABC']);
 assert.equal(rankedCatalogImageUrls(offer)[0],'https://7.tru.ru/imgs/carABC&w=320');
 assert.throws(()=>ajesOffer(lot,{currency:'USD'} as any,'now'));
});
test('encrypted runtime credentials can be read asynchronously without leaking into responses',async()=>{
 const client=createAjesClient({password:async()=> 'private-test-value',assertEnabled:async()=>{},reserve:async()=>{},fetcher:async url=>{assert.equal(new URL(String(url)).searchParams.get('code'),'private-test-value');return new Response(JSON.stringify([row]));}});
 const result=await client.read({},'127.0.0.1');assert.equal(result.items.length,1);assert.ok(!JSON.stringify(result).includes('private-test-value'));
});

import {safePublicPricing} from '../apps/web/lib/catalog/safe-public-pricing';
import {offerParameterDraft} from '../apps/web/lib/catalog/offer-parameter-draft';
import {catalogBodyName} from '../apps/web/lib/catalog/presentation';
const rate={currency:'JPY',cbrRate:53,nominal:100,effectiveRate:.53,rateDate:'2026-10-16',rateSource:'cbr',sourcePrice:935000,sourcePriceRub:495550} as const;
test('supplier entities and confirmed displacement survive the actual detail safety path',()=>{
 const lot=ajesLot({...row,MARKA_NAME:'HONDA',MODEL_NAME:'STEP WAGON',GRADE:'&#65405;&#65411;&#65391;&#65420;&#65439; WAGON SPADA',ENG_V:' 2000 ',FUEL:'P',KPP:'CVT',PRIV:'FF'},'stats',true)!;
 const offer=ajesOffer(lot,rate,new Date().toISOString());
 assert.equal(offer.trim,'ステップ WAGON SPADA');
 const safe=safePublicPricing(offer);
 assert.equal(safe.engineCc,2000);assert.equal(offerParameterDraft(safe).engineCc,'2000');
 assert.equal(safe.fuel,'petrol');assert.equal(safe.transmission,'cvt');assert.equal(safe.drive,'fwd');
 assert.equal(catalogBodyName(undefined,safe),'уточняется');
 assert.equal(safe.totalRub,null);
 const missing=ajesOffer(ajesLot({...row,ENG_V:'2000',FUEL:'',PW:'',PRIV:'FF,FULLTIME4WD'},'stats',true)!,rate,new Date().toISOString());
 assert.equal(safePublicPricing(missing).engineCc,2000);assert.equal(missing.fuel,undefined);assert.equal(missing.powerHp,undefined);assert.equal(missing.drive,undefined);
});
test('persisted search works after restart for another visitor; stale fallback keeps timestamp and source controls',async()=>{
 let saved:any=null,calls=0,enabled=true;
 const deps={password:()=> 'test',assertEnabled:async()=>{if(!enabled)throw Error('disabled');},reserve:async()=>{},readQuery:async()=>saved,saveQuery:async(_sql:string,v:any)=>{saved=structuredClone(v);},fetcher:async()=>{calls++;return new Response(JSON.stringify([row]));}};
 await createAjesClient(deps).read({},'203.0.113.1');
 assert.equal((await createAjesClient(deps).read({},'203.0.113.2')).items.length,1);assert.equal(calls,1);
 saved.observedAt=new Date(Date.now()-3600000).toISOString();const observedAt=saved.observedAt;
 const blocked={...deps,fetcher:async(url:any)=>{assert.equal(new URL(String(url)).searchParams.get('ip'),'203.0.113.2');return new Response('bot2 secret');}};
 const r=await createAjesClient(blocked).read({},'203.0.113.2');assert.equal(r.stale,true);assert.equal(r.observedAt,observedAt);
 enabled=false;await assert.rejects(createAjesClient(blocked).read({},'203.0.113.2'),/disabled/);enabled=true;
 saved.observedAt=new Date(Date.now()-8*86400000).toISOString();await assert.rejects(createAjesClient(blocked).read({},'203.0.113.2'),/visitor_restricted/);
});
test('storage write failure preserves successful response; wrong saved detail cannot satisfy request',async()=>{
 const deps={password:()=> 'test',assertEnabled:async()=>{},reserve:async()=>{},saveQuery:async()=>{throw Error('storage');},fetcher:async()=>new Response(JSON.stringify([row]))};
 assert.equal((await createAjesClient(deps).read({},'127.0.0.1')).items.length,1);
 const wrong={items:[{id:'wrong',table:'stats'}],page:1,pageSize:1,observedAt:new Date().toISOString()};
 const client=createAjesClient({...deps,readDetail:async()=>wrong,fetcher:async()=>new Response('bot2 secret')});
 await assert.rejects(client.read({id:'test123'},'127.0.0.1'),/visitor_restricted/);
});
