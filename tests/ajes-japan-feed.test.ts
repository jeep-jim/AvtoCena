import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {ajesQuery,ajesLot,ajesImageUrl} from '../apps/web/lib/catalog/ajes-query';
import {createAjesClient,readAjesModelDirectory} from '../apps/web/lib/catalog/ajes-client';
import {reserveAjesRequest} from '../apps/web/lib/catalog/ajes-quota';
import {StorageConflictError,type JsonStorage} from '../apps/web/lib/data';
import {defaultCollectionControls,collectionEnabled} from '../apps/web/lib/catalog/collection-controls-schema';
import {validateCollectionControls} from '../apps/web/lib/catalog/collection-controls';
import {catalogHeavyVehicleExcluded} from '../apps/web/lib/catalog/inventory-admission';
import {heavyVehicleSqlExclusion} from '../apps/web/lib/catalog/heavy-vehicle-families';
const row={ID:'test123',MARKA_NAME:'TOYOTA',MODEL_NAME:'TEST',YEAR:'2023',AUCTION_TYPE:'2',STATUS:'Sold',FINISH:'935000',START:'100000',PW:'49',PRIV:'FF,FULLTIME4WD',IMAGES:'https://7.tru.ru/imgs/testABC&h=50'};

test('actual supplier TAG aggregates are positional and strictly numeric',async()=>{
 const read=async(body:unknown,aggregate:'count'|'models')=>createAjesClient({password:()=> 'secret',assertEnabled:async()=>{},reserve:async()=>{},fetcher:async()=>new Response(JSON.stringify(body))}).read({aggregate},'127.0.0.1');
 assert.equal((await read([{TAG0:'123456'}],'count')).total,123456);
 assert.deepEqual((await read([{MARKA_NAME:'TOYOTA',MODEL_NAME:'PRIUS',TAG2:'42'}],'models')).models,[{make:'TOYOTA',model:'PRIUS',total:42}]);
 for(const body of [[{TAG2:42}],[{TAG0:'oops'}],[{TAG0:-1}],[{TAG0:1.5}]])await assert.rejects(()=>read(body,'count'),/invalid_response/);
});
test('model directory reads beyond the supplier 500-row cap and detects repeated pages',async()=>{
 const queries:string[]=[];
 const first=Array.from({length:500},(_,i)=>({MARKA_NAME:'TOYOTA',MODEL_NAME:'MODEL '+i,TAG2:'1'}));
 const client=createAjesClient({password:()=> 'secret',assertEnabled:async()=>{},reserve:async()=>{},fetcher:async url=>{
  const sql=new URL(String(url)).searchParams.get('sql')!;queries.push(sql);
  return new Response(JSON.stringify(sql.endsWith('limit 0,500')?first:[{MARKA_NAME:'TOYOTA',MODEL_NAME:'MODEL 500',TAG2:'2'}]));
 }});
 const result=await readAjesModelDirectory(client,{},'127.0.0.1');
 assert.equal(result.models.length,501);assert.equal(queries.length,2);assert.ok(queries[1].endsWith('limit 500,500'));
 const broken=createAjesClient({password:()=> 'secret',assertEnabled:async()=>{},reserve:async()=>{},fetcher:async()=>new Response(JSON.stringify(first))});
 await assert.rejects(()=>readAjesModelDirectory(broken,{},'127.0.0.1'),/directory_page_repeated/);
});

