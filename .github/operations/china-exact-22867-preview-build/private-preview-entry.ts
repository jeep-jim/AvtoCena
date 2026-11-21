/** Isolated, exact-source proof before public control CAS. Not an HTTP server. */
import {createHash} from 'node:crypto';
import {assertQuarantineUntouched} from 'china-preview-scope-guard';
import {constants} from 'node:fs';
import {open} from 'node:fs/promises';
import {offerCardPath} from './apps/web/lib/catalog/offer-url';
import {ObjectJsonStorage} from './apps/web/lib/data';
import {openChinaStageObjectFiles,readConfiguredRegcloudScope,validChinaPublicRef,
  type ChinaConfiguredStorageScope,type ChinaPublicRef} from './apps/web/lib/catalog/china-regcloud-object-reader';
import {readPreparedChinaFixtureOffer,readPreparedChinaIndexedModel,withPreparedChinaRegcloudPreview} from './apps/web/lib/catalog/prepared-china-http-fixture';

const SHA=/^[a-f0-9]{64}$/;
const BUILD='22867cbcfaee27b2e8917b6bf880e44827f67b60',LEGACY='4654386ca34f04041effe31f38259d0fae9c396ecda35c364e3a18dd125a4b90';
const LIMIT=96, BYTES=64*1024*1024, MAX_MS=60_000;
const hash=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
class Refuse extends Error {}
const check=(v:unknown,e:string)=>{if(!v)throw new Refuse(e);};
const EARLY=['EACCES','EPERM','ENOENT','ENOTDIR','ELOOP'];
function safePreviewFailure(e:unknown){
 const err=e as NodeJS.ErrnoException|undefined,reason=err?.message??'';
 if(e instanceof Refuse)return reason; // Refuse labels are literal and host allowlisted.
 if(err?.code&&EARLY.includes(err.code))return 'fs_'+err.code.toLowerCase();
 if(/^preview_forbidden_(?:next_headers|next_cache|next_server|image|geoip)$/.test(reason))return reason;
 if(err?.name==='TimeoutError'||err?.name==='AbortError')return 'request_timeout';
 if(/^china_own_regcloud:[a-z0-9_]+$/.test(reason))return 'storage_'+reason.slice('china_own_regcloud:'.length);
 const http=reason.match(/^object_storage_(?:binary_read|control_read|GET)_(\d{3})(?::[^\r\n]*)?$/);
 if(http)return 'storage_http_'+http[1];
 if(/^object_storage_(?:response_limit|response_timeout|read_deadline|GET_unreachable)(?::[^\r\n]*)?$/.test(reason))
  return 'storage_transport';
 return 'exact_reader_refused';
}
const validCount=(n:unknown):n is number=>Number.isSafeInteger(n)&&Number(n)>0&&Number(n)<=10_000_000;
type Grant={version:1;kind:'china-private-preview-grant-v1';stage:ChinaPublicRef;storage:ChinaConfiguredStorageScope;
 appSha:string;legacyRuntimeSha256:string;imageSha256:string;expiresAt:number;archiveSha256:string;manifestSha256:string;
 pricingReceiptSha256:string;admittedRows:number;make:string;model:string;expectedModelCount?:number;
 publicationAuthorized:false;cursorAdvanceAuthorized:false};
