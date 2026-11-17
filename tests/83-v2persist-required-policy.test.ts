import os from 'node:os';
import {createHash} from 'node:crypto';
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';
import{getJsonStorage,resetJsonStorageForTests,StorageConflictError}from'../apps/web/lib/data';
import{persistCatalogOffers,resetCatalogReadCachesForTests}from'../scripts/publisher-runtime83/storage';
import{sharedBudgetPrices,readPreparedBudgetPrices,resetSharedBudgetPriceCache,budgetPricingFingerprint}from'../apps/web/lib/catalog/shared-budget-prices';
import{RAW_COORDINATION_KEY,createRawCoordination,rawCatalogDescriptor,rawPointerDescriptor,RAW_COORDINATED_POINTERS}from'../scripts/lib/catalog-raw-coordination.mjs';
import{rawInternalPointerDescriptor}from'../scripts/publisher-runtime83/raw-internal-provenance.mjs';
import{RAW_COORDINATION_POLICY_KEY}from'../scripts/publisher-runtime83/raw-coordination-gate.mjs';
import{prepareRawInternalPublication}from'../scripts/lib/catalog-raw-internal-publication.mjs';
import{prepareRawPublication}from'../scripts/lib/catalog-raw-publication.mjs';
// Synthetic legacy Korea rows exercise the operational writer, not paid Encar intake.
// Real coordination modules run against an in-memory object-store fixture. Prices are
// numerical fixture values persisted/read back through exact83 APIs, not live tariff evidence.
const owner={runId:'12345678',attempt:'1',revision:'a'.repeat(40)};
function offers(){const now=new Date().toISOString();return [0,1].map(i=>({id:'fixture-korea-'+i,sourceId:'encar_direct',sourceOfferId:String(12345678+i),market:'korea',offerType:'fixed',status:'active',make:'Kia',model:i?'K3':'K5',year:2024,sourcePrice:25000000,sourceCurrency:'KRW',priceMode:'fixed',images:Array.from({length:5},(_,j)=>({id:`img-${i}-${j}`,url:`/api/catalog/images/img-${i}-${j}`,objectKey:`catalog/images/korea/${i}-${j}.jpg`,checksum:`fixture-${i}-${j}`,size:100000,width:1200,height:800,mimeType:'image/jpeg'})),totalRub:2500000+i,fuel:'petrol',powertrainKind:'combustion',engineCc:1598,powerHp:123,powerDataConfidence:'source_exact',powerDataSource:'synthetic_exact_fixture',calculationStatus:'ready',calculationSnapshot:{customs:{status:'ready'},breakdown:['car','topavto-commission','broker','svh','laboratory','sbkts','epts','rf-delivery','customs'].map(id=>({id,amountRub:1}))},firstSeenAt:now,updatedAt:now,operational:{provider:'legacy_fixture',sourceUrl:`https://www.encar.com/dc/dc_cardetailview.do?carid=${12345678+i}`,photoIdentityVerified:true,semanticEvidence:{fuel:{status:'exact',value:'petrol'},engineCc:{status:'exact',value:1598},powerHp:{status:'exact',value:123}}}}));}

