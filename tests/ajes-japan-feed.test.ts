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
 for(const [make,model] of [['ISUZU','ELF'],['ISUZU','ELF Key'],['MITSUBISHI','CANTER'],['HINO','DUTRO'],['HINO','RANGER'],['HINO','SEREGA'],['HINO','SELEGA HYBRID'],['ISUZU','GIGA'],['ISUZU','FORWARD'],['ISUZU','ERGA'],['MITSUBISHI','ROSA'],['FUSO','FIGHTER'],['UD TRUCKS','QUON'],['NISSAN DIESEL','CONDOR']]){
  const offer={make,model};
  assert.equal(catalogHeavyVehicleExcluded(offer),true);
  for(const detail of [false,true])assert.equal(ajesLot({...row,MARKA_NAME:make,MODEL_NAME:model},'stats',detail),null);
 }
 // Same model word from another make, passenger cars, kei passenger models and pickups survive.
 for(const [make,model] of [['FORD','RANGER'],['LAND ROVER','RANGE ROVER'],['TOYOTA','HIACE'],['SUZUKI','CARRY'],['ISUZU','GALAXY']]){
  assert.equal(catalogHeavyVehicleExcluded({make,model}),false);
  assert.ok(ajesLot({...row,MARKA_NAME:make,MODEL_NAME:model},'stats',false));
 }
 assert.equal(catalogHeavyVehicleExcluded({make:'ISUZU',model:'ELF',grossVehicleWeightKg:3500}),true);
 assert.equal(catalogHeavyVehicleExcluded({make:'ISUZU',model:'ELF',grossVehicleWeightKg:3501}),true);
});
test('lists, counts and model directories apply identical heavy-family SQL before pagination',()=>{
 for(const aggregate of [undefined,'count','models'] as const){
  const query=ajesQuery({aggregate});
  assert.ok(query.sql.includes(heavyVehicleSqlExclusion()));
 }
});

