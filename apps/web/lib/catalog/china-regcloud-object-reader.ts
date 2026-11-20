import {createHash} from 'node:crypto';
import type {JsonReadResult} from '../data';
import {ObjectJsonStorage} from '../data';
import type {ChinaRuntimeReady} from './china-stage-runtime-files';

export const CHINA_PUBLIC_CONTROL='catalog/independent-market-public-v1/china/control.json';
const STAGED='catalog/private-market-stage-v1/china/',LOCAL='catalog/market-activation-fixture-v1/china/',LOCAL_CONTROL=LOCAL+'control.json';
const ORIGIN='https://s3.regru.cloud',SHA=/^[a-f0-9]{64}$/,RUN=/^[a-z0-9][a-z0-9-]{4,63}$/,GEN=/^gen_\d{13}_[a-z0-9]{1,64}$/;
const safe=(v:string)=>/^[a-zA-Z0-9_.-]+$/.test(v)&&v!=='.'&&v!=='..';
export const chinaObjectDigest=(x:unknown)=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const fail=(why:string):never=>{throw Error('china_own_regcloud:'+why);};
const parse=<T>(data:Buffer)=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(data)) as T;
const digest=(data:Buffer)=>createHash('sha256').update(data).digest('hex');
export type ChinaPublicRef={runId:string;generationId:string;readySha256:string};
export type ChinaLegacyRollback={kind:'legacy-unmodified';generationId:string;manifestSha256:string};
export type ChinaPointerTarget=ChinaPublicRef|ChinaLegacyRollback;
export type ChinaPublicState={version:1;market:'china';revision:number;active:ChinaPointerTarget;previous:ChinaPointerTarget|null};
type DurableReady={version:1;kind:'china-private-durable-stage-ready-v1';runId:string;market:'china';stageRoot:string;generationId:string;
 archiveSha256:string;runtimeReadySha256:string;permitSha256:string;manifestSha256:string;pricingReceiptSha256:string;
 activeControlSha256:string;expectedChinaPublicBaseSha256:string;admittedRows:number;validUntil:number;
 artifacts:{count:number;bytes:number;orderedSha256:string};publicationAuthorized:false;cursorAdvanceAuthorized:false};
export type ChinaConfiguredStorageScope={endpoint:string;bucket:string;prefix:string;region:string};
export function readConfiguredRegcloudScope():ChinaConfiguredStorageScope{
 const endpoint=(process.env.YC_OBJECT_STORAGE_ENDPOINT??'').replace(/\/+$/g,'');
 const bucket=process.env.YC_OBJECT_STORAGE_BUCKET??'';
 const prefix=(process.env.YC_OBJECT_STORAGE_PREFIX??'').replace(/^\/+|\/+$/g,'');
 const region=process.env.YC_OBJECT_STORAGE_REGION||'ru-central1';
 if(endpoint!==ORIGIN||!/^[a-z0-9][a-z0-9.-]{2,63}$/.test(bucket)||(prefix&&!prefix.split('/').every(safe))||!safe(region)||
    !process.env.YC_OBJECT_STORAGE_ACCESS_KEY_ID||!process.env.YC_OBJECT_STORAGE_SECRET_ACCESS_KEY)return fail('storage_scope');
 return {endpoint,bucket,prefix,region};
}
function credentials(){return chinaObjectDigest([process.env.YC_OBJECT_STORAGE_ACCESS_KEY_ID,process.env.YC_OBJECT_STORAGE_SECRET_ACCESS_KEY]);}
const clock=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>0;
export function validChinaPublicRef(ref:ChinaPublicRef){
 return !!ref&&typeof ref.runId==='string'&&RUN.test(ref.runId)&&typeof ref.generationId==='string'&&GEN.test(ref.generationId)&&
  typeof ref.readySha256==='string'&&SHA.test(ref.readySha256);
}
export function chinaLegacyRollback(target:ChinaPointerTarget):target is ChinaLegacyRollback{
 return !!target&&typeof target==='object'&&'kind' in target&&target.kind==='legacy-unmodified';
}
export function validChinaPointerTarget(target:ChinaPointerTarget){
 return chinaLegacyRollback(target)?typeof target.generationId==='string'&&GEN.test(target.generationId)&&
  typeof target.manifestSha256==='string'&&SHA.test(target.manifestSha256)&&Object.keys(target).length===3:
  validChinaPublicRef(target)&&Object.keys(target).length===3;
}
/** Only bootstrap/rollback authority and explicitly active legacy mode can
 * call this. The normal new China runtime does not read the global manifest. */