export function readGrant(raw:Buffer,expected:string,now=Date.now()):Grant{
 check(SHA.test(expected)&&raw.length>0&&raw.length<=8192&&hash(raw)===expected,'grant_bytes');
 const g=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw)) as Grant;
 check(g?.version===1&&g.kind==='china-private-preview-grant-v1'&&g.appSha===BUILD&&g.legacyRuntimeSha256===LEGACY&&
   ['archiveSha256','manifestSha256','pricingReceiptSha256','imageSha256'].every(k=>SHA.test((g as any)[k]??''))&&
   validChinaPublicRef(g.stage)&&Object.keys(g.stage).length===3&&g.publicationAuthorized===false&&g.cursorAdvanceAuthorized===false&&
   validCount(g.admittedRows)&&Number.isSafeInteger(g.expiresAt)&&g.expiresAt>now&&g.expiresAt<=now+15*60_000&&
   (g.expectedModelCount===undefined||validCount(g.expectedModelCount)&&g.expectedModelCount<=g.admittedRows),'grant_scope');
 check(['make','model'].every(k=>typeof (g as any)[k]==='string'&&/^[^,|\p{C}]{1,80}$/u.test((g as any)[k])&&
   (g as any)[k]===(g as any)[k].trim()),'grant_selector');
 check(g.storage&&Object.keys(g.storage).length===4&&g.storage.endpoint==='https://s3.regru.cloud'&&
   typeof g.storage.prefix==='string'&&typeof g.storage.region==='string'&&typeof g.storage.bucket==='string','grant_storage');
 const fields=['version','kind','stage','storage','appSha','legacyRuntimeSha256','imageSha256','expiresAt','archiveSha256','manifestSha256','pricingReceiptSha256','admittedRows','make','model','expectedModelCount','publicationAuthorized','cursorAdvanceAuthorized'];
 check(Object.keys(g).every(k=>fields.includes(k)),'grant_fields');
 return g;
}
async function boundedGrant(file:string){
 check(/^\/[A-Za-z0-9_./-]+$/.test(file),'grant_path');
 const fd=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{
  const st=await fd.stat();
  check(st.isFile()&&st.size>0&&st.size<=8192&&(st.mode&0o022)===0,'grant_file');
  const data=Buffer.alloc(st.size+1),{bytesRead}=await fd.read(data,0,data.length,0);
  check(bytesRead===st.size,'grant_changed');
  return data.subarray(0,bytesRead);
 }finally{await fd.close();}
}
function sameScope(g:Grant){
 const current=readConfiguredRegcloudScope();
 check(Object.entries(current).every(([k,v])=>g.storage[k as keyof ChinaConfiguredStorageScope]===v),'storage_mismatch');
}
type PreviewPhase='grant'|'runtime'|'ready'|'index'|'search'|'detail'|'readback';
export async function runPrivateChinaPreview(file:string,expected:string,onPhase:(p:PreviewPhase)=>void=()=>{}){
 onPhase('grant');
 const g=readGrant(await boundedGrant(file),expected);
 onPhase('runtime');
 check(process.env.AVTOCENA_RELEASE_SHA===BUILD&&process.env.AVTOCENA_CALCULATION_VERSION===LEGACY&&
  process.env.AVTOCENA_CHINA_REGCLOUD_RUNTIME==='0'&&process.env.JSON_STORAGE_DRIVER==='object'&&
  process.env.CATALOG_STORAGE_TIMING!=='1','runtime_env');
 sameScope(g);
 const fetch0=globalThis.fetch, stage='catalog/private-market-stage-v1/china/'+g.stage.runId+'/';
 const prefix='/'+[g.storage.bucket,g.storage.prefix].filter(Boolean).join('/')+'/';
 const watchdog=AbortSignal.timeout(MAX_MS);
 let count=0,bytes=0;
 globalThis.fetch=async(input,init)=>{
  check(typeof input==='string'||input instanceof URL,'net_type');
  const u=new URL(String(input));
  check(u.origin===g.storage.endpoint&&!u.search&&!u.hash&&!u.username&&!u.password&&u.pathname.startsWith(prefix)&&
   init?.method==='GET','net_scope');
  const key=decodeURIComponent(u.pathname.slice(prefix.length));
  check(key==='catalog-editorial/current.json'||key.startsWith(stage)&&
    key.split('/').every(x=>/^[A-Za-z0-9_.-]+$/.test(x)&&x!=='.'&&x!=='..'),'net_object_scope');
  check(++count<=LIMIT&&!watchdog.aborted,'net_bound');
  const each=key==='catalog-editorial/current.json'?8*1024*1024:4*1024*1024;
  const signal=init?.signal?AbortSignal.any([init.signal,watchdog]):watchdog;
  const response=await fetch0(input,{...init,signal,redirect:'error'});
  if(!response.body)return response;
  check(Number(response.headers.get('content-length')||0)<=each,'net_body_bound');
  let total=0;
  const body=response.body.pipeThrough(new TransformStream<Uint8Array,Uint8Array>({transform(chunk,controller){
   total+=chunk.byteLength;bytes+=chunk.byteLength;
   check(total<=each&&bytes<=BYTES,'net_body_bound');controller.enqueue(chunk);
  }}));
  return new Response(body,{status:response.status,statusText:response.statusText,headers:response.headers});
 };
 const assertGrant=async()=>{
  check(!watchdog.aborted&&Date.now()<g.expiresAt&&hash(await boundedGrant(file))===expected,'grant_changed');
  sameScope(g);
 };
 try{
  onPhase('ready');const files=await openChinaStageObjectFiles(new ObjectJsonStorage(),g.stage,assertGrant);
  check(files.durable.archiveSha256===g.archiveSha256&&files.durable.manifestSha256===g.manifestSha256&&
   files.durable.pricingReceiptSha256===g.pricingReceiptSha256&&files.durable.admittedRows===g.admittedRows,'ready_binding');
  return await withPreparedChinaRegcloudPreview(files,async()=>{
   const generationId=g.stage.generationId;
   const query={market:'china',make:g.make,model:g.model,sort:'totalRub' as const,pageSize:1};
   // These are the exact immutable selectors used by the installed web
   // app. No Next Request/Response/auth/global-market fallback is needed
   // for this private proof; compiled HTTP is separately checked after CAS.
   onPhase('index');const tally=await readPreparedChinaIndexedModel(query,true);
   check(tally?.generationId===generationId&&validCount(tally.total)&&tally.total<=g.admittedRows&&
    (g.expectedModelCount===undefined||g.expectedModelCount===tally.total),'indexed_count');
   onPhase('search');const body=await readPreparedChinaIndexedModel(query,false);
   check(body?.generationId===generationId&&body.total===tally!.total&&tally!.items.length===0&&
    body.items.length===1,'list_count_parity');
   const row=body!.items[0];
   check(row.market==='china'&&row.preparedChinaSelection?.generationId===generationId&&
    /^[a-f0-9]{24}$/.test(row.id)&&Number.isSafeInteger(row.totalRub)&&row.totalRub>0,'card_price');
   onPhase('detail');const detail=await readPreparedChinaFixtureOffer(row.id,undefined,generationId);
   check(detail?.offer?.id===row.id&&detail.offer.totalRub===row.totalRub,'card_price_parity');
   onPhase('readback');await assertGrant();await files.assertPointer();assertQuarantineUntouched();
   const canonicalCardUri=offerCardPath(row);
   const u=new URL(canonicalCardUri,'http://127.0.0.1');
   check(u.origin==='http://127.0.0.1'&&u.pathname.startsWith('/cars/offer/'+row.id+'/')&&
      [...u.searchParams].length===2&&u.searchParams.get('market')==='china'&&u.searchParams.get('preparedCut')===generationId,'card_uri');
   return {canonicalCardUri,version:1,kind:'private-china-candidate-readback' ,readySha256:g.stage.readySha256,generationId,
    buildSha256:g.imageSha256,checkedAt:Date.now(),cardId:row.id,listRub:row.totalRub,detailRub:detail!.offer!.totalRub,filteredCount:body!.total};
  });
 }catch(e){assertQuarantineUntouched();throw e;}finally{globalThis.fetch=fetch0;}
}

if(process.argv[1]&&require.main===module){
 let phase:PreviewPhase='grant';
 runPrivateChinaPreview(process.argv[2]||'',process.argv[3]||'',p=>{phase=p;}).then(x=>console.log(JSON.stringify(x))).catch(e=>{
  console.error(JSON.stringify({kind:'private-china-candidate-refused',phase,reason:safePreviewFailure(e)}));
  process.exitCode=2;
 });
}