test('confirmed heavy families are excluded without fabricating a listing mass',()=>{
 for(const [make,model] of [['HINO','RANGER'],['HINO','SEREGA'],['HINO','SELEGA HYBRID'],['ISUZU','GIGA'],['ISUZU','FORWARD'],['ISUZU','ERGA'],['MITSUBISHI','ROSA'],['FUSO','FIGHTER'],['UD TRUCKS','QUON'],['NISSAN DIESEL','CONDOR']]){
  const offer={make,model};
  assert.equal(catalogHeavyVehicleExcluded(offer),true);
  for(const detail of [false,true])assert.equal(ajesLot({...row,MARKA_NAME:make,MODEL_NAME:model},'stats',detail),null);
 }
 // Same model word from another make, passenger cars, kei and mixed-weight trucks survive.
 for(const [make,model] of [['FORD','RANGER'],['LAND ROVER','RANGE ROVER'],['TOYOTA','HIACE'],['SUZUKI','CARRY'],['HINO','DUTRO'],['ISUZU','ELF'],['ISUZU','GALAXY']]){
  assert.equal(catalogHeavyVehicleExcluded({make,model}),false);
  assert.ok(ajesLot({...row,MARKA_NAME:make,MODEL_NAME:model},'stats',false));
 }
 assert.equal(catalogHeavyVehicleExcluded({make:'ISUZU',model:'ELF',grossVehicleWeightKg:3500}),false);
 assert.equal(catalogHeavyVehicleExcluded({make:'ISUZU',model:'ELF',grossVehicleWeightKg:3501}),true);
});
test('lists, counts and model directories apply identical heavy-family SQL before pagination',()=>{
 for(const aggregate of [undefined,'count','models'] as const){
  const query=ajesQuery({aggregate});
  assert.ok(query.sql.includes(heavyVehicleSqlExclusion()));
 }
});

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


test('count and model directory use the same bounded selection as pages; no raw SQL input',()=>{
 const filter={make:'HONDA,TOYOTA',model:'N BOX|FIT',chassis:'JF2',lotNumber:'001234',yearFrom:2012,fuel:'petrol',drive:'awd',auctionGrade:'4|4.5'};
 const page=ajesQuery(filter),count=ajesQuery({...filter,aggregate:'count'}),models=ajesQuery({...filter,aggregate:'models'});
 const where=page.sql.split(' where ')[1].split(' order by ')[0];
 assert.equal(count.sql,'select count(*) from stats where '+where);
 assert.ok(models.sql.includes(where+' group by marka_name, model_name'));
 assert.match(page.sql,/kuzov='JF2'/);assert.match(page.sql,/lot='001234'/);
 assert.match(page.sql,/marka_name in \('HONDA','TOYOTA'\)/);
 assert.match(ajesQuery({sort:'year'}).sql,/order by year desc/);assert.match(ajesQuery({sort:'yearAsc'}).sql,/order by year asc/);
 for(const q of [{aggregate:'sql'},{make:"HONDA,TOYOTA'"},{fuel:"P'"},{chassis:"JF2'"},{sort:'year;drop'},{auctionGrade:"4')"}])assert.throws(()=>ajesQuery(q));
});
test('aggregate totals are independent of page length, survive restart and never turn a refusal into zero',async()=>{
 let saved:any=null,calls=0;
 const deps={password:()=> 'test',assertEnabled:async()=>{},reserve:async()=>{},readQuery:async()=>saved,saveQuery:async(_s:string,v:any)=>{saved=structuredClone(v);},fetcher:async()=>{calls++;return new Response(JSON.stringify([{total:'123456'}]));}};
 const result=await createAjesClient(deps).read({aggregate:'count'},'127.0.0.1');assert.equal(result.total,123456);assert.equal(result.items.length,0);
 assert.equal((await createAjesClient(deps).read({aggregate:'count'},'203.0.113.1')).total,123456);assert.equal(calls,1);
 saved.observedAt=new Date(Date.now()-3600000).toISOString();
 const stale=await createAjesClient({...deps,fetcher:async()=>new Response('bot2 secret')}).read({aggregate:'count'},'203.0.113.1');assert.equal(stale.total,123456);assert.equal(stale.stale,true);
 saved=null;await assert.rejects(createAjesClient({...deps,fetcher:async()=>new Response('bot2 secret')}).read({aggregate:'count'},'203.0.113.1'),/visitor_restricted/);
 for(const total of [-1,'bad',null,1.5])await assert.rejects(createAjesClient({...deps,fetcher:async()=>new Response(JSON.stringify([{total}]))}).read({aggregate:'count'},'127.0.0.1'),/invalid_response/);
});
test('directory preserves provider model spelling and count, not arbitrary raw rows',async()=>{
 const client=createAjesClient({password:()=> 'test',assertEnabled:async()=>{},reserve:async()=>{},fetcher:async()=>new Response(JSON.stringify([{MARKA_NAME:'HONDA',MODEL_NAME:'N BOX',total:'123'}]))});
 const result=await client.read({aggregate:'models'},'127.0.0.1');assert.deepEqual(result.models,[{make:'HONDA',model:'N BOX',total:123}]);
});
test('numeric supplier fields are preserved in full-detail evidence without password',async()=>{
 let evidence:any;
 const client=createAjesClient({password:()=> 'secret-not-in-evidence',assertEnabled:async()=>{},reserve:async()=>{},saveEvidence:async(_t,v)=>{evidence=v;},fetcher:async()=>new Response(JSON.stringify([{...row,ENG_V:660,PW:64,FUEL:'P',INFO:'PS PW'}]))});
 const r=await client.read({id:row.ID},'127.0.0.1');assert.equal(r.items[0].sourcePower,'64');assert.equal(evidence.values.PW,64);assert.ok(!JSON.stringify(evidence).includes('secret-not-in-evidence'));
});


