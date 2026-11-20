import {createHash} from 'node:crypto';
import {ObjectJsonStorage,StorageConflictError} from '../data';
import {assertStageChinaFiles,type StageChinaFiles} from './china-stage-runtime-files';
import {openIndependentChinaStage,type IndependentMarketPaper} from './independent-market-activation-fixture';
import {verifyIndependentChinaPreparedArtifacts} from './independent-china-prepared-fixture';

export const CHINA_REGCLOUD_STAGE_ORIGIN='https://s3.regru.cloud';
const LOCAL_ROOT='catalog/market-activation-fixture-v1/china/';
const REMOTE_ROOT='catalog/private-market-stage-v1/china/';
const SHA=/^[a-f0-9]{64}$/,GEN=/^gen_\d{13}_[a-z0-9]{1,64}$/,RUN=/^[a-z0-9][a-z0-9-]{4,63}$/;
const MAX_OBJECT=4*1024*1024,MAX_FILES=100_000,MAX_BYTES=96*1024**3;
const json=(x:unknown)=>Buffer.from(JSON.stringify(x));
const digest=(b:Buffer|string)=>createHash('sha256').update(b).digest('hex');
const fail=(reason:string):never=>{throw Error('china_durable_stage:'+reason);};
const safe=(value:string)=>/^[a-zA-Z0-9_.-]+$/.test(value)&&value!=='.'&&value!=='..';
const normPrefix=(s:string)=>s.replace(/^\/+|\/+$/g,'');
export type ChinaDurableStagePermit={
 version:1;kind:'china-own-regcloud-private-stage-v1';market:'china';runId:string;
 storage:{endpoint:string;bucket:string;prefix:string;region:string};
 generationId:string;archiveSha256:string;runtimeReadySha256:string;expectedChinaPublicBaseSha256:string;
 minAdmittedRows:number;maxArtifactBytes:number;validUntil:number;
 expectedOwnerApprovalSha256:string;publicationAuthorized:false;cursorAdvanceAuthorized:false;
};
function registry(){
 return {endpoint:(process.env.YC_OBJECT_STORAGE_ENDPOINT??'').replace(/\/+$/g,''),
  bucket:process.env.YC_OBJECT_STORAGE_BUCKET??'',prefix:normPrefix(process.env.YC_OBJECT_STORAGE_PREFIX??''),
  region:process.env.YC_OBJECT_STORAGE_REGION||'ru-central1'};
}
function artifactRelative(relative:string){
 if(!relative.split('/').every(safe))return false;
 if(relative==='binding.json'||/^(?:ready|inventory|prices|search)-[a-f0-9]{64}\.json$/.test(relative))return true;
 return /^prepared\/(?:offers\/china\/chunk-\d{4,10}\.part-\d{1,3}\.json|indexes\/(?:prepared-price-cards-v1\/china\/|prepared-china-read-v1\/)[a-z0-9._\/-]+\.json)$/.test(relative);
}

/** Existing native signed object client, bound to a single private run.
 * No route, environment switch, public CAS/API, delete, or generic storage copy.
 * The deployed worker must provide its already-approved narrow authority
 * callback; this module never creates/changes a credential or permission. */
