import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeAutoApiDubicars} from '../apps/web/lib/catalog/auto-api-dubicars';
import {catalogInventoryAgeDecision,catalogHeavyVehicleExcluded} from '../apps/web/lib/catalog/inventory-admission';
import {autoApiChe168Client,collectAutoApiChe168,isCompletedDubicarsDelta} from '../scripts/lib/auto-api-che168-client.mjs';
import {publishedIntakeCheckpoint} from '../scripts/lib/catalog-intake-checkpoint.mjs';
import {defaultCollectionControls} from '../apps/web/lib/catalog/collection-controls-schema';
import {validateCollectionControls} from '../apps/web/lib/catalog/collection-controls';
const row=()=>({inner_id:'123',data:{inner_id:'123',url:'https://www.dubicars.com/1997-toyota-corolla-123.html?tracking=abc',mark:'Toyota',model:'Corolla',year:'1997',price:'14000',engine_type:'Petrol',displacement:'1.8',images:JSON.stringify(['https://www.dubicars.com/images/a/car.jpg']),phone:'must-not-persist',extra_prep:{dealer_emails:['must-not-persist']}}});
test('paid UAE normalizer retains old cars, AED and source photos with supplier-confirmed litres and without invented power',()=>{
 const offer=normalizeAutoApiDubicars(row())!;assert.ok(offer);assert.equal(offer.year,1997);assert.equal(offer.sourceCurrency,'AED');assert.equal(offer.sourcePrice,14000);assert.equal(offer.engineCc,1800);assert.equal(offer.powerHp,undefined);assert.equal(offer.power30MinKw,undefined);assert.equal(offer.images.length,1);assert.equal(offer.operational?.sourceUrl,'https://www.dubicars.com/1997-toyota-corolla-123.html');assert.ok(!JSON.stringify(offer).includes('must-not-persist'));
 assert.equal(catalogInventoryAgeDecision(offer).eligible,true);assert.equal(catalogHeavyVehicleExcluded({...offer,bodyType:'truck',grossVehicleWeightKg:7000}),true);
 assert.equal(catalogInventoryAgeDecision({...offer,sourceId:'carswitch_uae_open'}).eligible,false);
 assert.equal(normalizeAutoApiDubicars({...row(),inner_id:'456'}),null);
});
test('Dubicars requests full pages without source filters and replays changes in order',async()=>{
 const calls:any[]=[];let observed=0;const removed:string[]=[];
 const request=autoApiChe168Client({platform:'dubicars',apiKey:'test-key',fetchImpl:async(u:URL)=>{
 calls.push(u);assert.equal(u.pathname.startsWith('/api/v2/dubicars/'),true);
 if(u.pathname.endsWith('/change_id'))return Response.json({change_id:10});
 if(u.pathname.endsWith('/offers')){assert.deepEqual([...u.searchParams.keys()].sort(),['api_key','page']);return Response.json({result:[row()],meta:{page:1,next_page:null}});}
 if(u.pathname.endsWith('/changes'))return Response.json(u.searchParams.get('change_id')==='10'?{result:[{id:10,inner_id:'123',change_type:'removed',created_at:'2026-10-18T00:00:00Z'}],meta:{cur_change_id:10,next_change_id:11}}:{result:[],meta:{cur_change_id:11,next_change_id:11}});
 throw Error('unexpected');
 }});
 const result=await collectAutoApiChe168({request,onOffer:async()=>{observed++;},onRemoval:async(c:any)=>{removed.push(c.inner_id);}});
 assert.equal(observed,1);assert.deepEqual(removed,['123']);assert.equal(result.cursor,11);
});
test('paid cursor cannot advance on incomplete publication; completed delta preserves provider metadata',()=>{
 const report:any={version:1,market:'uae',provider:'auto_api_dubicars',completed:true,completedAt:'2026-10-18T00:00:00Z',sources:[{sourceId:'dubicars_uae_exact',provider:'auto_api_dubicars',syncMode:'delta',snapshotStartedAt:'2026-10-17T00:00:00Z',pages:0,initialCursor:10,cursor:11,rejectedIdentity:0,stopReason:'source_changes_finished'}]};
 assert.equal(isCompletedDubicarsDelta(report),true);
 assert.throws(()=>publishedIntakeCheckpoint(report,{published:false,market:'uae'}));
 assert.throws(()=>publishedIntakeCheckpoint({...report,completed:false},{published:true,market:'uae',generationId:'test'}));
 const saved=publishedIntakeCheckpoint(report,{published:true,market:'uae',generationId:'test'});assert.equal(saved.sources[0].provider,'auto_api_dubicars');assert.equal(saved.sources[0].snapshotStartedAt,report.sources[0].snapshotStartedAt);
});
test('new owner-authorized switch preserves saved switches and history',()=>{const controls=defaultCollectionControls();delete controls.sources.dubicars_feed;controls.sources.che168_feed.enabled=false;const next=validateCollectionControls(controls);assert.equal(next.sources.dubicars_feed.enabled,true);assert.equal(next.sources.che168_feed.enabled,false);});

test('unpriced and unphotographed Dubicars survive publication and card projection without invented totals',async()=>{
 const {prepareSellerInventory}=await import('../apps/web/lib/catalog/prepare-seller-inventory');
 const {classifyCatalogV2Offer}=await import('../apps/web/lib/catalog/catalog-v2-policy');
 const {hasCredibleOfferContent,minimumPublicationImages}=await import('../apps/web/lib/catalog/offer-quality');
 const {projectionCanRenderCard,searchProjectionFromOffer,isPublicOffer}=await import('../apps/web/lib/catalog/storage');
 const input=row();input.data.price='';input.data.images='[]';const offer=normalizeAutoApiDubicars(input)!;
 assert.equal(hasCredibleOfferContent(offer),true);assert.equal(minimumPublicationImages(offer,5,false),0);
 const prepared=await prepareSellerInventory(offer);assert.ok(prepared);assert.equal(prepared.totalRub,null);assert.equal(classifyCatalogV2Offer(prepared).eligible,true);
 assert.equal(projectionCanRenderCard(searchProjectionFromOffer(prepared)),true);
 assert.equal(isPublicOffer(prepared),true);
});


test('named paid-feed Horsepower survives normalization without becoming 30-minute power',()=>{
 for(const fields of [{Horsepower:'147 HP'},{extra_prep:{Horsepower:'147'}},{extra_prep:JSON.stringify({horsepower:147})},{power_hp:147}]){
  const offer=normalizeAutoApiDubicars({...row(),data:{...row().data,...fields}})!;
  assert.equal(offer.powerHp,147);assert.equal(offer.powerDataConfidence,'source_exact');
  assert.equal(offer.operational?.semanticEvidence?.powerHp.status,'exact');
  assert.equal(offer.power30MinKw,undefined);
 }
 for(const fields of [{Horsepower:'100-200 HP'},{Horsepower:'110 kW'},{Horsepower:0},{Horsepower:147,extra_prep:{Horsepower:150}},{power:147}]){
  assert.equal(normalizeAutoApiDubicars({...row(),data:{...row().data,...fields}})!.powerHp,undefined);
 }
});