test('83 real two-row writer uses required raw reservations and read-back prepared prices before pointer CAS',async()=>{
 const cwd=process.cwd(),env={...process.env},fetch=globalThis.fetch,dir=await fs.mkdtemp(path.join(os.tmpdir(),'83-v2-'));
 try{process.chdir(dir);await fs.mkdir('data');process.env.JSON_STORAGE_DRIVER='local';process.env.CATALOG_LIVE_RATE_DISABLED='true';process.env.AVTOCENA_CALCULATION_VERSION='b'.repeat(64);globalThis.fetch=async()=>{throw Error('offline_only');};
 for(const mode of ['readiness_failed','prepared_price_missing','internal_cas_conflict','lease_lost','reservation_missing','public_cas_retry','success']){
 resetJsonStorageForTests();resetCatalogReadCachesForTests();resetSharedBudgetPriceCache();
 const storage:any=getJsonStorage(),objects=new Map(),versions=new Map(),trace:string[]=[];let ready=false,internal=false,publicAttempts=0,publication:any;
 Object.defineProperty(storage,'driver',{value:'object'});
 storage.readJson=async(k,f)=>structuredClone(objects.has(k)?objects.get(k):f);
 storage.getBinary=async k=>{const data=Buffer.from(JSON.stringify(objects.get(k)));return{data,size:data.length,checksum:createHash('sha256').update(data).digest('hex')};};
 storage.readJsonWithMeta=async(k,f)=>({found:objects.has(k),etag:objects.has(k)?String(versions.get(k)||1):undefined,value:await storage.readJson(k,f)});
 storage.writeJson=async(k,v,c)=>{
 if(['catalog/internal/manifest.json','catalog/japan-auction-history/manifest.json','catalog/manifest.json'].includes(k)){assert.ok(ready,'no pointer before readiness');trace.push(k);}
 if(k.startsWith('catalog/public/')){assert.ok(internal,'aliases require internal committed');trace.push('alias');}
 if(k==='catalog/internal/manifest.json'&&mode==='internal_cas_conflict')throw new StorageConflictError();
 if(k==='catalog/manifest.json'&&mode==='public_cas_retry'&&publicAttempts++===0)throw new StorageConflictError();
 if(c?.ifMatch&&c.ifMatch!==String(versions.get(k)||1)||c?.ifNoneMatch==='*'&&objects.has(k))throw new StorageConflictError();
 objects.set(k,structuredClone(v));versions.set(k,(versions.get(k)||0)+1);if(k==='catalog/internal/manifest.json')internal=true;};
 const registryId='f'.repeat(32);
 objects.set(RAW_COORDINATION_KEY,createRawCoordination({registryId,current:rawCatalogDescriptor(null),previous:rawCatalogDescriptor(null),pointers:RAW_COORDINATED_POINTERS.map(id=>({id,current:id==='internal_catalog'?rawInternalPointerDescriptor(null):rawPointerDescriptor(null,[],{complete:true})}))}));
 objects.set(RAW_COORDINATION_POLICY_KEY,{version:1,mode:'required',protocolVersion:1,registryId});
 const opts:any={publicationTransactionVersion:2,requirePreparedWorkingSet:false,expectedBaseGenerationId:'empty',rawCoordinationTicket:()=>mode==='reservation_missing'?null:publication?.binding?.ticket,
 beforeManifestCommit:async()=>{trace.push('lease');if(mode==='lease_lost'&&internal)throw Error('fixture_lease_lost');},
 beforePreparedInternalManifest:async({manifest,baseManifest})=>prepareRawInternalPublication({storage,manifest,baseManifest,intake:null,operationId:'fixture-internal-'+mode,owner}),
 beforePreparedReadiness:async(manifest)=>{
 trace.push('readiness');assert.equal(internal,false);assert.equal(manifest.markets.korea.count,2);
 if(mode==='readiness_failed')throw Error('fixture_readiness_failed');
 const index=objects.get(`catalog/generations/${manifest.generationId}/indexes/budget-count-v3.json`);assert.ok(index);
 const rows=[...index.rows,...(index.otherRows||[])].filter(r=>r[0]==='korea');assert.equal(rows.length,2);
 assert.ok(rows.every(r=>Number.isFinite(r[1])&&r[1]>0),'numeric83prices');
 const fp=await budgetPricingFingerprint('korea');await sharedBudgetPrices(index,'korea',fp,async()=>rows,async()=>fp);
 resetSharedBudgetPriceCache();const restored=await readPreparedBudgetPrices(index,'korea',fp);assert.deepEqual(restored,rows);
 if(mode==='prepared_price_missing')for(const key of objects.keys())if(key.startsWith('catalog/runtime-budget-prices-v3/'))objects.delete(key);
 return{workingSetVerified:false,verify:async()=>{assert.equal(await budgetPricingFingerprint('korea'),fp);resetSharedBudgetPriceCache();const reread=await readPreparedBudgetPrices(index,'korea',fp);assert.ok(reread,'fixture_prepared_price_missing');assert.deepEqual(reread,rows);ready=true;trace.push('readback');}};
 },beforePreparedGeneration:async(manifest)=>{assert.equal(internal,true);publication=await prepareRawPublication({storage,manifest,expectedBaseGenerationId:'empty',market:'korea',intake:null,operationId:'fixture-public-'+mode,owner});assert.ok(publication.binding?.ticket);trace.push('reserved');return publication.verify;}};
 if(['success','public_cas_retry'].includes(mode)){const result=await persistCatalogOffers(offers() as any,opts);assert.equal(objects.get('catalog/manifest.json').generationId,result.generationId);assert.ok(trace.indexOf('readback')<trace.indexOf('catalog/internal/manifest.json'));assert.ok(trace.indexOf('reserved')<trace.indexOf('alias'));}
 else{await assert.rejects(persistCatalogOffers(offers() as any,opts),/fixture_readiness_failed|fixture_prepared_price_missing|storage_conflict|fixture_lease_lost|raw_coord_ticket_invalid/);assert.equal(objects.has('catalog/manifest.json'),false);assert.equal(trace.includes('alias'),false);if(!['lease_lost','reservation_missing'].includes(mode))assert.equal(internal,false);}
 }
 }finally{process.chdir(cwd);globalThis.fetch=fetch;for(const k of Object.keys(process.env))if(!(k in env))delete process.env[k];Object.assign(process.env,env);resetJsonStorageForTests();resetCatalogReadCachesForTests();resetSharedBudgetPriceCache();await fs.rm(dir,{recursive:true,force:true});}
});
