/** Compile alongside the exact installed 22867 source. No provider, leases, mutation or rescan. */
import {createHash} from 'node:crypto';
import {ObjectJsonStorage} from './apps/web/lib/data';
import {CHINA_PUBLIC_CONTROL,openConfiguredChinaRegcloudFiles,openChinaStageObjectFiles,readChinaPublicState,readConfiguredRegcloudScope}
 from './apps/web/lib/catalog/china-regcloud-object-reader';
import {openIndependentChinaRegcloud} from './apps/web/lib/catalog/independent-market-activation-fixture';
import {openIndependentChinaPrepared} from './apps/web/lib/catalog/independent-china-prepared-fixture';
import {offerCardPath} from './apps/web/lib/catalog/offer-url';
import {exactRemoval as cap,runExactRemovalPreview} from 'china-owner-removal-witness';
const check=(ok:unknown,k:string)=>{if(!ok)throw Error('china_exact_removal_native:'+k);};
const RELEASE='22867cbcfaee27b2e8917b6bf880e44827f67b60',CALC='4654386ca34f04041effe31f38259d0fae9c396ecda35c364e3a18dd125a4b90';
const proper=(path:string)=>path.split('/').every(x=>/^[a-zA-Z0-9_.-]+$/.test(x)&&x!=='.'&&x!=='..');
const ROOT='catalog/private-market-stage-v1/china/';
const PREV='full-fresh-44710087159-1',TARGET='full-fresh-44871616387-1',ORIGIN='https://avtocena.com';
const ROOT_PREFIX='/avtocena-staging-8120751/migration-staging/full-20261011/';
const knownArchive=new RegExp('^'+cap.archiveRoot+'/files/report\\.json/[0-2]-[a-f0-9]{64}\\.json$');
const stageScoped=(k:string,run:string,gen:string)=>{
 const prefix=ROOT+run+'/';if(!k.startsWith(prefix))return false;const child=k.slice(prefix.length);
 return child==='READY.json'||child==='runtime-ready.json'||child==='objects/catalog/market-activation-fixture-v1/china/control.json'||
 child.startsWith('objects/catalog/market-activation-fixture-v1/china/generations/'+gen+'/');
};
const digest=(x:unknown)=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
export async function previewNativeRemoval(){
 const scope=readConfiguredRegcloudScope();
 check(scope.endpoint==='https://s3.regru.cloud'&&scope.bucket==='avtocena-staging-8120751'&&scope.prefix==='migration-staging/full-20261011'&&scope.region==='us-east-1'&&
   process.env.AVTOCENA_CHINA_REGCLOUD_RUNTIME==='1'&&process.env.AVTOCENA_RELEASE_SHA===RELEASE&&process.env.AVTOCENA_CALCULATION_VERSION===CALC,'installed_role');
 const nativeFetch=globalThis.fetch,limit=AbortSignal.timeout(55_000);let reads=0,bytes=0,mainReads=0;const M=1024**2,storage=new ObjectJsonStorage();
 globalThis.fetch=async(input,init)=>{
  const u=new URL(String(input));check(init?.method==='GET'&&u.origin===scope.endpoint&&!u.username&&!u.password&&!u.search&&!u.hash&&
   u.pathname.startsWith(ROOT_PREFIX)&&!limit.aborted&&++reads<=96,'reg_transport');
  const key=decodeURIComponent(u.pathname.slice(ROOT_PREFIX.length));
  check(proper(key)&&(key===CHINA_PUBLIC_CONTROL||key===cap.archiveRoot+'/complete.json'||knownArchive.test(key)||
   stageScoped(key,PREV,cap.currentGeneration)||stageScoped(key,TARGET,cap.newGeneration)),'reg_key_scope');
  const b=await nativeFetch(input,{...init,redirect:'error',signal:init?.signal?AbortSignal.any([limit,init.signal]):limit});
  if(!b.body)return b;
  check((Number(b.headers.get('content-length'))||0)<=4*M,'reg_length');
  let n=0;
  return new Response(b.body.pipeThrough(new TransformStream({transform(c:Uint8Array,ctl){
   n+=c.byteLength;bytes+=c.byteLength;check(n<=4*M&&bytes<=64*M,'reg_body_bound');ctl.enqueue(c);
  }})),{status:b.status,statusText:b.statusText,headers:b.headers});
 };
 const web=async(k:string,n:number,html:boolean)=>{
  const u=new URL(k,ORIGIN);check(k.startsWith('/')&&u.origin===ORIGIN&&!u.hash&&++mainReads<=10,'exact_public_http');
  const b=await nativeFetch(u,{method:'GET',redirect:'error',cache:'no-store',headers:{accept:html?'text/html':'application/json'},signal:limit});
  check(b.status===200&&b.body,'exact_public_status');
  let seen=0;const c:Uint8Array[]=[];for await(const d of b.body!){seen+=d.byteLength;check(seen<=n,'exact_public_body');c.push(d);}
  return new TextDecoder('utf8',{fatal:true}).decode(Buffer.concat(c));
 };
 try{
  const h=JSON.parse(await web('/api/health',64*1024,false));check(h.ok===true&&h.service==='avtocena-web'&&h.releaseSha===RELEASE&&h.calculationVersion===CALC,'public_release');
  let opaque:string|undefined;
  const assertLive=async()=>{
   const c=await readChinaPublicState(storage);check(c&&c.checksum===cap.activeControlSha256&&c.state.revision===5&&c.state.active.generationId===cap.currentGeneration&&
    digest(c.state.active)==='fd69b2d1e628759e7658f13139268f2513fe0afbf7b83b9ebaee1f26233c57a5'&&c.etag&&(opaque===undefined||c.etag===opaque),'active_rev5_changed');
   opaque=c!.etag;
  };
  await assertLive();const old=await openConfiguredChinaRegcloudFiles();check(old?.acceptedLegalUntil&&old.ready.generationId===cap.currentGeneration,'exact_accepted_old');
  const cur=await openIndependentChinaPrepared(openIndependentChinaRegcloud(old!));check(cur?.snapshot.generationId===cap.currentGeneration,'old_snapshot');
  const next=await openChinaStageObjectFiles(storage,{runId:TARGET,generationId:cap.newGeneration,readySha256:cap.readySha256},assertLive);
  check(next.durable.archiveSha256===cap.archiveManifestSha256&&next.durable.manifestSha256===cap.contentManifest&&
    next.durable.pricingReceiptSha256==='cd671bd0ac500d963dcece6b37979bee77084a80af9b2cb7b11b2dc6406c4c1d'&&next.ready.admittedRows===168662,'new_durable_ready');
  const fresh=await openIndependentChinaPrepared(openIndependentChinaRegcloud(next));check(fresh?.snapshot.generationId===cap.newGeneration,'new_snapshot');
  const read=async(k:string,max:number)=>(await storage.getBinaryBounded(k,max)).data;
  const witness=await runExactRemovalPreview({read,assertLive,
   async readOld(id:string){
    const s=cur!.snapshot,l=await s.locate(id);
    if(!l)return {generationId:s.generationId,present:false};
    const p=await(await s.readChunk(l.chunk)).load(l.part),r=(await p.loadNativePart())[l.offset],x=p.projection.items[l.offset];
    check(r?.id===id&&x?.id===id&&r.market==='china','old_native_locator');
    const v=r.operational.che168ActiveVerification as {verifiedAt?:string}|undefined,
     at=Date.parse(v?.verifiedAt??''),others=[r.updatedAt,r.operational.lastSeenAt].filter(x=>typeof x==='string' && x.length>0).map(x=>Date.parse(x as string)),
     t=Math.max(at,...others);
    check(Number.isFinite(t),'old_source_observed_at');
    return {generationId:s.generationId,present:true,offerId:r.id,sourceOfferId:r.sourceOfferId,sourceId:r.sourceId,sourceObservedAt:new Date(t).toISOString(),
     canonicalUri:offerCardPath({...r,preparedChinaSelection:{version:1,generationId:s.generationId}})};
   },
   async assertPublic(uri:string,id:string){
    const text=await web(uri,5*M,true);
    const main=text.match(/<main\b[^>]*\bdata-offer-id="[^"]+"[^>]*>/)?.[0];
    check(main?.match(/\bdata-offer-id="([^"]+)"/)?.[1]===id,'old_native_is_public');
   },
   async readNew(id:string){
    const s=fresh!.snapshot,located=!!(await s.locate(id));await s.assertCurrent();
    return {generationId:s.generationId,readySha256:next.readySha256,manifestSha256:next.durable.manifestSha256,located};
   },
  });
  await assertLive();return {...witness,regReads:reads,regBytes:bytes,publicReads:mainReads};
 }finally{globalThis.fetch=nativeFetch;}
}

if(require.main===module){
 previewNativeRemoval().then(x=>{
  if(x.kind!=='china-authenticated-explicit-terminal-withdrawal-v1'){
   console.error(JSON.stringify({kind:'withdrawal_not_proven',reason:x.reason,scopeReadOnly:true}));
   process.exitCode=2;return;
  }
  // Stable when the exact archived/input/visible witness is re-proven; omit operational counters.
  const {regReads,regBytes,publicReads,checks,...material}=x as any;
  console.log(JSON.stringify(material));
 }).catch(e=>{
  const m=e instanceof Error?e.message:'';
  console.error(JSON.stringify({kind:'withdrawal_read_refused',reason:/^china_exact_removal(?:_native)?:[a-z_0-9]+$/.test(m)?m:'exact_native_read_refused'}));
  process.exitCode=2;
 });
}
