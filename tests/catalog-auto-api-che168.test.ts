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
import {autoApiChe168Client, autoApiPage, autoApiChe168Detail, collectAutoApiChe168} from '../scripts/lib/auto-api-che168-client.mjs';
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
test('secret entry permits surrounding whitespace but rejects internal whitespace',async()=>{
 const request=autoApiChe168Client({apiKey:'  private-test-key\n',fetchImpl:async(url:any)=>{
  assert.equal(url.searchParams.get('api_key'),'private-test-key');return Response.json({ok:true});
 }});
 assert.deepEqual(await request('offers'),{ok:true});
 assert.throws(()=>autoApiChe168Client({apiKey:'private test key'}),/missing_or_invalid/);
});
test('invalid JSON retries the same page without duplicate offers or skipping records',async()=>{
 const calls:string[]=[];const ids:string[]=[];const waits:number[]=[];let pageAttempts=0;
 const request=autoApiChe168Client({apiKey:'private-test-key',sleep:async(ms:number)=>{waits.push(ms);},fetchImpl:async(url:URL)=>{
  calls.push(url.pathname+'?'+new URLSearchParams([...url.searchParams].filter(([key])=>key!=='api_key')));
  if(url.pathname.endsWith('/change_id'))return Response.json({change_id:10});
  if(url.pathname.endsWith('/offers')){
   pageAttempts++;
   if(pageAttempts===1)return new Response('{"result":[', {status:200});
   return Response.json({result:[fixture()],meta:{page:1,next_page:null}});
  }
  return Response.json({result:[],meta:{cur_change_id:10}});
 }});
 const result=await collectAutoApiChe168({request,yearFrom:2020,now:()=>observedAt,onOffer:async(row:any)=>{ids.push(row.inner_id);},onRemoval:async()=>{}});
 assert.equal(calls[1],calls[2]);assert.equal(pageAttempts,2);assert.deepEqual(waits,[1000]);
 assert.deepEqual(ids,['50837332']);assert.equal(result.pages,1);assert.equal(result.rows,1);
});
test('persistent invalid JSON fails closed after bounded retries without leaking upstream content',async()=>{
 let calls=0;const waits:number[]=[];
 const request=autoApiChe168Client({apiKey:'private-test-key',sleep:async(ms:number)=>{waits.push(ms);},fetchImpl:async()=>{calls++;return new Response('private-test-key <html>broken</html>');}});
 await assert.rejects(()=>request('offers',{page:7065}),{message:'auto_api_invalid_json'});
 assert.equal(calls,4);assert.deepEqual(waits,[1000,2000,4000]);
});
test('invalid JSON retry respects the overall deadline',async()=>{
 let calls=0;
 const request=autoApiChe168Client({apiKey:'private-test-key',deadline:Date.now()+100, sleep:async()=>{await new Promise(resolve=>setTimeout(resolve,120));},fetchImpl:async()=>{calls++;return new Response('{');}});
 await assert.rejects(()=>request('offers'),{message:'auto_api_time_budget'});assert.equal(calls,1);
});
test('pagination fails closed on a loop or unexpected metadata',()=>{
 assert.throws(()=>autoApiPage({result:[],meta:{page:1,next_page:1}},1));
 assert.throws(()=>autoApiPage({result:[],meta:{page:1}},1));
 assert.deepEqual(autoApiPage({result:[],meta:{page:1,next_page:null}},1),{items:[],next:null});
});
test('detail accepts the observed flat /offer form while preserving strict identity',()=>{
 const wrapped=autoApiChe168Detail(fixture(),'50837332');assert.equal(wrapped.data.model,'1 Series');
 const flat=fixture().data;const normalized=autoApiChe168Detail(flat,'50837332');assert.equal(normalized.data,flat);
 assert.throws(()=>autoApiChe168Detail({...flat,inner_id:'9'},'50837332'),/identity_mismatch/);
 assert.throws(()=>autoApiChe168Detail({inner_id:'50837332'},'50837332'),/identity_mismatch/);
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
  if(endpoint==='offer'){const r=fixture();return {...r.data,price:'80000'};}
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

test('delta resumes at the published cursor without snapshot requests, including no-change and removal-only batches',async()=>{
 for(const removed of [false,true]){
  const calls:string[]=[],withdrawals:any[]=[];
  const result=await collectAutoApiChe168({yearFrom:2020,resume:{cursor:12,snapshotStartedAt:observedAt},now:()=>observedAt,
   request:async(endpoint:string,params:any)=>{calls.push(endpoint);assert.equal(endpoint,'changes');return {result:removed&&params.change_id===12?[{id:12,inner_id:'50837332',change_type:'removed',created_at:observedAt}]:[],meta:{cur_change_id:params.change_id,next_change_id:13}};},
   onOffer:async()=>{assert.fail('No offers expected');},onRemoval:async(row:any)=>{withdrawals.push(row);}});
  assert.equal(result.pages,0);assert.equal(result.mode,'delta');assert.equal(result.cursor,removed?13:12);assert.equal(withdrawals.length,removed?1:0);
  assert.ok(calls.every(x=>x==='changes'));
 }
});
test('published paid checkpoint preserves bootstrap time and fails closed on incomplete intake or publication',async()=>{
 const {autoApiChe168Resume,isCompletedChe168Delta}=await import('../scripts/lib/auto-api-che168-client.mjs');
 const source={sourceId:AUTO_API_CHE168_SOURCE,provider:'auto_api_che168',snapshotStartedAt:observedAt,yearFrom:2020,cursor:20,initialCursor:12,pages:0,rejectedIdentity:0,syncMode:'delta',stopReason:'source_changes_finished'};
 const intake={market:'china',provider:'auto_api_che168',completed:true,completedAt:observedAt,sources:[source]};
 const publication={market:'china',published:true,generationId:'published-1'};
 const saved=publishedIntakeCheckpoint(intake,publication);
 assert.deepEqual(autoApiChe168Resume(saved,{yearFrom:2020,now:Date.parse(observedAt)+86400000}),{cursor:20,snapshotStartedAt:observedAt});
 assert.equal(autoApiChe168Resume(saved,{yearFrom:2020,now:Date.parse(observedAt)+7*86400000}),null);
 assert.equal(autoApiChe168Resume(saved,{yearFrom:2021,now:Date.parse(observedAt)}),null);
 assert.equal(autoApiChe168Resume(saved,{yearFrom:2020,now:Date.parse(observedAt),forceSnapshot:true}),null);
 assert.throws(()=>autoApiChe168Resume({...saved,sources:[{...saved.sources[0],cursor:'20'}]},{yearFrom:2020,now:Date.parse(observedAt)}),/invalid_saved_cursor/);
 assert.throws(()=>publishedIntakeCheckpoint({...intake,completed:false},publication),/incomplete_cursor/);
 assert.throws(()=>publishedIntakeCheckpoint(intake,{...publication,published:false}),/successful_publication/);
 assert.equal(isCompletedChe168Delta(intake),true);
 assert.equal(isCompletedChe168Delta({...intake,sources:[{...source,mode:'live'}]}),true,'converter mode does not erase sync mode');
 for(const bad of [{completed:false},{failure:'auto_api_http_403'},{sources:[{...source,rejectedIdentity:1}]},{sources:[{...source,cursor:11}]}])assert.equal(isCompletedChe168Delta({...intake,...bad}),false);
});

test('missing model is classified separately from invalid source identity and remains unpublished',async()=>{
 const {autoApiChe168RejectionReason}=await import('../apps/web/lib/catalog/auto-api-che168');
 const row=fixture();row.data.model='';
 assert.equal(autoApiChe168RejectionReason(row),'missing_model');assert.equal(normalizeAutoApiChe168(row),null);
 row.data.url='https://www.che168.com/dealer/451591/9.html';
 assert.equal(autoApiChe168RejectionReason(row),'url_identity_mismatch');
});

test('legacy recovery requires a completed full scan proof; truncation and transport failures cannot publish',async()=>{
 const {recoverLegacyChe168Snapshot,validateLegacyChe168Recovery}=await import('../scripts/lib/auto-api-che168-recovery.mjs');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'che168-recovery-'));
 const offer=normalizeAutoApiChe168(fixture(),observedAt)!;
 const source={sourceId:AUTO_API_CHE168_SOURCE,observations:500,uniqueOffers:500,rejectedIdentity:1};
 const original={version:1,provider:'auto_api_che168',market:'china',completed:false,startedAt:observedAt,failure:'auto_api_rejected_identity_review_required',sources:[source],confirmedWithdrawals:[]};
 const calls:string[]=[];
 try{
  for(const failure of ['auto_api_time_budget','auto_api_http_403','auto_api_transport_failed'])assert.throws(()=>validateLegacyChe168Recovery({...original,failure}),/not_recoverable/);
  assert.throws(()=>validateLegacyChe168Recovery({...original,sources:[{...source,rejectedIdentity:1001}]}),/not_recoverable/);
  await fs.writeFile(path.join(dir,'report.json'),JSON.stringify(original));
  const write=observationShardWriter(dir,AUTO_API_CHE168_SOURCE);
  await write({observedAt,offer});
  const request=async(endpoint:string,params:any)=>{calls.push(endpoint);assert.notEqual(endpoint,'offers');if(endpoint==='change_id')return {change_id:20};if(endpoint==='offer'){const r=fixture();r.data.price='80000';return r;}return {result:params.change_id===20?[{id:20,inner_id:'50837332',change_type:'changed',created_at:observedAt}]:[],meta:{cur_change_id:params.change_id,next_change_id:21}};};
  await assert.rejects(()=>recoverLegacyChe168Snapshot({directory:dir,request,now:()=>observedAt}),/truncated_artifact/);
  assert.equal(calls.length,0,'no provider calls for invalid artifact');
  for(let i=1;i<500;i++){const row=fixture();row.inner_id=String(50837332+i);row.data.inner_id=row.inner_id;row.data.url=`https://www.che168.com/dealer/451591/${row.inner_id}.html`;await write({observedAt,offer:normalizeAutoApiChe168(row,observedAt)});}
  const report=await recoverLegacyChe168Snapshot({directory:dir,request,now:()=>observedAt});
  assert.equal(report.completed,true);assert.equal(report.sources[0].cursor,21);assert.equal(report.sources[0].observations,501);assert.equal(report.sources[0].quarantined,1);
  assert.equal(report.recovery.originalRejectionReasons,'unrecorded; not assumed to be missing_model');
  assert.equal(JSON.parse(await fs.readFile(path.join(dir,'report.before-recovery.json'),'utf8')).completed,false);
  assert.ok(calls.every(x=>['change_id','changes','offer'].includes(x)));assert.ok((await fs.readFile(path.join(dir,`${AUTO_API_CHE168_SOURCE}-000002.jsonl`),'utf8')).includes('80000'));
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('verified full snapshot interrupted by flat detail replay recovers without /offers or a new change cursor',async()=>{
 const {recoverLegacyChe168Snapshot,validateInterruptedChe168ReplayRecovery}=await import('../scripts/lib/auto-api-che168-recovery.mjs');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'che168-replay-recovery-'));const calls:string[]=[];
 try{
  const write=observationShardWriter(dir,AUTO_API_CHE168_SOURCE);
  for(let i=0;i<200;i++){const row=fixture();row.inner_id=String(50837332+i);row.data.inner_id=row.inner_id;row.data.url=`https://www.che168.com/dealer/451591/${row.inner_id}.html`;await write({observedAt,offer:normalizeAutoApiChe168(row,observedAt)});}
  const quarantine={innerId:'50837399',reason:'missing_model',observedAt};await fs.writeFile(path.join(dir,'quarantine.ndjson'),JSON.stringify(quarantine)+'\n');
  const source={sourceId:AUTO_API_CHE168_SOURCE,pages:10,rows:201,changes:0,cursor:20,phase:'snapshot',observations:200,uniqueOffers:200,rejectedIdentity:0,quarantined:1,rejectionReasons:{missing_model:1}};
  const original={version:1,provider:'auto_api_che168',market:'china',completed:false,startedAt:observedAt,failure:'auto_api_detail_identity_mismatch',sources:[source],confirmedWithdrawals:[]};
  validateInterruptedChe168ReplayRecovery(original);await fs.writeFile(path.join(dir,'report.json'),JSON.stringify(original));
  const request=async(endpoint:string,params:any)=>{calls.push(endpoint);assert.notEqual(endpoint,'offers');assert.notEqual(endpoint,'change_id');
   if(endpoint==='offer'){const row=fixture();return {...row.data,price:'80000'};}
   return {result:params.change_id===20?[{id:20,inner_id:'50837332',change_type:'changed',created_at:observedAt}]:[],meta:{cur_change_id:params.change_id,next_change_id:21}};};
  const report=await recoverLegacyChe168Snapshot({directory:dir,request,now:()=>observedAt});
  assert.equal(report.completed,true);assert.equal(report.recovery.interruptedChangeReplay,true);assert.equal(report.recovery.originalQuarantined,1);
  assert.equal(report.sources[0].cursor,21);assert.equal(report.sources[0].observations,201);assert.equal(report.sources[0].quarantined,1);
  assert.deepEqual((await fs.readFile(path.join(dir,'quarantine.ndjson'),'utf8')).trim(),JSON.stringify(quarantine));
  assert.ok(calls.every(x=>['changes','offer'].includes(x)));
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
