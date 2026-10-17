import test from 'node:test';
import assert from 'node:assert/strict';
import {createAjesMarketPreview,ajesPreviewMarket,type AjesMarketPreview} from '../apps/web/lib/catalog/ajes-market-preview';
import {defaultCollectionControls,collectionEnabled,collectionWorkflowEnabled} from '../apps/web/lib/catalog/collection-controls-schema';
import {validateCollectionControls} from '../apps/web/lib/catalog/collection-controls';

test('new paid source switches migrate off without changing old China or enabling parser schedules',()=>{
 const old=defaultCollectionControls();delete old.sources.ajes_china_feed;delete old.sources.ajes_korea_feed;
 old.sources.ajes_japan_feed.enabled=true;
 const migrated=validateCollectionControls(old);
 assert.equal(collectionEnabled(migrated,'che168_feed'),true);
 assert.equal(collectionEnabled(migrated,'ajes_japan_feed'),true);
 for(const market of ['china','korea'])assert.equal(collectionEnabled(migrated,`ajes_${market}_feed`),false);
 migrated.sources.che168_feed.enabled=false;migrated.sources.ajes_china_feed.enabled=true;
 assert.equal(collectionWorkflowEnabled(migrated,'china'),false);
 migrated.markets.china.enabled=false;assert.equal(collectionEnabled(migrated,'ajes_china_feed'),false);
 delete migrated.sources.che168_feed;assert.throws(()=>validateCollectionControls(migrated));
});

test('preview uses fixed table and real caller address, strips unrelated fields, caches only safe rows',async()=>{
 let saved:AjesMarketPreview|null=null,calls=0,reservations=0,enabled=true;
 const preview=createAjesMarketPreview({password:async()=> 'fixture-secret',assertEnabled:async()=>{if(!enabled)throw Error('disabled');},reserve:async market=>{assert.equal(market,'china');reservations++;},read:async()=>saved,save:async(_m,v)=>{saved=v;},fetcher:async input=>{
  calls++;const url=new URL(String(input));assert.equal(url.searchParams.get('ip'),'127.0.0.1');assert.equal(url.searchParams.get('sql'),'select * from china limit 5');
  return new Response(JSON.stringify([{ID:'sample',YEAR:'2024',PRICE:'123',SELLER_PHONE:'must-not-retain',IMAGES:'https://example.com/private?token=secret'}]));
 }});
 const result=await preview('china','127.0.0.1');assert.equal(result.received,1);assert.equal(result.rows[0].PRICE,'123');assert.equal('SELLER_PHONE' in result.rows[0],false);assert.equal('IMAGES' in result.rows[0],false);
 assert.equal(JSON.stringify(saved).includes('must-not-retain'),false);
 await preview('china','127.0.0.1');assert.equal(calls,1);assert.equal(reservations,1);
 enabled=false;await assert.rejects(preview('china','127.0.0.1'),/disabled/);
 assert.throws(()=>ajesPreviewMarket('china;drop'));
 await assert.rejects(preview('china',''),/client_ip_missing/);
});

test('quota failure never calls supplier and source refusal stops both preview markets without exposing password',async()=>{
 let calls=0;
 const deps={password:async()=> 'fixture-secret',assertEnabled:async()=>{},reserve:async()=>{},read:async()=>null,save:async()=>{},fetcher:async()=>{calls++;return new Response('bot2 fixture-secret');}};
 const exhausted=createAjesMarketPreview({...deps,reserve:async()=>{throw Error('quota_exhausted');}});
 await assert.rejects(exhausted('china','127.0.0.1'),/^Error: quota_exhausted$/);assert.equal(calls,0);
 const rejected=createAjesMarketPreview(deps);
 await assert.rejects(rejected('china','127.0.0.1'),/^Error: visitor_restricted$/);
 await assert.rejects(rejected('korea','127.0.0.1'),/^Error: preview_cooldown$/);assert.equal(calls,1);
});
