/** Inert overlay to compile against exact installed source with its native readers.
 * No uploader, server, pricing/module calls, external query input or provider access. */
import {createHash} from 'node:crypto';
import {ObjectJsonStorage} from './apps/web/lib/data';
import {CHINA_PUBLIC_CONTROL,openConfiguredChinaRegcloudFiles,readChinaPublicState,readConfiguredRegcloudScope} from './apps/web/lib/catalog/china-regcloud-object-reader';
import {openIndependentChinaRegcloud} from './apps/web/lib/catalog/independent-market-activation-fixture';
import {openIndependentChinaPrepared} from './apps/web/lib/catalog/independent-china-prepared-fixture';
import {DELIVERY_TARIFF_VERSION} from './apps/web/lib/catalog/city-delivery';
import {compilePreparedChinaCompatibilityPredicate} from './apps/web/lib/catalog/storage';
import {createChinaSelectorPage} from './apps/web/lib/catalog/prepared-china-streaming-selector';
import {buildExactFilterBatch} from 'china-owner-index-batch';
const GEN='gen_1795239842026_china44871616387',RUN='full-fresh-44871616387-1';
const READY='c66a7f5e6b0ee3373e8d850195bfe34409adec641f86457d0e2485bc7a07494e';
const CONTROL='8314e862b8aba06c1a72f7ac578cb3d521a7fb09e9944ec9f31441710d00414b';
const RUNTIME_READY='e655826ced21c191d4092152d2f66eff24253d13ed0a174d4b427ed5e6101208';
const MANIFEST='aad60963901acb3019ab9bfab856a702c9ed586b81e9e83b21270e40c542c5f3';
const PRICE='cd671bd0ac500d963dcece6b37979bee77084a80af9b2cb7b11b2dc6406c4c1d';
const RELEASE='22867cbcfaee27b2e8917b6bf880e44827f67b60',CALC='4654386ca34f04041effe31f38259d0fae9c396ecda35c364e3a18dd125a4b90';
const END=1795406675417,ROWS=168662;
const PREFIX='/avtocena-staging-8120751/migration-staging/full-20261011/';
const ROOT='catalog/private-market-stage-v1/china/'+RUN+'/';
const LOCAL='objects/catalog/market-activation-fixture-v1/china/';
const GENROOT=LOCAL+'generations/'+GEN+'/';
const M=1024**2,sha=(x:unknown)=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const need=(v:unknown,k:string)=>{if(!v)throw Error('china_rev6_index_proof:'+k);};
const metaObject=/^(?:binding|(?:ready|inventory|prices|search)-[a-f0-9]{64})\.json$/;
const projectionObject=/^prepared\/indexes\/prepared-china-read-v1\/(?:directory-[a-f0-9]{64}|chunks\/chunk-\d{4,10}-[a-f0-9]{64}|projections\/chunk-\d{4,10}\/\d{1,6}-[a-f0-9]{64})\.json$/;
const allowed=(p:string)=>p===CHINA_PUBLIC_CONTROL||p===ROOT+'READY.json'||p===ROOT+'runtime-ready.json'||p===ROOT+LOCAL+'control.json'||
 (p.startsWith(ROOT+GENROOT)&&[metaObject,projectionObject].some(rule=>rule.test(p.slice((ROOT+GENROOT).length))));
