import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {normalizeAutoApiChe168, AUTO_API_CHE168_SOURCE} from '../apps/web/lib/catalog/auto-api-che168';
import {isAllowedCatalogSourceUrl} from '../apps/web/lib/catalog/required-catalog-sources';
import {inventorySourceEvidence} from '../apps/web/lib/catalog/prepare-seller-inventory';
import {classifySpecificationEvidence} from '../apps/web/lib/catalog/specification-evidence-audit';
import {catalogInventoryAgeDecision, catalogHeavyVehicleExcluded} from '../apps/web/lib/catalog/inventory-admission';
import {catalogConfirmedWithdrawalIndex, catalogOfferWithdrawnByReport} from '../apps/web/lib/catalog/source-retention';
import {autoApiChe168Client, autoApiPage, collectAutoApiChe168} from '../scripts/lib/auto-api-che168-client.mjs';
import {observationShardWriter, publishedIntakeCheckpoint} from '../scripts/lib/catalog-intake-checkpoint.mjs';
import {convertMarketOnDisk} from '../scripts/lib/catalog-disk-conversion.mjs';

const observedAt='2026-10-08T12:00:00.000Z';
function fixture() {return {inner_id:'50837332',data:{inner_id:'50837332',url:'https://www.che168.com/dealer/451591/50837332.html',
  mark:'BMW',model:'1 Series',configuration:'125i',year:'2022',price:'98000',km_age:'0',first_registration:'2022-09',
  engine_type:'Бензиновый',transmission_type:'автоматическая',drive_type:'передний привод',displacement:'2.0',power:'192',
  ice_power_ps:'192',ice_power_kw:'141',specid:'57217',body_type:'седан/хэтчбек',
  images:JSON.stringify(['https://2sc2.autoimg.cn/escimg/auto/g31/car.jpg.webp']),
  extra:{inspection:{phone:'PRIVATE'},configuration:{specid:57217,paramtypeitems:[{name:'发动机',paramitems:[{name:'排量(mL)',value:'1998'}]}]}}}};}