export async function assertChinaLegacyRollback(storage:ObjectJsonStorage,marker:ChinaLegacyRollback){
 if(!chinaLegacyRollback(marker)||!validChinaPointerTarget(marker))return fail('legacy_rollback_ref');
 const object=await storage.getBinaryBounded('catalog/manifest.json',4*1024*1024);
 if(object.checksum!==marker.manifestSha256)return fail('legacy_manifest_changed');
 const global=parse<{version:number;generationId:string;markets?:{china?:{count:number;chunks:unknown[]}}}>(object.data);
 const china=global?.markets?.china;
 if(global?.version!==2||global.generationId!==marker.generationId||!clock(china?.count)||!Array.isArray(china?.chunks)||!china.chunks.length)
  return fail('legacy_china_unqualified');
}
export function chinaRegcloudRuntimeConfigured(){
 return process.env.AVTOCENA_CHINA_REGCLOUD_RUNTIME==='1';
}
export async function readChinaPublicState(storage:ObjectJsonStorage){
 const obj=await storage.readScopedControl(CHINA_PUBLIC_CONTROL);
 if(!obj)return null;
 const state=parse<ChinaPublicState>(obj.data);
 if(state?.version!==1||state.market!=='china'||!clock(state.revision)||!validChinaPointerTarget(state.active)||
    (state.previous!==null&&(!validChinaPointerTarget(state.previous)||state.previous.generationId===state.active.generationId)))
  return fail('control_integrity');
 return {state,etag:obj.etag,checksum:obj.checksum};
}
const minted=new WeakSet<ChinaStageObjectFiles>();
export type ChinaStageObjectFiles=Readonly<{
 ready:Readonly<ChinaRuntimeReady>;
 readySha256:string;
 durable:Readonly<DurableReady>;
 getBinary(key:string):Promise<{data:Buffer;size:number;checksum:string}>;
 readJsonWithMeta<T>(key:string,fallback:T):Promise<JsonReadResult<T>>;
 assertPointer():Promise<void>;
}>;
export function assertChinaStageObjectFiles(handle:ChinaStageObjectFiles){
 if(!minted.has(handle)||Date.now()>=handle.durable.validUntil||Date.now()>=handle.ready.validUntil)return fail('stage_authority');
}
export async function openChinaStageObjectFiles(storage:ObjectJsonStorage,reference:ChinaPublicRef,assertPointer:()=>Promise<void>){
 const ref=Object.freeze({...reference});
 if(!(storage instanceof ObjectJsonStorage)||!validChinaPublicRef(ref)||typeof assertPointer!=='function')return fail('scope');
 const configKey=chinaObjectDigest(readConfiguredRegcloudScope()),credentialKey=credentials(),root=STAGED+ref.runId+'/';
 const check=()=>{
  if(chinaObjectDigest(readConfiguredRegcloudScope())!==configKey||credentials()!==credentialKey)return fail('storage_changed');
 };
 const read=async(relative:string,max=4*1024*1024)=>{
  check();
  if(!relative.split('/').every(safe))return fail('key_scope');
  const obj=await storage.getBinaryBounded(root+relative,max);
  check();return obj;
 };
 const staged=await read('READY.json',32*1024);
 if(staged.checksum!==ref.readySha256)return fail('ready_sha');
 const durable=parse<DurableReady>(staged.data);
 if(durable?.version!==1||durable.kind!=='china-private-durable-stage-ready-v1'||durable.runId!==ref.runId||
    durable.stageRoot!==root||durable.market!=='china'||durable.generationId!==ref.generationId||
    durable.publicationAuthorized!==false||durable.cursorAdvanceAuthorized!==false||
    ![durable.archiveSha256,durable.runtimeReadySha256,durable.permitSha256,durable.manifestSha256,durable.pricingReceiptSha256,
     durable.activeControlSha256,durable.expectedChinaPublicBaseSha256,durable.artifacts?.orderedSha256].every(x=>SHA.test(x??''))||
    !clock(durable.admittedRows)||!clock(durable.artifacts.count)||!clock(durable.artifacts.bytes)||!clock(durable.validUntil)||
    Date.now()>=durable.validUntil)return fail('ready_scope');
 const stageRuntime=await read('runtime-ready.json',8192);
 if(stageRuntime.checksum!==durable.runtimeReadySha256)return fail('runtime_ready_sha');
 const ready=parse<ChinaRuntimeReady>(stageRuntime.data);
 if(ready?.version!==1||ready.kind!=='china-isolated-runtime-ready'||ready.archiveSha256!==durable.archiveSha256||
    ready.generationId!==durable.generationId||ready.manifestSha256!==durable.manifestSha256||ready.activeControlSha256!==durable.activeControlSha256||
    ready.pricingReceiptSha256!==durable.pricingReceiptSha256||ready.admittedRows!==durable.admittedRows||
    !clock(ready.validUntil)||ready.validUntil<durable.validUntil)return fail('runtime_ready_scope');
 const data=async(key:string)=>{
  assertChinaStageObjectFiles(handle);
  if(key!==LOCAL_CONTROL&&!key.startsWith(LOCAL+'generations/'+ref.generationId+'/'))return fail('key_scope');
  const result=await read('objects/'+key,key===LOCAL_CONTROL?32*1024:4*1024*1024);
  if(key===LOCAL_CONTROL&&result.checksum!==ready.activeControlSha256)return fail('stage_control_sha');
  assertChinaStageObjectFiles(handle);return result;
 };
 const handle:ChinaStageObjectFiles=Object.freeze({ready:Object.freeze(ready),readySha256:ref.readySha256,durable:Object.freeze(durable),
  getBinary:data,
  async readJsonWithMeta<T>(key:string,_fallback:T):Promise<JsonReadResult<T>>{
   if(key!==LOCAL_CONTROL)return fail('control_scope');
   const body=await data(key);
   return {found:true,value:parse<T>(body.data),etag:'"'+body.checksum+'"'};
  },
  async assertPointer(){assertChinaStageObjectFiles(handle);check();await assertPointer();check();assertChinaStageObjectFiles(handle);}
 });
 minted.add(handle);await handle.assertPointer();
 return handle;
}
export async function openConfiguredChinaRegcloudFiles(){
 if(!chinaRegcloudRuntimeConfigured())return fail('disabled');
 const scopeKey=chinaObjectDigest(readConfiguredRegcloudScope()),credentialKey=credentials();
 const storage=new ObjectJsonStorage(),own=await readChinaPublicState(storage);
 if(!own)return fail('control_missing');
 const guard=async()=>{
  if(!chinaRegcloudRuntimeConfigured()||chinaObjectDigest(readConfiguredRegcloudScope())!==scopeKey||credentialKey!==credentials())return fail('storage_changed');
  const current=await readChinaPublicState(storage);
  // Fenced to public revision AND the corresponding opaque storage ETag.
  if(!current||current.checksum!==own.checksum||current.etag!==own.etag)return fail('active_cut_changed');
 };
 if(chinaLegacyRollback(own.state.active)){
  await guard();await assertChinaLegacyRollback(storage,own.state.active);await guard();
  return null; // explicit authenticated rollback, never a failed new-cut read.
 }
 return openChinaStageObjectFiles(storage,own.state.active,guard);
}
