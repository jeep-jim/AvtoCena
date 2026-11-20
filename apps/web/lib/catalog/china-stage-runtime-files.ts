import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import type {JsonReadResult} from '../data';

const ROOT='catalog/market-activation-fixture-v1/china/',CONTROL=ROOT+'control.json';
const SHA=/^[a-f0-9]{64}$/,GEN=/^gen_\d{13}_[a-z0-9]{1,64}$/,STAGE=/^avtocena-china-shadow-[a-z0-9-]{1,45}$/;
const fail=(why:string):never=>{throw Error('china_stage_files:'+why);};
const digest=(body:Buffer)=>createHash('sha256').update(body).digest('hex');
const safe=(name:string)=>name!=='.'&&name!=='..'&&/^[a-zA-Z0-9_.-]+$/.test(name);
const parse=<T>(body:Buffer)=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(body)) as T;
const minted=new WeakSet<StageChinaFiles>();
export type ChinaRuntimeReady={
 version:1;kind:'china-isolated-runtime-ready';archiveSha256:string;generationId:string;
 manifestSha256:string;activeControlSha256:string;pricingReceiptSha256:string;admittedRows:number;validUntil:number;
};
type Metrics={reads:number;bytes:number;maxBytes:number;controls:number;projections:number;nativeParts:number;priceBlocks:number};
export type StageChinaFiles=Readonly<{
 ready:Readonly<ChinaRuntimeReady>;
 root:string;readySha256:string;
 getBinary(key:string):Promise<{data:Buffer;size:number;checksum:string}>;
 readJsonWithMeta<T>(key:string,fallback:T):Promise<JsonReadResult<T>>;
 metrics():Metrics;
}>;
export function assertStageChinaFiles(handle:StageChinaFiles){
 if(!minted.has(handle)||Date.now()>=handle.ready.validUntil)return fail('authority');
}
/** This is a read-only serving backend, not a socket, CAS writer or production
 * toggle. Caller must supply a trusted, private staging parent and exact
 * separately observed readiness hashes. Storage credentials are unused. */
export async function openStageChinaFiles(input:{
 allowedParent:string;root:string;readySha256:string;archiveSha256:string;
 expectedGenerationId:string;expectedFxSha256:string;expectedAdmittedRows:number;sourceValidUntil:number;
}):Promise<StageChinaFiles>{
 const {allowedParent,root}=input;
 if(!path.isAbsolute(allowedParent)||allowedParent==='/'||path.normalize(allowedParent)!==allowedParent||
    !path.isAbsolute(root)||path.normalize(root)!==root||path.dirname(root)!==allowedParent||!STAGE.test(path.basename(root))||
    !SHA.test(input.readySha256)||!SHA.test(input.archiveSha256)||
    await fs.realpath(allowedParent)!==allowedParent||await fs.realpath(root)!==root)return fail('allowlist');
 const rootStat=await fs.lstat(root),parentStat=await fs.lstat(allowedParent);
 const owner=process.getuid?.();
 if(!rootStat.isDirectory()||!parentStat.isDirectory()||rootStat.uid!==owner||parentStat.uid!==owner||
    rootStat.mode&0o077||parentStat.mode&0o022)return fail('private_root');
 const meters:Metrics={reads:0,bytes:0,maxBytes:0,controls:0,projections:0,nativeParts:0,priceBlocks:0};
 async function read(rel:string,limit:number){
  const file=path.join(root,rel);
  if(!rel.split('/').every(safe)||await fs.realpath(file)!==file)return fail('file_scope');
  const h=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
   const a=await h.stat();
   if(!a.isFile()||a.nlink!==1||a.uid!==owner||(a.mode&0o022)||a.size<1||a.size>limit)return fail('file_bound');
   const data=await h.readFile(),b=await h.stat();
   if(data.length!==a.size||a.size!==b.size||a.mtimeMs!==b.mtimeMs||a.ctimeMs!==b.ctimeMs)return fail('file_changed');
   meters.reads++;meters.bytes+=data.length;meters.maxBytes=Math.max(meters.maxBytes,data.length);
   return data;
  }finally{await h.close();}
 }
 if((await read('.scope',256)).toString('utf8')!=='avtocena-china-archive-shadow-v1')return fail('marker');
 const readyBytes=await read('runtime-ready.json',8192);
 if(digest(readyBytes)!==input.readySha256)return fail('readiness_sha');
 const ready=parse<ChinaRuntimeReady>(readyBytes);
 if(ready?.version!==1||ready.kind!=='china-isolated-runtime-ready'||ready.archiveSha256!==input.archiveSha256||
    !GEN.test(ready.generationId)||ready.generationId!==input.expectedGenerationId||ready.pricingReceiptSha256!==input.expectedFxSha256||
    !SHA.test(ready.manifestSha256)||!SHA.test(ready.activeControlSha256)||!SHA.test(ready.pricingReceiptSha256)||
    !Number.isSafeInteger(ready.admittedRows)||ready.admittedRows<1||ready.admittedRows!==input.expectedAdmittedRows||
    !Number.isSafeInteger(ready.validUntil)||ready.validUntil>input.sourceValidUntil||Date.now()>=ready.validUntil)return fail('readiness_scope');
 const data=async(key:string)=>{
  assertStageChinaFiles(handle);
  // No relative caller-controlled filename, foreign market or shared alias.
  const selected=key.startsWith(ROOT+'generations/'+ready.generationId+'/');
  if(key!==CONTROL&&!selected)return fail('key_scope');
  const body=await read('objects/'+key,key===CONTROL?32*1024:4*1024*1024);
  const checksum=digest(body);
  if(key===CONTROL){meters.controls++;if(checksum!==ready.activeControlSha256)return fail('active_changed');}
  if(key.includes('/projections/'))meters.projections++;
  if(key.includes('/offers/china/'))meters.nativeParts++;
  if(key.includes('/prepared-price-cards-v1/china/'))meters.priceBlocks++;
  assertStageChinaFiles(handle);
  return {data:body,size:body.length,checksum};
 };
 const handle:StageChinaFiles=Object.freeze({
  ready:Object.freeze(ready),root,readySha256:input.readySha256,getBinary:data,
  async readJsonWithMeta<T>(key:string,_fallback:T){
   if(key!==CONTROL)return fail('control_scope');
   // A configured stage is never an unconfigured legacy fallback.
   const body=await data(key);
   return {value:parse<T>(body.data),etag:'"'+body.checksum+'"',found:true};
  },
  metrics:()=>({...meters}),
 });
 minted.add(handle);
 await data(CONTROL);
 return handle;
}