test('shared Japan query keeps chassis and leading-zero lot through a page request',async()=>{
 const {ajesCatalogQuery,AjesFilterUnavailable}=await import('../apps/web/lib/catalog/ajes-query');
 const input={market:'japan',chassis:'JF2',lotNumber:'001234',page:'2',engineFrom:'0.66',make:'HONDA',marketPage:'1'};
 const q=ajesCatalogQuery(input);
 assert.equal(q.chassis,'JF2');assert.equal(q.lotNumber,'001234');assert.equal(q.page,2);assert.equal(q.engineFrom,660);
 const sql=ajesQuery(q).sql;assert.ok(sql.includes("kuzov='JF2'"));assert.ok(sql.includes("lot='001234'"));assert.ok(sql.endsWith('limit 24,24'));
 assert.throws(()=>ajesCatalogQuery({...input,budget:'2000000'}),AjesFilterUnavailable);
});


test('supplier count expression is case-insensitive and never chosen from unrelated numeric fields',async()=>{
 for(const key of ['COUNT(*)','count(*)','TOTAL','total']){
 const client=createAjesClient({password:()=> 'test',assertEnabled:async()=>{},reserve:async()=>{},fetcher:async()=>new Response(JSON.stringify([{[key]:'24681'}]))});
 assert.equal((await client.read({aggregate:'count'},'1.2.3.4')).total,24681);
 }
 const bad=createAjesClient({password:()=> 'test',assertEnabled:async()=>{},reserve:async()=>{},fetcher:async()=>new Response(JSON.stringify([{YEAR:2026}]))});
 await assert.rejects(()=>bad.read({aggregate:'count'},'1.2.3.4'));
});


test('verified sold AJES results remain eligible for related cars without reviving withdrawn sources',async()=>{
 const {isRenderableRelatedOffer}=await import('../apps/web/lib/catalog/related-offer-selection');
 const {ajesOffer}=await import('../apps/web/lib/catalog/ajes-offer');
 const lot=ajesLot({ID:'related123',MARKA_NAME:'NISSAN',MODEL_NAME:'X-TRAIL',YEAR:'2016',STATUS:'Sold',FINISH:'465000',ENG_V:'2000',IMAGES:'https://7.ajes.com/img/related123'},'stats',false)!;
 const offer=ajesOffer(lot,{currency:'JPY',sourcePrice:465000,effectiveRate:0.5,rateSource:'cbr',fetchedAt:new Date().toISOString()} as any,new Date().toISOString());
 assert.equal(Boolean(isRenderableRelatedOffer(offer)),true);
 assert.equal(Boolean(isRenderableRelatedOffer({...offer,operational:{}})),false);
 assert.equal(Boolean(isRenderableRelatedOffer({...offer,year:2009})),false);
 assert.equal(Boolean(isRenderableRelatedOffer({...offer,sourceId:'pro_auctions'})),false);
});