const queries=[
 {market:'china' as const,make:'Haval',sort:'updatedAt' as const},
 {market:'china' as const,make:'Toyota',sort:'updatedAt' as const},
 {market:'china' as const,make:'Haval',model:'Jolion',yearFrom:2022,yearTo:2024,sort:'totalRub' as const},
 {market:'china' as const,make:'Toyota',model:'RAV4',yearFrom:2022,yearTo:2024,sort:'totalRub' as const},
];
export async function verifyExactRev6Index(){
 const scope=readConfiguredRegcloudScope(); const now=Date.now(),signal=AbortSignal.timeout(300_000);
 need(scope.endpoint==='https://s3.regru.cloud'&&scope.bucket==='avtocena-staging-8120751'&&scope.prefix==='migration-staging/full-20261011'&&
 scope.region==='us-east-1'&&process.env.AVTOCENA_CHINA_REGCLOUD_RUNTIME==='1'&&process.env.AVTOCENA_RELEASE_SHA===RELEASE&&
 process.env.AVTOCENA_CALCULATION_VERSION===CALC&&now<END,'role_binding');
 const original=globalThis.fetch;let gets=0,bytes=0,opaque:string|undefined;
 globalThis.fetch=async(input,init)=>{
  const url=new URL(String(input));need(init?.method==='GET'&&url.origin===scope.endpoint&&!url.username&&!url.password&&!url.search&&!url.hash&&
   url.pathname.startsWith(PREFIX)&&!signal.aborted&&++gets<=4096,'get_budget');need(allowed(decodeURIComponent(url.pathname.slice(PREFIX.length))),'key_scope');
  const r=await original(input,{...init,redirect:'error',signal:init?.signal?AbortSignal.any([signal,init.signal]):signal});
  if(!r.body)return r;let n=0;
  need((Number(r.headers.get('content-length'))||0)<=4*M,'content_length');
  return new Response(r.body.pipeThrough(new TransformStream({transform(c:Uint8Array,controller){
   bytes+=c.byteLength;n+=c.byteLength;need(n<=4*M&&bytes<=384*M,'stream_budget');controller.enqueue(c);
  }})),{status:r.status,statusText:r.statusText,headers:r.headers});
 };
 try{
  const store=new ObjectJsonStorage();
  const fence=async()=>{
   const own=await readChinaPublicState(store);need(own?.checksum===CONTROL&&own.state.revision===6&&own.state.active.generationId===GEN&&
    own.state.active.runId===RUN&&own.state.active.readySha256===READY&&!!own.etag&&(!opaque||own.etag===opaque),'control_changed');
   opaque=own!.etag;
  };
  await fence();
  const files=await openConfiguredChinaRegcloudFiles();
  need(files?.readySha256===READY&&files.durable.runtimeReadySha256===RUNTIME_READY&&
   files.durable.manifestSha256===MANIFEST&&files.durable.pricingReceiptSha256===PRICE&&files.ready.admittedRows===ROWS,'ready_binding');
  const view=await openIndependentChinaPrepared(openIndependentChinaRegcloud(files!));
  need(view?.snapshot.generationId===GEN&&view.snapshot.rows===ROWS&&view.snapshot.deliveryTariffVersion===DELIVERY_TARIFF_VERSION,'snapshot_binding');
  const s=view!.snapshot, policyDay=new Date(now+7*3600000).toISOString().slice(0,10);
  const active={generationId:GEN,admittedRows:ROWS,policyDay,validUntil:Math.min(END,s.legalValidUntil??s.validUntil),
   directorySha256:s.directorySha256,sameCutAdmittedOrderSha256:view!.orderedAdmittedIdsSha256,editorialSha256:view!.chinaEditorialSha256,
   runtimeSourceSha256:sha([RELEASE,CALC]),pricingReceiptSha256:PRICE,tariffVersionSha256:sha(DELIVERY_TARIFF_VERSION)};
  const batch=await buildExactFilterBatch({active,queries,verifyFirstSix:true,installedMembership:compilePreparedChinaCompatibilityPredicate,
   installedSelector:createChinaSelectorPage,assertCurrent:fence,
   async *verifiedRows(){
    for(const [chunk,ref] of s.chunks.entries()){
     const reader=await s.readChunk(ref);
     for(let part=0;part<reader.partCount;part++){
      const {projection}=await reader.load(part);
      for(const [offset,row] of projection.items.entries())yield {row,position:{id:row.id,chunk,part,offset,baseRub:row.totalRub}};
     }
     if(chunk%16===0)await fence();
    }
   }});
  await fence();
  return {kind:'china_rev6_filter_projection_verified',generation:GEN,controlSha256:CONTROL,readySha256:READY,authoritySha256:sha(active),gets,bytes,
   elapsedMs:Date.now()-now,scopes:batch.map((index,i)=>({slot:i,total:index.total,rankedRows:index.ranked.length,sidecarSha256:sha(index),firstSixOrderedSha256:sha(index.ranked.slice(0,6).map(x=>x.id))})),
   providerCalls:0,storageWrites:0,priceRecomputes:0,publicationAuthorized:false};
 }finally{globalThis.fetch=original;}
}
if(require.main===module) verifyExactRev6Index().then(x=>console.log(JSON.stringify(x)),e=>{
 const message=e instanceof Error?e.message:'';
 const reason=/^(?:china_rev6_index_proof|china_make_index):[a-z0-9_]+$/.test(message)?message:'native_reader_refused';
 console.log(JSON.stringify({kind:'china_rev6_filter_projection_held',reason,publicationAuthorized:false}));process.exitCode=2;
});
