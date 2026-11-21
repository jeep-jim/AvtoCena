/** Place alongside exact 22867 checkout for the existing protected reader.
 * No executable trigger, writes, durable slot claim, supplier or pricing. */
import {ObjectJsonStorage} from './apps/web/lib/data';
import {openConfiguredChinaRegcloudFiles,readChinaPublicState,readConfiguredRegcloudScope,CHINA_PUBLIC_CONTROL} from './apps/web/lib/catalog/china-regcloud-object-reader';
import {openIndependentChinaRegcloud} from './apps/web/lib/catalog/independent-market-activation-fixture';
import {REV6,sha} from './daily-core.mjs';
import {V3,validateAcceptedRev6Bootstrap} from './rev6-bootstrap.mjs';
const APP='22867cbcfaee27b2e8917b6bf880e44827f67b60',CALC='4654386ca34f04041effe31f38259d0fae9c396ecda35c364e3a18dd125a4b90';
const SNAP='25abfa4b8f1b053b12a1fcd86f01dc42de65eb8cb74f3863abf1a49115dfdb27',NATIVE_RUN='full-fresh-44871616387-1';
const ROOT='catalog/private-market-stage-v1/china/'+NATIVE_RUN+'/',base='/avtocena-staging-8120751/migration-staging/full-20261011/';
const report=new RegExp('^'+V3.root+'/files/report\\.json/[0-2]-[a-f0-9]{64}\\.json$');
const rep=/^catalog\/provider-replicas\/che168\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\/manifest\.json$/;
const safe=(k:string)=>k.split('/').every(x=>/^[a-zA-Z0-9_.-]+$/.test(x)&&x!=='.'&&x!=='..');
const need=(v:unknown,k:string)=>{if(!v)throw Error('china_daily_native_bootstrap:'+k);};
export async function previewNativeRev6Bootstrap(snap:Buffer,rawProvenance:any){
 const c=readConfiguredRegcloudScope();
 need(Buffer.isBuffer(snap)&&snap.length>0&&snap.length<=128*1024&&sha(snap)===SNAP,'checkout_pinned_snapshot');
 const content=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(snap));
 const snapshotBinding=sha(content); // exact native snapshotBinding JSON.stringify contract
 need(content.version===1&&Number.isSafeInteger(content.initialCursor)&&content.initialCursor>0&&content.initialCursor<=13123821&&Number.isFinite(Date.parse(content.modifiedAt)),'snapshot_config_shape');
 need(process.env.AVTOCENA_RELEASE_SHA===APP&&process.env.AVTOCENA_CALCULATION_VERSION===CALC&&
  process.env.AVTOCENA_CHINA_REGCLOUD_RUNTIME==='1'&&c.endpoint==='https://s3.regru.cloud'&&c.bucket==='avtocena-staging-8120751'&&
  c.prefix==='migration-staging/full-20261011'&&c.region==='us-east-1','existing_signed_native_role');
 let reads=0,bytes=0;const watchdog=AbortSignal.timeout(45_000),fetcher=globalThis.fetch;
 globalThis.fetch=async (request,init)=>{
  const u=new URL(String(request));need(init?.method==='GET'&&u.origin===c.endpoint&&u.pathname.startsWith(base)&&!u.hash&&!u.search&&
   !u.username&&!u.password&&!watchdog.aborted&&++reads<=64,'read_transport');
  const key=decodeURIComponent(u.pathname.slice(base.length)),scoped=key.startsWith(ROOT)?key.slice(ROOT.length):'';
  need(safe(key)&&(key===CHINA_PUBLIC_CONTROL||key===V3.pin||key===V3.root+'/complete.json'||report.test(key)||rep.test(key)||
   ['READY.json','runtime-ready.json','objects/catalog/market-activation-fixture-v1/china/control.json'].includes(scoped)||
   scoped.startsWith('objects/catalog/market-activation-fixture-v1/china/generations/'+REV6.generationId+'/')),'fixed_no_provider_read_port');
  const r=await fetcher(request,{...init,redirect:'error',signal:init?.signal?AbortSignal.any([init.signal,watchdog]):watchdog});
  if(!r.body)return r;
  need((Number(r.headers.get('content-length'))||0)<=4*1024**2,'wire_size');
  let n=0;const body=r.body.pipeThrough(new TransformStream({transform(chunk:Uint8Array,ctl){
   n+=chunk.byteLength;bytes+=chunk.byteLength;need(n<=4*1024**2&&bytes<=32*1024**2,'wire_size');ctl.enqueue(chunk);
  }}));
  return new Response(body,{status:r.status,statusText:r.statusText,headers:r.headers});
 };
 try{
  const storage=new ObjectJsonStorage(),before=await readChinaPublicState(storage);
  need(before?.checksum===REV6.controlSha256&&before.state.revision===REV6.revision,'initial_rev6');
  const stage=await openConfiguredChinaRegcloudFiles();need(stage?.acceptedLegalUntil&&stage.ready.generationId===REV6.generationId,'accepted_rev6');
  const native=await openIndependentChinaRegcloud(stage!).openChinaPrepared();
  const observe=async()=>{
   await native.assertCurrent();
   const cur=await readChinaPublicState(storage);
   need(cur?.checksum===before!.checksum&&cur.etag===before!.etag,'stable_opaque_etag');
   return {accepted:true,revision:cur!.state.revision,controlSha256:cur!.checksum,etag:cur!.etag,
    generationId:native.cut.generationId,readySha256:stage!.readySha256,archiveSha256:stage!.ready.archiveSha256,source:native.cut.source};
  };
  const result=await validateAcceptedRev6Bootstrap({read:async (k:string,max:number)=>(await storage.getBinaryBounded(k,max)).data,observe,rawProvenance,snapshotBinding});
  await observe();
  return {...result,network:{reads,bytes,providerRequests:0,storageWrites:0}};
 }finally{globalThis.fetch=fetcher;}
}