test('Japan price buttons sort the displayed auction price without pretending it is a delivered quote',()=>{
 assert.match(ajesQuery({sort:'totalRub'}).sql,/order by finish asc/);
 assert.match(ajesQuery({sort:'totalRubDesc'}).sql,/order by finish desc/);
});

test('supplier TIME fuel reaches the card and calculator; ambiguous values stay unknown',()=>{
 for(const [code,fuel] of [['P','petrol'],['D','diesel'],['E','electric'],['H','hybrid'],['HE','hybrid'],['L','lpg'],['C','cng']]){
  const lot=ajesLot({...row,TIME:code,FUEL:'P',ENG_V:'2180'},'stats',true)!;
  const offer=ajesOffer(lot,rate,new Date().toISOString());
  const safe=safePublicPricing(offer);
  assert.equal(safe.fuel,fuel);assert.equal(offerParameterDraft(safe).fuel,fuel);
  assert.equal(offer.operational?.semanticEvidence?.fuel?.source,`ajes:stats:${row.ID}:TIME`);
  assert.equal(offer.powerHp,undefined);assert.equal(offer.totalRub,null);
 }
 for(const TIME of ['P,D','unknown','12:30']){
  const offer=ajesOffer(ajesLot({...row,TIME},'stats',true)!,rate,new Date().toISOString());
  assert.equal(offer.fuel,undefined);assert.equal(offer.operational?.semanticEvidence?.fuel,undefined);
 }
 for(const aggregate of [undefined,'count','models']){
  const sql=ajesQuery({fuel:'diesel',aggregate}).sql;
  assert.ok(sql.includes("time in ('D')"));assert.ok(!sql.includes('fuel in'));
 }
});

test('old normalized cache refreshes TIME on demand and remains available on supplier refusal',async()=>{
 for(const detail of [false,true]){
  const input=detail?{id:row.ID}:{};
  let saved:any={items:[ajesLot(row,'stats',detail)],page:1,pageSize:detail?1:24,observedAt:new Date().toISOString()},calls=0;
  const deps={password:()=> 'test',assertEnabled:async()=>{},reserve:async()=>{},readDetail:async()=>saved,readQuery:async()=>saved,saveDetail:async(_t:any,_id:any,v:any)=>{saved=v;},saveQuery:async(_sql:string,v:any)=>{saved=v;},fetcher:async()=>{calls++;return new Response(JSON.stringify([{...row,TIME:'D'}]));}};
  const old=structuredClone(saved);
  const fresh=await createAjesClient(deps).read(input,'127.0.0.1');
  assert.equal(fresh.items[0].sourceFuel,'D');assert.equal(saved.schemaVersion,2);assert.equal(calls,1);
  await createAjesClient(deps).read(input,'127.0.0.1');assert.equal(calls,1);
  saved=old;
  const fallback=await createAjesClient({...deps,fetcher:async()=>new Response('bot2 secret')}).read(input,'127.0.0.1');
  assert.equal(fallback.stale,true);assert.equal(fallback.items[0].sourceFuel,'');
 }
});

import {mock} from 'node:test';
import {LocalJsonStorage} from '../apps/web/lib/data';
import {resetCatalogRateCache} from '../apps/web/lib/catalog/rates';
import {calculateOfferWithCustomerParametersDetailed} from '../apps/web/lib/catalog/customs-pricing';
import {validateCustomerParameters} from '../apps/web/lib/catalog/customer-parameters';
import {ajesPowerEstimateHp} from '../apps/web/lib/catalog/ajes-power-estimate';
import {offerSpecificationGroups} from '../apps/web/lib/catalog/offer-specification-groups';

