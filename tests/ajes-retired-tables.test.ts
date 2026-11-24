import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ajesQuery,ajesLot,ajesCatalogQuery} from '../apps/web/lib/catalog/ajes-query';
import {ajesOffer,ajesOfferId} from '../apps/web/lib/catalog/ajes-offer';
import {createAjesClient} from '../apps/web/lib/catalog/ajes-client';
const row={ID:'fixture001',MARKA_NAME:'TOYOTA',MODEL_NAME:'COROLLA',YEAR:String(new Date().getUTCFullYear()-2),MONTH:'10',STATUS:'Sold',FINISH:'17400000',ENG_V:'1598',PW:'',TIME:'D',MILEAGE:'30000',SERIAL:'TESTFRAME123',IMAGES:'https://7.tru.ru/imgs/fixtureABC#https://7.tru.ru/imgs/fixtureDEF'};

test('retired tables have no query, lot normalization or public offer identity',()=>{
 for(const table of ['china','korea','uae','unknown']){
  for(const extra of [{},{id:'old'},{aggregate:'count'},{aggregate:'models'},{make:'TOYOTA',powerTo:160}])assert.throws(()=>ajesQuery({table,...extra}),/ajes_invalid_query/);
  assert.throws(()=>ajesCatalogQuery({market:table,make:'TOYOTA',frameNumber:'TESTFRAME123'}),/market_not_supported/);
  assert.equal(ajesLot(row,table as any,true),null);
  assert.equal(ajesOfferId('ajes-'+table+'-'+row.ID),false);
  const old={...ajesLot(row,'stats',true)!,table,sourcePrice:17400000};
  assert.throws(()=>ajesOffer(old as any,{currency:'JPY',sourcePrice:17400000,effectiveRate:.5,rateSource:'cbr'} as any,'2026-11-24'),/ajes_invalid_offer/);
 }
 assert.equal(ajesOfferId('ajes-stats-'+row.ID),true);
 for(const table of ['stats','main'] as const){assert.ok(ajesLot(row,table,true));assert.match(ajesQuery({table}).sql,new RegExp('from '+table+' '));}
});

test('Japan switch is checked and supplier refusals stop without alternate routing',async()=>{
 const tables:string[]=[],urls:string[]=[];
 const client=createAjesClient({password:()=> 'fixture',assertEnabled:async t=>{tables.push(t!);},reserve:async()=>{},endpoint:()=> 'http://78.46.90.228/api/',fetcher:async url=>{urls.push(String(url));return new Response('ban2 fixture');}});
 await assert.rejects(()=>client.read({table:'stats'},'203.0.113.1'),/visitor_restricted/);assert.ok(tables.every(t=>t==='stats'));assert.equal(urls.length,1);assert.ok(urls[0].startsWith('http://78.46.90.228/api/'));
});

test('historical Japan compatibility reads occur only after supplier failure, preserving bounded fallback',async()=>{
 const japanRow={...row,MARKA_NAME:'TOYOTA',MODEL_NAME:'COROLLA',AUCTION_TYPE:'2',STATUS:'Sold'};
 let legacyReads=0,requests=0;const lot=ajesLot(japanRow,'stats',false)!;
 const fallback={schemaVersion:0,items:[lot],page:1,pageSize:24,observedAt:new Date().toISOString(),partial:true};
 const deps={password:()=> 'fixture',assertEnabled:async()=>{},reserve:async()=>{},readQuery:async()=>null,
 readLegacyQuery:async()=>{legacyReads++;return fallback;}};
 const healthy=createAjesClient({...deps,fetcher:async()=>{requests++;return Response.json([japanRow]);}});
 const fresh=await healthy.read({table:'stats'},'203.0.113.1');assert.equal(fresh.stale,false);assert.equal(legacyReads,0);assert.equal(requests,1);
 const failed=createAjesClient({...deps,fetcher:async()=>new Response('',{status:503})});
 const retained=await failed.read({table:'stats'},'203.0.113.1');assert.equal(retained.stale,true);assert.equal(retained.partial,true);assert.deepEqual(retained.items,[lot]);assert.equal(legacyReads,1);
 for(const change of [{page:2},{pageSize:48},{observedAt:'2000-01-01'},{items:[{...lot,table:'china'}]}]){
  const invalid=createAjesClient({...deps,readLegacyQuery:async()=>({...fallback,...change}),fetcher:async()=>new Response('',{status:503})});
  await assert.rejects(()=>invalid.read({table:'stats'},'203.0.113.1'),/http_503/);
 }
});