test('query grammar rejects SQL/unknown fields and bounds pages, ages and table',()=>{
  for(const input of [{sql:'select * from stats'},{table:'stats;drop'},{id:"x' or 1=1"},{make:"TOYOTA'"},{model:'x\\y'},{page:-1},{pageSize:10000},{yearFrom:1899},{yearFrom:2025,yearTo:2020},{id:'ok',make:'TOYOTA'},{budgetTo:2000000}])assert.throws(()=>ajesQuery(input));
  const q=ajesQuery({make:'Toyota',model:'C-HR',page:2,pageSize:24});
  assert.match(q.sql,/status='Sold' and finish>0/);assert.match(q.sql,/auction_type!=1/);assert.match(q.sql,/limit 24,24$/);assert.match(q.sql,/marka_name='TOYOTA'/);
  assert.equal(ajesQuery({id:'abc',table:'stats'}).sql,"select * from stats where id='abc'");
  const extended=ajesQuery({lotNumber:'001234',chassis:'LA250S',engineFrom:600,engineTo:1500,mileageFrom:0,mileageTo:50000});
  assert.match(extended.sql,/lot='001234'/);assert.match(extended.sql,/kuzov='LA250S'/);assert.match(extended.sql,/eng_v>=600 and eng_v<=1500/);
  for(const q of [{lotNumber:"1'"},{lotNumber:123},{engineFrom:2000,engineTo:1000},{mileageFrom:100,mileageTo:0}])assert.throws(()=>ajesQuery(q));
});
test('sold price is FINISH only; USS, old, unsold and missing prices never become offers',()=>{
  for(const change of [{AUCTION_TYPE:'1'},{YEAR:'2007'},{STATUS:'Not sold'},{FINISH:'0',AVG_PRICE:'1000000'},{FINISH:'garbage'},{ID:"x'"}])assert.equal(ajesLot({...row,...change},'stats',false),null);
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
    const client=createAjesClient({password:()=> 'test',assertEnabled:async()=>{},reserve:async()=>{},fetcher:async(url)=>{assert.equal(new URL(String(url)).pathname,'/api/');return new Response(body);}});
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
test('usage accounting retains concurrent attempts and independent tables without a local daily cutoff',async()=>{
 const s=storage(),now=Date.now(),hour=Math.floor(now/3600000);
 await s.writeJson('catalog/operations/ajes-quota-stats.json',{buckets:{[hour]:19020}},{ifNoneMatch:'*'});
 await Promise.all(Array.from({length:5},()=>reserveAjesRequest(s,'stats',now)));
 assert.equal((await s.readJsonWithMeta<any>('catalog/operations/ajes-quota-stats.json',null)).value.buckets[hour],19025);
 for(const table of ['china','korea'] as const){await reserveAjesRequest(s,table,now);assert.equal((await s.readJsonWithMeta<any>(`catalog/operations/ajes-quota-${table}.json`,null)).value.buckets[hour],1);}
 await reserveAjesRequest(s,'stats',now+25*3600000);
 assert.deepEqual((await s.readJsonWithMeta<any>('catalog/operations/ajes-quota-stats.json',null)).value.buckets,{[hour+25]:1});
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
 assert.deepEqual(ajesCatalogQuery({...input,budget:'2000000'}),q);
 assert.equal(ajesCatalogQuery({...input,powerTo:'160'}).powerTo,160);
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
 assert.equal(Boolean(isRenderableRelatedOffer({...offer,year:2007})),false);
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

test('Coaster bus is excluded in pages, counts, and cached offer admission',()=>{
 for(const model of ['COASTER','COASTER LX','COASTER-BIG VAN']){
  assert.equal(ajesLot({...row,MODEL_NAME:model},'stats',false),null);
  assert.equal(catalogHeavyVehicleExcluded({make:'TOYOTA',model}),true);
 }
 for(const aggregate of [undefined,'count','models'] as const)assert.match(ajesQuery({aggregate}).sql,/marka_name='TOYOTA' and \(model_name='COASTER'/);
 assert.ok(!heavyVehicleSqlExclusion(true).includes("model_name='COASTER'"));
 assert.ok(ajesLot({...row,MODEL_NAME:'HIACE'},'stats',false));
});
test('chassis, full frame and leading-zero lot survive catalog parsing and SQL without broad matching',async()=>{
 const {ajesCatalogQuery}=await import('../apps/web/lib/catalog/ajes-query');
 const q=ajesCatalogQuery({market:'japan',chassis:'SKE',frameNumber:'SKE-012345',lotNumber:'030132',page:'2'});
 for(const aggregate of [undefined,'count','models'] as const){
  const sql=ajesQuery({...q,aggregate}).sql;
  assert.ok(sql.includes("kuzov='SKE'"));assert.ok(sql.includes("serial='SKE-012345'"));assert.ok(sql.includes("lot='030132'"));
 }
 for(const frameNumber of ["SKE' OR 1=1",'SKE%', 'SKE_'])assert.throws(()=>ajesQuery({frameNumber}));
});
test('quota exhaustion opens the exact previously listed car without a full-detail fetch',async()=>{
 let calls=0,reserves=0,enabled=true;
 const client=createAjesClient({password:()=> 'test',assertEnabled:async()=>{if(!enabled)throw Error('disabled');},reserve:async()=>{if(++reserves>1)throw new (await import('../apps/web/lib/catalog/ajes-client')).AjesUnavailable('quota_exhausted');},fetcher:async()=>{calls++;return new Response(JSON.stringify([{...row,TIME:'D'}]));}});
 await client.read({},'203.0.113.1');
 const detail=await client.read({id:row.ID},'203.0.113.1');
 assert.equal(detail.items[0].id,row.ID);assert.equal(detail.items[0].sourceFuel,'D');assert.equal(detail.partial,true);assert.equal(detail.stale,true);assert.equal(detail.items[0].images[0].role,'vehicle');assert.equal(calls,1);
 await assert.rejects(()=>client.read({id:'unseen'},'203.0.113.1'),/quota_exhausted/);
 assert.equal(reserves,2,'cooldown must not repeat quota storage reservations');
 enabled=false;await assert.rejects(()=>client.read({id:row.ID},'203.0.113.1'),/disabled/);
});
test('supplier refusal is cooled per real visitor across queries, not across visitors',async()=>{
 let calls=0;
 const client=createAjesClient({password:()=> 'test',assertEnabled:async()=>{},reserve:async()=>{},fetcher:async input=>{calls++;return new URL(String(input)).searchParams.get('ip')==='203.0.113.1'?new Response('bot2 test'):new Response(JSON.stringify([row]));}});
 await assert.rejects(()=>client.read({make:'TOYOTA'},'203.0.113.1'),/visitor_restricted/);
 await assert.rejects(()=>client.read({make:'SUBARU'},'203.0.113.1'),/visitor_restricted/);
 assert.equal(calls,1);
 assert.equal((await client.read({make:'SUBARU'},'203.0.113.2')).items.length,1);assert.equal(calls,2);
});
test('cold detail recovery checks saved list identity and age and never masks identity mismatch',async()=>{
 const {AjesUnavailable}=await import('../apps/web/lib/catalog/ajes-client');
 const saved={items:[ajesLot(row,'stats',false)],page:1,pageSize:1,observedAt:new Date().toISOString()};
 const deps={password:()=> 'test',assertEnabled:async()=>{},reserve:async()=>{throw new AjesUnavailable('quota_exhausted');},readListedDetail:async()=>saved};
 assert.equal((await createAjesClient(deps).read({id:row.ID},'127.0.0.1')).partial,true);
 for(const bad of [{...saved,items:[{...saved.items[0],id:'wrong'}]},{...saved,observedAt:new Date(Date.now()-8*86400000).toISOString()}])await assert.rejects(()=>createAjesClient({...deps,readListedDetail:async()=>bad}).read({id:row.ID},'127.0.0.1'),/quota_exhausted/);
 await assert.rejects(()=>createAjesClient({...deps,reserve:async()=>{},fetcher:async()=>new Response(JSON.stringify([{...row,ID:'wrong'}]))}).read({id:row.ID},'127.0.0.1'),/identity_mismatch/);
});
test('default Japan order uses plain supplier sort columns, explicit price sort is unchanged',()=>{
 assert.match(ajesQuery({}).sql,/order by auction_date desc, id asc/);
 assert.doesNotMatch(ajesQuery({}).sql,/case when/);
 assert.match(ajesQuery({sort:'totalRub'}).sql,/order by finish asc, auction_date desc, id asc/);
});

test('partial card retries after the short cooldown instead of pinning missing fields for thirty minutes',async()=>{
 const {AjesUnavailable}=await import('../apps/web/lib/catalog/ajes-client');
 let now=Date.now(),reserved=0;const clock=mock.method(Date,'now',()=>now);
 const saved={items:[ajesLot({...row,TIME:''},'stats',false)],page:1,pageSize:1,observedAt:new Date(now).toISOString()};
 const client=createAjesClient({password:()=> 'test',assertEnabled:async()=>{},readListedDetail:async()=>saved,reserve:async()=>{if(++reserved===1)throw new AjesUnavailable('quota_exhausted');},fetcher:async()=>new Response(JSON.stringify([{...row,TIME:'D'}]))});
 try{
  assert.equal((await client.read({id:row.ID},'127.0.0.1')).partial,true);
  now+=31000;
  const fresh=await client.read({id:row.ID},'127.0.0.1');
  assert.equal(fresh.stale,false);assert.equal(fresh.items[0].sourceFuel,'D');assert.equal(reserved,2);
 }finally{clock.mock.restore();}
});

test('owner LA350A / 2910 search keeps both exact predicates in lists, counts and pages',async()=>{
 const {ajesCatalogQuery}=await import('../apps/web/lib/catalog/ajes-query');
 const input=ajesCatalogQuery({market:'japan',chassis:' la350a ',lotNumber:' 002910 ',page:'2'});
 for(const aggregate of [undefined,'count','models'] as const){
  const sql=ajesQuery({...input,aggregate}).sql;
  assert.match(sql,/kuzov='LA350A' and lot='002910'/);
  assert.doesNotMatch(sql,/(?:kuzov|lot) like/i);
 }
 assert.match(ajesQuery(input).sql,/limit 24,24$/);
});
test('list hash collisions cannot evict saved counts; legacy counts require identical query',async()=>{
 const {ajesQueryCacheLocation,readAjesQueryCache,saveAjesQueryCache}=await import('../apps/web/lib/catalog/ajes-query-cache');
 const files=new Map<string,any>();
 const storage={readJson:async(key:string)=>files.get(key)||null,writeJson:async(key:string,value:any)=>{files.set(key,value);}};
 const count=ajesQuery({aggregate:'count'}).sql,where=ajesQueryCacheLocation(count);
 const snapshot={total:578,items:[],observedAt:new Date().toISOString()};
 // Existing exact-SQL counts migrate on read without accepting old selection rules.
 files.set(where.legacy,{hash:where.hash,value:snapshot});
 assert.deepEqual(await readAjesQueryCache(storage,count),snapshot);
 await saveAjesQueryCache(storage,count,snapshot);
 const collision=Array.from({length:2000},(_,i)=>ajesQuery({lotNumber:String(i)}).sql).find(sql=>ajesQueryCacheLocation(sql).legacy===where.legacy)!;
 assert.ok(collision);
 await saveAjesQueryCache(storage,collision,{items:[]});
 assert.deepEqual(await readAjesQueryCache(storage,count),snapshot);
 assert.equal(await readAjesQueryCache(storage,count+" and kuzov='OTHER'"),null);
 assert.notEqual(ajesQueryCacheLocation(ajesQuery({aggregate:'count',chassis:'LA350A'}).sql).key,where.key);
});

test('exact saved identity search never substitutes unrelated, old or heavy lots or claims completeness',async()=>{
 const {findSavedAjesSearch}=await import('../apps/web/lib/catalog/ajes-saved-search');
 const lot=ajesLot({...row,KUZOV:'LA350A',LOT:'2910'},'stats',false)!;
 const saved={items:[lot],observedAt:new Date().toISOString()};
 const index={one:saved};
 const query={chassis:'LA350A',lotNumber:'2910'};
 const result=findSavedAjesSearch(query,index)!;
 assert.equal(result.items[0].id,row.ID);assert.equal(result.partial,true);assert.equal(result.stale,true);assert.equal((result as any).total,undefined);
 for(const q of [{chassis:'OTHER',lotNumber:'2910'},{chassis:'LA350A',lotNumber:'02910'},{...query,drive:'awd'},{...query,page:2},{...query,frameNumber:'LA350A-123'},{...query,make:'OTHER'}])assert.equal(findSavedAjesSearch(q,index),null);
 assert.equal(findSavedAjesSearch(query,{one:{...saved,observedAt:'2020-01-01T00:00:00Z'}}),null);
 assert.equal(findSavedAjesSearch(query,{one:{...saved,items:[{...lot,make:'TOYOTA',model:'COASTER'}]}}),null);
 assert.equal(findSavedAjesSearch(query,{one:{...saved,items:[{...lot,year:2007}]}}),null);
});
test('Japan lot and chassis search includes 2008-2019 and applies explicit year bounds to saved matches',async()=>{
 const {findSavedAjesSearch}=await import('../apps/web/lib/catalog/ajes-saved-search');
 const query={make:'DAIHATSU',model:'HIJET VAN',chassis:'S321V',lotNumber:'00123'};
 const observedAt=new Date().toISOString();
 const index=Object.fromEntries([2007,2008,2009,2013,2019,2020].map(year=>[String(year),{observedAt,items:[ajesLot({...row,ID:`year${year}`,MARKA_NAME:'DAIHATSU',MODEL_NAME:'HIJET VAN',YEAR:String(year),KUZOV:'S321V',LOT:'00123'},'stats',false)]}]));
 assert.match(ajesQuery(query).sql,/year>=2008/);
 assert.match(ajesQuery(query).sql,/lot='00123'/);
 assert.deepEqual(findSavedAjesSearch(query,index)!.items.map(l=>l.year).sort(),[2008,2009,2013,2019,2020]);
 assert.deepEqual(findSavedAjesSearch({...query,yearFrom:2008,yearTo:2019},index)!.items.map(l=>l.year).sort(),[2008,2009,2013,2019]);
 assert.deepEqual(findSavedAjesSearch({...query,yearFrom:2013,yearTo:2013},index)!.items.map(l=>l.year),[2013]);
 assert.equal(findSavedAjesSearch({...query,yearFrom:2014,yearTo:2018},index),null);
 assert.equal(findSavedAjesSearch({...query,lotNumber:'123'},index),null);
});
test('quota failure can return saved exact search but never a successful empty answer',async()=>{
 const {findSavedAjesSearch}=await import('../apps/web/lib/catalog/ajes-saved-search');
 const lot=ajesLot({...row,KUZOV:'LA350A',LOT:'2910'},'stats',false)!;
 const client=createAjesClient({password:()=> 'secret',assertEnabled:async()=>{},reserve:async()=>{throw new (await import('../apps/web/lib/catalog/ajes-client')).AjesUnavailable('quota_exhausted');},fetcher:async()=>{throw Error('must not fetch');},readSavedSearch:async q=>findSavedAjesSearch(q,{one:{items:[lot],observedAt:new Date().toISOString()}})});
 const result=await client.read({chassis:'LA350A',lotNumber:'2910'},'127.0.0.1');
 assert.equal(result.items.length,1);assert.equal(result.partial,true);
 await assert.rejects(()=>client.read({chassis:'LA350A',lotNumber:'9999'},'127.0.0.1'),/quota_exhausted/);
});

test('supplier rate refusal still stops a repeated request after local daily cutoff removal',async()=>{
 let calls=0;
 const client=createAjesClient({password:()=> 'test',assertEnabled:async()=>{},reserve:async()=>{},fetcher:async()=>{calls++;return new Response('',{status:429});}});
 await assert.rejects(client.read({},'127.0.0.1'),/http_429/);
 await assert.rejects(client.read({},'127.0.0.1'),/http_429/);
 assert.equal(calls,1);
});

test('brand directory is complete independently of a 24-car page and protects its cache',async()=>{
 const {readAjesMakeDirectory}=await import('../apps/web/lib/catalog/ajes-client');
 const {ajesQueryCacheLocation,saveAjesQueryCache,readAjesQueryCache}=await import('../apps/web/lib/catalog/ajes-query-cache');
 let calls=0;
 const client=createAjesClient({password:()=> 'test',assertEnabled:async()=>{},reserve:async()=>{},fetcher:async url=>{calls++;assert.match(new URL(String(url)).searchParams.get('sql')!,/group by marka_name order by marka_name limit 0,500$/);return new Response(JSON.stringify(['TOYOTA','NISSAN','HONDA','DAIHATSU','BMW','SUBARU','SUZUKI'].map(make=>({MARKA_NAME:make,TAG1:'12'}))));}});
 const directory=await readAjesMakeDirectory(client,{},'127.0.0.1');
 assert.equal(directory.makes.length,7);assert.equal(calls,1);assert.equal(directory.makes[6].total,12);
 const files=new Map<string,any>(),store={readJson:async(k:string)=>files.get(k)||null,writeJson:async(k:string,v:any)=>{files.set(k,v);}};
 const sql=ajesQuery({aggregate:'makes'}).sql;
 await saveAjesQueryCache(store,sql,{items:[],makes:directory.makes});
 for(let i=0;i<256;i++)await saveAjesQueryCache(store,ajesQuery({lotNumber:String(i)}).sql,{items:[]});
 assert.equal((await readAjesQueryCache(store,sql)).makes.length,7);
 assert.match(ajesQueryCacheLocation(sql).key,/makes-overall/);
 assert.notEqual(ajesQueryCacheLocation(ajesQuery({aggregate:'makes',yearFrom:2020}).sql).key,ajesQueryCacheLocation(sql).key);
});
test('brand directory rejects missing names and repeated capped pages',async()=>{
 const {readAjesMakeDirectory}=await import('../apps/web/lib/catalog/ajes-client');
 const client=(rows:any[])=>createAjesClient({password:()=> 'test',assertEnabled:async()=>{},reserve:async()=>{},fetcher:async()=>new Response(JSON.stringify(rows))});
 await assert.rejects(readAjesMakeDirectory(client([{TAG1:'3'}]),{},'127.0.0.1'),/invalid_response/);
 await assert.rejects(readAjesMakeDirectory(client(Array.from({length:500},(_,i)=>({MARKA_NAME:'BRAND '+i,TAG1:'1'}))),{},'127.0.0.1'),/directory_page_repeated/);
});
test('failed live model query recovers only the exact saved make and model',async()=>{
 const {findSavedAjesSearch}=await import('../apps/web/lib/catalog/ajes-saved-search');
 const snapshots=Object.fromEntries([['n1','NISSAN','SYLPHY'],['n2','NISSAN','SYLPHY'],['n3','NISSAN','NOTE'],['t1','TOYOTA','SYLPHY']].map(([id,make,model])=>[id,{items:[ajesLot({...row,ID:id,MARKA_NAME:make,MODEL_NAME:model},'stats',false)],observedAt:new Date().toISOString()}]));
 const client=createAjesClient({password:()=> 'test',assertEnabled:async()=>{},reserve:async()=>{throw new (await import('../apps/web/lib/catalog/ajes-client')).AjesUnavailable('quota_exhausted');},readSavedSearch:async q=>findSavedAjesSearch(q,snapshots)});
 const result=await client.read({make:'Nissan',model:'Sylphy',pageSize:24},'127.0.0.1');
 assert.deepEqual(result.items.map((r:any)=>r.id),['n1','n2']);assert.equal(result.partial,true);assert.equal(result.total,undefined);
 assert.equal(findSavedAjesSearch({make:'Nissan',model:'Sylphy',fuel:'petrol'},snapshots),null);
 assert.equal(findSavedAjesSearch({make:'Nissan',model:'Sylphy',page:2},snapshots),null);
});


test('saved brand/model names include all known pages without claiming counts',async()=>{
 const {savedAjesFacets}=await import('../apps/web/lib/catalog/ajes-saved-search');
 const saved=(make:string,model:string)=>({items:[ajesLot({...row,MARKA_NAME:make,MODEL_NAME:model},'stats',false)!],observedAt:new Date().toISOString()});
 const result=savedAjesFacets({one:saved('SUBARU','FORESTER'),two:saved('BMW','X1'),three:saved('BMW','X1'),old:{...saved('AUDI','A4'),observedAt:'2020-01-01T00:00:00Z'},heavy:{...saved('TOYOTA','PRIUS'),items:[{...saved('TOYOTA','PRIUS').items[0],model:'COASTER'}]}});
 assert.deepEqual(result.makes,['BMW','SUBARU']);assert.equal(result.models.length,2);assert.ok(result.models.every(m=>!('total' in m)));
});


test('standalone and whitespace-prefixed provider bot refusals activate visitor cooldown',async()=>{
 for(const body of ['bot2','  bot2\n','bot2 test-secret']){
  let calls=0;
  const client=createAjesClient({password:()=> 'test-secret',assertEnabled:async()=>{},reserve:async()=>{},fetcher:async()=>{calls++;return new Response(body);}});
  await assert.rejects(client.read({},'127.0.0.1'),/visitor_restricted/);
  await assert.rejects(client.read({make:'NISSAN'},'127.0.0.1'),/visitor_restricted/);
  assert.equal(calls,1);
 }
});

test('2008 expansion retains older SQL rows as partial without copying an old total',async()=>{
 const {readExpandedJapanRows}=await import('../apps/web/lib/catalog/ajes-query-cache');
 const current='select * from stats where year>=2008 order by auction_date desc, id asc';
 const previous='select * from stats where year>=2008 order by auction_date desc';
 const old=previous.replace('2008','2010');
 const reads:string[]=[];
 const saved={items:[{id:'known-2012',year:2012}],observedAt:new Date().toISOString()};
 const read=async(sql:string)=>{reads.push(sql);return sql===old?saved:null;};
 const result=await readExpandedJapanRows(current,previous,read);
 assert.deepEqual(result,{...saved,partial:true});
 assert.equal(reads.length,2);
 reads.length=0;
 assert.equal(await readExpandedJapanRows('select count(*) from stats where year>=2008','select count(*) from stats where year>=2008',read),null);
 assert.equal(reads.length,0);
});

test('unfiltered Japan first page recovers bounded saved lots honestly after one refusal',async()=>{
 const {findSavedAjesSearch}=await import('../apps/web/lib/catalog/ajes-saved-search');
 const lot={id:'saved001',table:'stats',make:'TOYOTA',model:'COROLLA',year:2022,status:'Sold',finalPriceJpy:1000000,auctionDate:'2026-10-17'};
 const snapshots={one:{items:[lot],observedAt:new Date().toISOString()}};
 let requests=0;
 const client=createAjesClient({password:()=> 'fixture',assertEnabled:async()=>{},reserve:async()=>{},fetcher:async()=>{requests++;return new Response('ban2 fixture');},readSavedSearch:async q=>findSavedAjesSearch(q,snapshots)});
 const page=await client.read({table:'stats',page:1,pageSize:24},'203.0.113.1');
 assert.equal(requests,1);assert.equal(page.partial,true);assert.equal(page.stale,true);assert.equal(page.total,undefined);assert.equal(page.items[0].id,lot.id);
 assert.equal(findSavedAjesSearch({table:'stats',page:2},snapshots),null);
 assert.equal(findSavedAjesSearch({table:'stats',fuel:'diesel'},snapshots),null);
 assert.equal(findSavedAjesSearch({table:'korea'},snapshots),null);
 assert.equal(findSavedAjesSearch({table:'stats'},{one:{...snapshots.one,observedAt:'2020-01-01'}}),null);
});

test('explicit trucks are excluded across markets, including saved and Dubicars offers, without excluding pickups',()=>{
 for(const market of ['japan','korea','china','europe','uae','georgia']){
  assert.equal(catalogHeavyVehicleExcluded({market,make:'ISUZU',model:'ELF Key'}),true);
  assert.equal(catalogHeavyVehicleExcluded({market,make:'TEST',model:'MODEL',bodyType:'truck',grossVehicleWeightKg:3000}),true);
  assert.equal(catalogHeavyVehicleExcluded({market,make:'FORD',model:'RANGER',bodyType:'pickup',vehicleCategory:'N1'}),false);
  assert.equal(catalogHeavyVehicleExcluded({market,make:'TOYOTA',model:'HIACE',bodyType:'van'}),false);
 }
 assert.equal(catalogHeavyVehicleExcluded({market:'uae',sourceId:'dubicars_feed',make:'ISUZU',model:'ELF'}),true);
});

test('truck policy change retains old viewed rows only as a partial refresh/failure fallback, never an old count',async()=>{
 const {readPreviousTruckPolicyRows}=await import('../apps/web/lib/catalog/ajes-query-cache');
 const query=ajesQuery({table:'stats'}).sql;
 const previous=query.replace(heavyVehicleSqlExclusion(),heavyVehicleSqlExclusion(false,true));
 const saved={schemaVersion:2,items:[{make:'ISUZU',model:'ELF Key'},{make:'TOYOTA',model:'PRIUS'}]};
 const value=await readPreviousTruckPolicyRows(query,async key=>key===previous?saved:null);
 assert.equal(value.schemaVersion,0);assert.equal(value.partial,true);
 assert.deepEqual(value.items.filter((r:any)=>!catalogHeavyVehicleExcluded(r)),[{make:'TOYOTA',model:'PRIUS'}]);
 let calls=0;assert.equal(await readPreviousTruckPolicyRows(ajesQuery({aggregate:'count'}).sql,async()=>{calls++;return saved;}),null);assert.equal(calls,0);
});


test('shared year range intersects each market policy without rejecting older lower bounds',()=>{
 for(const table of ['stats','main','korea','china'] as const){
   const floor=table==='stats'||table==='main'?2008:table==='china'?2014:new Date().getUTCFullYear()-6;
   assert.equal(ajesQuery({table,yearFrom:2007}).sql,ajesQuery({table}).sql);
   assert.match(ajesQuery({table,yearFrom:2007,yearTo:2007}).sql,new RegExp('year>='+floor+' and year<=2007'));
   assert.match(ajesQuery({table,yearFrom:2022,yearTo:2024}).sql,/year>=2022 and year<=2024/);
   assert.throws(()=>ajesQuery({table,yearFrom:2024,yearTo:2022}));
   for(const yearFrom of [1899,2101,2007.5,NaN])assert.throws(()=>ajesQuery({table,yearFrom}));
 }
});


test('disjoint year ranges return exact empty results without provider I/O and retain access checks',async()=>{
 let calls=0,enabled=true;
 const client=createAjesClient({password:()=> 'secret',assertEnabled:async()=>{if(!enabled)throw Error('disabled');},reserve:async()=>{calls++;},fetcher:async()=>{throw Error('unexpected provider call');}});
 for(const table of ['stats','main','korea','china'] as const){
  for(const aggregate of [undefined,'count','makes','models'] as const){
   const result=await client.read({table,yearTo:2007,...(aggregate?{aggregate}:{})},'127.0.0.1');
   assert.deepEqual(result.items,[]);assert.equal(result.total,0);assert.equal(result.stale,false);
  }
 }
 assert.equal(calls,0);
 await assert.rejects(()=>client.read({yearTo:2007},''),/client_ip_missing/);
 enabled=false;await assert.rejects(()=>client.read({yearTo:2007},'127.0.0.1'),/disabled/);
});

test('motorcycles are excluded before supplier pagination and from cached lots',()=>{
 for(const aggregate of [undefined,'count','models','makes'] as const){const query=ajesQuery({make:'YAMAHA',...(aggregate?{aggregate}:{})});assert.match(JSON.stringify(query),/marka_name not in .*YAMAHA/);}
 assert.equal(ajesLot({...row,MARKA_NAME:'YAMAHA',MODEL_NAME:'OTHER',GRADE:'Star -400'},'stats',false),null);
 assert.ok(ajesLot({...row,MARKA_NAME:'HONDA',MODEL_NAME:'FIT'},'stats',false));
});