test('AJES detail retains chassis identity and source specifications; first PW only seeds editable estimate',()=>{
 const lot=ajesLot({...row,TIME:'P',PW:'79,98',ENG_V:'1500',KUZOV:'TEST10',SERIAL:'TEST10-1234567',COLOR:'WHITE',EQUIP:'AC',KPP:'FA'},'stats',true)!;
 const offer=ajesOffer(lot,rate,new Date().toISOString());
 const publicRaw={...offer,operational:undefined} as any;
 const draft=offerParameterDraft(offer,publicRaw);
 assert.equal(draft.powerHp,'79');assert.equal(offer.powerHp,undefined);
 assert.equal(draft.power30MinKw,'');assert.equal(offer.totalRub,null);
 const groups=offerSpecificationGroups(offer);
 assert.ok(groups.some(g=>g.items.some(i=>i.name==='Код кузова'&&i.value==='TEST10')));
 assert.ok(groups.some(g=>g.items.some(i=>i.name==='Номер кузова'&&i.value==='TEST10-1234567')));
 assert.ok(groups.some(g=>g.items.some(i=>i.value==='79,98')));
 assert.equal(offer.color,'WHITE');
 assert.equal(ajesLot({...row,SERIAL:'TEST10-1234567'},'stats',false)?.frameNumber,undefined);
 assert.equal(ajesPowerEstimateHp({...offer,sourceId:'encar'}),undefined);
 for(const PW of ['', 'bad79', '0,98','79,bad','2501,98'])assert.equal(ajesPowerEstimateHp(ajesOffer(ajesLot({...row,PW},'stats',true)!,rate,new Date().toISOString())),undefined);
 const electric=ajesOffer(ajesLot({...row,TIME:'E',PW:'150,200'},'stats',true)!,rate,new Date().toISOString());
 const electricDraft=offerParameterDraft(electric);
 assert.equal(electricDraft.powerHp,'150');assert.equal(electricDraft.power30MinKw,'');
 assert.throws(()=>validateCustomerParameters(electricDraft));
});

test('Japan first-PW draft computes a delivered estimate through the real customer calculator',async()=>{
 const offer=ajesOffer(ajesLot({...row,YEAR:'2018',TIME:'P',PW:'79,98',ENG_V:'1500'},'stats',true)!,rate,new Date().toISOString());
 const draft={...offerParameterDraft(offer),deliveryCity:'Новокузнецк'};
 const today=new Date().toISOString(),original=LocalJsonStorage.prototype.readJsonWithMeta;
 const patch=mock.method(LocalJsonStorage.prototype,'readJsonWithMeta',async function(this:LocalJsonStorage,key:string,fallback:any){
  if(key==='fees/exchange-rates.json')return {found:true,value:{updatedAt:today,EUR:{cbrRate:95,nominal:1,rateDate:today},JPY:{cbrRate:53,nominal:100,rateDate:today},USD:{cbrRate:90,nominal:1,rateDate:today}}};
  return original.call(this,key,fallback);
 });
 resetCatalogRateCache();
 try{
  const result=await calculateOfferWithCustomerParametersDetailed(offer,validateCustomerParameters(draft));
  assert.equal(result.ok,true,JSON.stringify(result));
  if(result.ok){assert.ok(result.calculation.totalRub>offer.sellerPriceRub!);assert.ok(result.calculation.breakdown.length>1);}
 }finally{patch.mock.restore();resetCatalogRateCache();}
});


test('exact detail retains its own original specifications after another lot overwrites the last snapshot',async()=>{
 const saved=new Map<string,any>();let last:any;
 const client=createAjesClient({password:()=> 'never-store-this-password',assertEnabled:async()=>{},reserve:async()=>{},saveDetail:async(_t,id,v)=>{saved.set(id,structuredClone(v));},saveEvidence:async(_t,v)=>{last=v;},fetcher:async input=>{
  const id=new URL(String(input)).searchParams.get('sql')!.includes("'second'")?'second':row.ID;
  return new Response(JSON.stringify([{...row,ID:id,TIME:id==='second'?'P':'',PW:id==='second'?'91':'',SERIAL:'private-frame',INFO:'private-info'}]));
 }});
 await client.read({table:'stats',id:row.ID},'127.0.0.1');await client.read({table:'stats',id:'second'},'127.0.0.1');
 assert.equal(last.id,'second');
 const evidence=saved.get(row.ID).sourceEvidence;
 assert.equal(evidence.id,row.ID);assert.equal(evidence.values.TIME,'');assert.equal(evidence.values.PW,'');assert.ok(evidence.fields.includes('TIME'));assert.ok(!evidence.fields.includes('FUEL'));
 for(const secret of ['never-store-this-password','127.0.0.1','private-frame','private-info'])assert.ok(!JSON.stringify(evidence).includes(secret));
 assert.equal(saved.get('second').sourceEvidence.values.PW,'91');
});