export async function transferChinaPrivateStage({
 storage,files,permit,expectedPermitSha256,assertApprovedRunner,
}:{
 storage:ObjectJsonStorage;files:StageChinaFiles;permit:ChinaDurableStagePermit;expectedPermitSha256:string;
 assertApprovedRunner:(frozen:Readonly<ChinaDurableStagePermit>,sha256:string)=>Promise<void>;
}){
 assertStageChinaFiles(files);
 const p=Object.freeze({...structuredClone(permit),storage:Object.freeze({...permit.storage})});
 if(!(storage instanceof ObjectJsonStorage)||typeof assertApprovedRunner!=='function'||!SHA.test(expectedPermitSha256)||
    digest(json(p))!==expectedPermitSha256||p.version!==1||p.kind!=='china-own-regcloud-private-stage-v1'||p.market!=='china'||
    !RUN.test(p.runId)||!GEN.test(p.generationId)||p.generationId!==files.ready.generationId||p.archiveSha256!==files.ready.archiveSha256||
    p.runtimeReadySha256!==files.readySha256||![p.archiveSha256,p.runtimeReadySha256,p.expectedChinaPublicBaseSha256,
      p.expectedOwnerApprovalSha256].every(x=>SHA.test(x??''))||
    p.publicationAuthorized!==false||p.cursorAdvanceAuthorized!==false||
    !Number.isSafeInteger(p.validUntil)||Date.now()>=p.validUntil||p.validUntil>files.ready.validUntil||
    !Number.isSafeInteger(p.minAdmittedRows)||p.minAdmittedRows<1||p.minAdmittedRows>files.ready.admittedRows||
    !Number.isSafeInteger(p.maxArtifactBytes)||p.maxArtifactBytes<1||p.maxArtifactBytes>MAX_BYTES||
    p.storage.endpoint!==CHINA_REGCLOUD_STAGE_ORIGIN||!/^[a-z0-9][a-z0-9.-]{2,63}$/.test(p.storage.bucket)||
    (p.storage.prefix!==''&&!p.storage.prefix.split('/').every(safe))||!safe(p.storage.region))return fail('permit');
 const runRoot=REMOTE_ROOT+p.runId+'/',localGeneration=LOCAL_ROOT+'generations/'+p.generationId+'/';
 const configSnapshot=digest(json(registry())),credentialsSnapshot=digest(json([process.env.YC_OBJECT_STORAGE_ACCESS_KEY_ID,process.env.YC_OBJECT_STORAGE_SECRET_ACCESS_KEY]));
 const auth=async()=>{
  assertStageChinaFiles(files);
  if(Date.now()>=p.validUntil||digest(json(registry()))!==configSnapshot||
     Object.entries(p.storage).some(([k,value])=>registry()[k as keyof ReturnType<typeof registry>]!==value)||
     digest(json([process.env.YC_OBJECT_STORAGE_ACCESS_KEY_ID,process.env.YC_OBJECT_STORAGE_SECRET_ACCESS_KEY]))!==credentialsSnapshot)
   return fail('storage_scope_or_expiry');
  await assertApprovedRunner(p,expectedPermitSha256);
  if(Date.now()>=p.validUntil||digest(json(registry()))!==configSnapshot||
     digest(json([process.env.YC_OBJECT_STORAGE_ACCESS_KEY_ID,process.env.YC_OBJECT_STORAGE_SECRET_ACCESS_KEY]))!==credentialsSnapshot)
   return fail('storage_scope_or_expiry');
 };
 await auth();
 const active=await openIndependentChinaStage(files).openChinaPrepared();
 const uploaded=new Set<string>();
 const running=createHash('sha256').update('china-regcloud-private-stage-ordered-objects-v1\n');
 let objectCount=0,artifactBytes=0,resumedObjects=0,nativeParts=0,projectionParts=0,priceBlocks=0;
 const immutable=async(relative:string,body:Buffer)=>{
  if(!relative.split('/').every(safe)||!body.length||body.length>MAX_OBJECT)return fail('object_bound');
  const key=runRoot+relative,sha=digest(body);
  await auth();
  try{await storage.createPrivateStageObject(key,body);}
  catch(error){if(!(error instanceof StorageConflictError))throw error;resumedObjects++;}
  await auth();
  const found=await storage.getBinaryBounded(key,body.length);
  if(found.checksum!==sha||!found.data.equals(body))return fail('immutable_conflict');
  return sha;
 };
 const transfer=async(relative:string,body:Buffer)=>{
  if(++objectCount>MAX_FILES||(artifactBytes+=body.length)>p.maxArtifactBytes)return fail('artifact_budget');
  const sha=await immutable(relative,body);
  running.update(JSON.stringify([relative,body.length,sha])+'\n');
 };
 // Transfer only the exact dependencies requested by the existing native
 // whole-cut verifier. In the same pass, every expected hash is verified on
 // local bytes before conditional upload/readback. No directory glob or
 // second remote scan; corrupt/unrelated files can never issue READY.
 const evidence={} as Record<'inventory'|'prices'|'search',IndependentMarketPaper>;
 const localVerified=async(relative:string,expected:string)=>{
  if(!artifactRelative(relative)||!SHA.test(expected))return fail('artifact_binding');
  const data=(await files.getBinary(localGeneration+relative)).data;
  if(digest(data)!==expected)return fail('local_artifact_integrity');
  if(!uploaded.has(relative)){
   await transfer('objects/'+localGeneration+relative,data);uploaded.add(relative);
   if(relative.includes('/offers/china/'))nativeParts++;
   if(relative.includes('/projections/'))projectionParts++;
   if(relative.includes('/prepared-price-cards-v1/china/'))priceBlocks++;
  }
  return data;
 };
 const m=files.ready.manifestSha256;
 await localVerified('binding.json',digest(json({version:1,market:'china',generationId:p.generationId,manifestSha256:m})));
 await localVerified('ready-'+m+'.json',m);
 for(const role of ['inventory','prices','search'] as const){
  const sha=active.cut.papers[role];
  evidence[role]=JSON.parse((await localVerified(role+'-'+sha+'.json',sha)).toString('utf8'));
 }
 const generationRoot='catalog/generations/'+p.generationId+'/';
 await verifyIndependentChinaPreparedArtifacts(active.cut,evidence,async(key,checksum)=>{
  if(!key.startsWith(generationRoot)||!checksum)return fail('unbound_dependency');
  return localVerified('prepared/'+key.slice(generationRoot.length),checksum);
 });
 if(!nativeParts||nativeParts!==projectionParts||nativeParts!==priceBlocks)return fail('artifact_set');
 await active.assertCurrent();
 await transfer('objects/'+LOCAL_ROOT+'control.json',(await files.getBinary(LOCAL_ROOT+'control.json')).data);
 const readyBytes=json(files.ready);
 if(digest(readyBytes)!==files.readySha256)return fail('runtime_ready_bytes');
 await transfer('runtime-ready.json',readyBytes);
 const result={version:1,kind:'china-private-durable-stage-ready-v1',market:'china',runId:p.runId,stageRoot:runRoot,
  generationId:p.generationId,archiveSha256:p.archiveSha256,runtimeReadySha256:p.runtimeReadySha256,permitSha256:expectedPermitSha256,
  manifestSha256:files.ready.manifestSha256,activeControlSha256:files.ready.activeControlSha256,
  expectedChinaPublicBaseSha256:p.expectedChinaPublicBaseSha256,admittedRows:files.ready.admittedRows,
  sourceCursor:active.cut.source.cursor,pricingReceiptSha256:files.ready.pricingReceiptSha256,validUntil:p.validUntil,
  artifacts:{count:objectCount,bytes:artifactBytes,orderedSha256:running.digest('hex'),nativeParts,projectionParts,priceBlocks},
  publicationAuthorized:false,cursorAdvanceAuthorized:false};
 await active.assertCurrent();
 // Never published/current/control outside this private run. READY written last.
 const readySha256=await immutable('READY.json',json(result));
 return {ready:result,readySha256,resumedObjects};
}