test('paid Che168 uses CNY, bound exact cc and source photos without manufacturing a production date',()=>{
 const o=normalizeAutoApiChe168(fixture(),observedAt)!;
 assert.equal(o.sourcePrice,98000);assert.equal(o.sourceCurrency,'CNY');assert.equal(o.engineCc,1998);assert.equal(o.powerHp,192);
 assert.equal(o.mileageKm,0);assert.equal(o.productionDate,undefined);assert.equal(o.inventorySourceDate,'2022-09');
 assert.equal(o.bodyType,undefined);assert.equal(o.images.length,1);assert.equal(o.images[0].objectKey,'');
 assert.ok(isAllowedCatalogSourceUrl('china',o.sourceId,o.operational?.sourceUrl));
 assert.equal(inventorySourceEvidence(o).engineCc,1998);
 for(const field of ['engineCc','powerHp','fuelPowertrain'] as const)assert.equal(classifySpecificationEvidence(o,field).state,'exact');
 assert.ok(!JSON.stringify(o).includes('PRIVATE'));
});
test('missing fields and unbound tables stay editable, rounded litres do not become exact cc',()=>{
 const r=fixture();r.data.extra.configuration.specid=999;r.data.power='';r.data.ice_power_ps='';r.data.ice_power_kw='';r.data.engine_type='';
 const o=normalizeAutoApiChe168(r,observedAt)!;
 assert.ok(o);assert.equal(o.engineCc,undefined);assert.equal(o.powerHp,undefined);assert.equal(o.fuel,undefined);
 assert.equal(o.operational?.sourceSpecifications,undefined);assert.equal(o.calculationStatus,'needs_data');
});
test('rejects mismatched identities, foreign source URLs and non-vehicle galleries',()=>{
 const r=fixture();r.data.inner_id='8';assert.equal(normalizeAutoApiChe168(r),null);
 r.data.inner_id=r.inner_id;r.data.url='https://www.che168.com/dealer/451591/9.html';assert.equal(normalizeAutoApiChe168(r),null);
 r.data.url=fixture().data.url;r.data.images=JSON.stringify(['https://evil.example/escimg/auto/a.jpg','https://2sc2.autoimg.cn/logo.jpg']);
 assert.equal(normalizeAutoApiChe168(r)!.images.length,0);
 assert.equal(isAllowedCatalogSourceUrl('china',AUTO_API_CHE168_SOURCE,'https://evil.che168.com/dealer/1/2.html'),false);
 assert.equal(isAllowedCatalogSourceUrl('china',AUTO_API_CHE168_SOURCE,r.data.url+'?api_key=private'),false);
});
test('EV and hybrid peak power never becomes certified 30 minute power',()=>{
 for(const fuel of ['Электрический','Бензиновый гибрид','增程']){
  const r=fixture();r.data.engine_type=fuel;
  const o=normalizeAutoApiChe168(r)!;
  assert.equal(o.power30MinKw,undefined);assert.equal(o.icePowerKw,undefined);
  assert.equal(classifySpecificationEvidence(o,'certifiedPower').state,'missing');
  if(fuel==='Электрический')assert.equal(o.engineCc,undefined);
  if(fuel==='增程')assert.equal(o.powertrainKind,'series_hybrid');
 }
});
test('conflicting PS/kW stays unresolved instead of silently choosing a power',()=>{
 const r=fixture();r.data.ice_power_kw='300';
 const o=normalizeAutoApiChe168(r)!;
 assert.equal(o.powerHp,undefined);assert.equal(o.powerKw,undefined);
 assert.equal(classifySpecificationEvidence(o,'powerHp').state,'conflict');
});
test('admission applies precise six-year policy and permitted pickup mass, no power or price caps',()=>{
 const r=fixture();r.data.year='2020';r.data.first_registration='2020-09';
 assert.equal(catalogInventoryAgeDecision(normalizeAutoApiChe168(r),new Date(observedAt)).eligible,false);
 r.data.first_registration='2020-10';r.data.price='99999999';r.data.body_type='пикап';
 r.data.extra.configuration.paramtypeitems.push({name:'基本参数',paramitems:[{name:'最大允许总质量(kg)',value:'3600'}]});
 const o=normalizeAutoApiChe168(r)!;
 assert.equal(catalogInventoryAgeDecision(o,new Date(observedAt)).eligible,true);assert.equal(catalogHeavyVehicleExcluded(o),true);
});
test('HTTP access refusals are not retried and do not disclose keys, URLs or bodies',async()=>{
 let calls=0;const request=autoApiChe168Client({apiKey:'private-test-key',fetchImpl:async()=>{calls++;return new Response('private-test-key',{status:403});}});
 await assert.rejects(()=>request('offers',{page:1}),{message:'auto_api_http_403'});assert.equal(calls,1);
 const failing=autoApiChe168Client({apiKey:'private-test-key',sleep:async()=>{},fetchImpl:async()=>{throw Error('url?api_key=private-test-key');}});
 await assert.rejects(()=>failing('offers'),{message:'auto_api_transport_failed'});
});
test('transient failures retry fixed origin without redirects',async()=>{
 let calls=0;const request=autoApiChe168Client({apiKey:'private-test-key',sleep:async()=>{},fetchImpl:async(url:any,options:any)=>{
  assert.equal(url.origin,'https://api1.auto-api.com');assert.equal(options.redirect,'error');calls++;
  return calls===1?new Response('',{status:429}):Response.json({ok:true});
 }});
 assert.deepEqual(await request('offers'),{ok:true});assert.equal(calls,2);
});
test('pagination fails closed on a loop or unexpected metadata',()=>{
 assert.throws(()=>autoApiPage({result:[],meta:{page:1,next_page:1}},1));
 assert.throws(()=>autoApiPage({result:[],meta:{page:1}},1));
 assert.deepEqual(autoApiPage({result:[],meta:{page:1,next_page:null}},1),{items:[],next:null});
});
test('snapshot replay overwrites price via full detail; explicit removal, cursor and on-disk revisions survive',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'che168-'));const out=path.join(dir,'out');await fs.mkdir(out);
 const write=observationShardWriter(dir,AUTO_API_CHE168_SOURCE);const withdrawals:any[]=[];const calls:any[]=[];
 const event={id:10,inner_id:'50837332',change_type:'changed',created_at:observedAt,data:{new_price:80000}};
 try {
 const result=await collectAutoApiChe168({yearFrom:2020,now:()=>observedAt,request:async(endpoint:any,params:any)=>{
  calls.push([endpoint,params]);
  if(endpoint==='change_id')return {change_id:10};
  if(endpoint==='offers')return {result:[fixture()],meta:{page:1,next_page:null}};
  if(endpoint==='changes')return {result:params.change_id===10?[event,{...event,id:11,inner_id:'999',change_type:'removed'}]:[],meta:{cur_change_id:params.change_id,next_change_id:12}};
  if(endpoint==='offer'){const r=fixture();r.data.price='80000';return r;}
 },onOffer:async(row:any,at:string)=>write({offer:normalizeAutoApiChe168(row,at)}),onRemoval:async(row:any)=>{withdrawals.push(row);}});
 assert.equal(result.cursor,12);assert.equal(result.pages,1);assert.equal(withdrawals.length,1);
 assert.equal(calls[0][0],'change_id');assert.equal(calls.filter(x=>x[0]==='offer').length,1);
 const converted=await convertMarketOnDisk({market:'china',directory:dir,files:await fs.readdir(dir),out,report:{sources:[]}});
 assert.equal(converted.uniqueObservations,1);
 const shard=JSON.parse(await fs.readFile(path.join(out,'catalog-rebuild-china-0001.json'),'utf8'));
 assert.equal(shard.offers[0].sourcePrice,80000);
 assert.throws(()=>publishedIntakeCheckpoint({market:'china',completedAt:observedAt,sources:[]},{published:false}));
 } finally {await fs.rm(dir,{recursive:true,force:true});}
});
test('a historical removal cannot withdraw a later observed active listing',()=>{
 const offer=normalizeAutoApiChe168(fixture(),observedAt)!;
 const index=catalogConfirmedWithdrawalIndex([{report:{confirmedWithdrawals:[{id:offer.id,sourceId:offer.sourceId,sourceOfferId:offer.sourceOfferId,
  market:'china',status:'removed',observedAt:'2026-10-07T12:00:00Z'}]}}],'china');
 assert.equal(catalogOfferWithdrawnByReport(offer,index),false);
});
test('price-only detail and non-advancing changes abort the snapshot',async()=>{
 for(const invalidDetail of [true,false]) {
  await assert.rejects(()=>collectAutoApiChe168({yearFrom:2020,onOffer:async()=>{},onRemoval:async()=>{},request:async(endpoint:any)=>{
   if(endpoint==='change_id')return {change_id:1};
   if(endpoint==='offers')return {result:[],meta:{page:1,next_page:null}};
   if(endpoint==='changes')return {result:[{id:1,inner_id:'8',change_type:'changed',created_at:observedAt}],meta:{cur_change_id:1,next_change_id:invalidDetail?2:1}};
   return {new_price:123};
  }}),new RegExp(invalidDetail?'detail_identity_mismatch':'stalled_changes'));
 }
});