test('list diagnostics preserve exact empty and numeric source parameters per accepted id',async()=>{
 let saved:any;
 const client=createAjesClient({password:()=> 'secret',assertEnabled:async()=>{},reserve:async()=>{},saveQuery:async(_s,v)=>{saved=v;},fetcher:async()=>new Response(JSON.stringify([{...row,TIME:'',PW:''},{...row,ID:'other',TIME:'D',PW:200}]))});
 await client.read({table:'stats'},'127.0.0.1');
 assert.equal(saved.sourceEvidenceById[row.ID].values.TIME,'');assert.equal(saved.sourceEvidenceById.other.values.PW,200);
});


test('a refused visitor cannot pin missing parameters for a different allowed visitor',async()=>{
 const old={schemaVersion:2,items:[ajesLot({...row,TIME:'',PW:''},'stats',true)],page:1,pageSize:1,observedAt:new Date(Date.now()-3600000).toISOString()};
 let saved:any=old,calls=0;
 const client=createAjesClient({password:()=> 'test',assertEnabled:async()=>{},reserve:async()=>{},readDetail:async()=>saved,saveDetail:async(_t,_id,v)=>{saved=v;},fetcher:async input=>{
  calls++;const ip=new URL(String(input)).searchParams.get('ip');
  return ip==='203.0.113.1'?new Response('bot2 test'):new Response(JSON.stringify([{...row,TIME:'D',PW:'200'}]));
 }});
 const refused=await client.read({table:'stats',id:row.ID},'203.0.113.1');assert.equal(refused.stale,true);assert.equal(refused.items[0].sourceFuel,'');
 await client.read({table:'stats',id:row.ID},'203.0.113.1');assert.equal(calls,1,'same refused visitor is bounded by its private cache');
 const allowed=await client.read({table:'stats',id:row.ID},'203.0.113.2');assert.equal(calls,2);assert.equal(allowed.stale,false);assert.equal(allowed.items[0].sourceFuel,'D');assert.equal(allowed.items[0].sourcePower,'200');
 const shared=await client.read({table:'stats',id:row.ID},'203.0.113.1');assert.equal(shared.stale,false);assert.equal(shared.items[0].sourceFuel,'D');assert.equal(calls,2,'fresh successful content is shared without extra source requests');
});

test('simultaneous requests from different visitors do not share a supplier refusal',async()=>{
 let release!:()=>void;const wait=new Promise<void>(resolve=>{release=resolve;});let calls=0;
 const old={schemaVersion:2,items:[ajesLot({...row,TIME:'',PW:''},'stats',true)],page:1,pageSize:1,observedAt:new Date(Date.now()-3600000).toISOString()};
 const client=createAjesClient({password:()=> 'test',assertEnabled:async()=>{},reserve:async()=>{},readDetail:async()=>old,fetcher:async input=>{
  calls++;const ip=new URL(String(input)).searchParams.get('ip');
  if(ip==='203.0.113.1'){await wait;return new Response('bot2 test');}
  release();return new Response(JSON.stringify([{...row,TIME:'D',PW:'200'}]));
 }});
 const result=await Promise.all([client.read({table:'stats',id:row.ID},'203.0.113.1'),client.read({table:'stats',id:row.ID},'203.0.113.2')]);
 assert.equal(calls,2);assert.equal(result[0].stale,true);assert.equal(result[1].stale,false);assert.equal(result[1].items[0].sourceFuel,'D');
});
