import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {ObjectJsonStorage,getJsonStorage,LocalJsonStorage,resetJsonStorageForTests} from '../../../apps/web/lib/data.ts';
import {catalogOfferFreshness} from '../../../apps/web/lib/catalog/refresh-policy.ts';
import {searchProjectionFromOffer,projectionCanRenderCard} from '../../../apps/web/lib/catalog/storage.ts';
import {loadSourceEvidence,businessAuthority,classifyPrepared,EDITORIAL_KEY,EXPECTED} from './qualify.mjs';
import {makeExactUaePorts} from './native-ports.mts';
import {datedCbr} from './cbr.mjs';
const E=process.env, req=(x:unknown,c:string)=>assert.ok(x,c), sha=(b:any)=>createHash('sha256').update(b).digest('hex');
const stamp=(d:any)=>sha(Buffer.from(JSON.stringify(d)));
const sourcePath=/^(?:source-prepared\.json|(?:source-input|predecessor-evidence|dispositions|source-holds)\/chunk-\d{4}\.ndjson)$/;
const priorPath=/^catalog\/generations\/gen_\d{13}_[a-f0-9]{8}\/offers\/uae\/chunk-\d{4,6}\.json$/;
const fixed=['catalog/manifest.json','catalog/intake-cursors/v1/uae.json',EDITORIAL_KEY];
const expectedGenRecord='b2513d16f614312978534964327de665bf3b35e67a7c698b184789d0cbc93beb';
const expectedResolvedRefs='6cc21d16b68f49d291e983f3b23fbedb9c500092143da9862bb5eedd7268c3c0';
const expectedCursor='7af8b18e95cb5f4e63b4ad428eaf25b0942561e9cf17cf4fb9bda40832e5572a';
const prefix='/avtocena-staging-8120751/migration-staging/full-20261011/';
let phase='admission';
async function run(){
 req(E.GITHUB_REPOSITORY_ID==='1289722938'&&E.GITHUB_REPOSITORY==='jeep-jim/AvtoCena'&&E.GITHUB_REF==='refs/heads/main'&&E.GITHUB_RUN_ATTEMPT==='1'
  &&E.GITHUB_JOB==='qualification'&&E.GITHUB_WORKFLOW_REF==='jeep-jim/AvtoCena/.github/workflows/uae-private-buyer-run-22867-v1.yml@refs/heads/main'
  &&/^[1-9]\d{8,14}$/.test(E.GITHUB_RUN_ID||'')&&E.YC_OBJECT_STORAGE_ENDPOINT==='https://s3.regru.cloud'
  &&E.YC_OBJECT_STORAGE_REGION==='us-east-1'&&E.YC_OBJECT_STORAGE_BUCKET==='avtocena-staging-8120751'
  &&E.YC_OBJECT_STORAGE_PREFIX==='migration-staging/full-20261011/'&&E.YC_OBJECT_STORAGE_MAX_ATTEMPTS==='1','uae_private_buyer_scope');
 const [workspace,cbrFile]=process.argv.slice(2);
 req(process.argv.length===4&&workspace===path.resolve(workspace)&&await fs.realpath(workspace)===workspace
  &&cbrFile===path.join(workspace,'cbr.html')&&((await fs.stat(workspace)).mode&0o077)===0,'uae_buyer_private_workspace');
 const fx=datedCbr(await fs.readFile(cbrFile)), now=Date.now();
 const storage=new ObjectJsonStorage(), realFetch=globalThis.fetch;
 let reads=0,writes=0;
 const stage='catalog/operations/uae-buyer-qualification/v1/'+E.GITHUB_RUN_ID+'/attempt-1/';
 const out=/^(?:decisions\/part-\d{4}\.ndjson|sealed-private-qualification\.json)$/;
 const permittedRead=(k:string)=>fixed.includes(k)||(k.startsWith(EXPECTED.root)&&sourcePath.test(k.slice(EXPECTED.root.length)))
  || priorPath.test(k)||(k.startsWith(stage)&&out.test(k.slice(stage.length)));
 globalThis.fetch=async(i,o:any={})=>{
  const u=new URL(i instanceof Request?i.url:String(i));const method=o.method??(i instanceof Request?i.method:'GET');
  if(u.origin==='https://avtocena.com'&&u.pathname==='/api/health'&&!u.search&&method==='GET')return realFetch(i,{...o,redirect:'error'});
  req(u.origin==='https://s3.regru.cloud'&&u.pathname.startsWith(prefix)&&!u.search&&!u.username&&!u.password,'uae_buyer_transport_denied');
  const k=decodeURIComponent(u.pathname.slice(prefix.length));
  if(method==='PUT'){
   req(k.startsWith(stage)&&out.test(k.slice(stage.length))&&new Headers(o.headers).get('if-none-match')==='*'
      &&++writes<=500,'uae_buyer_transport_put_scope');
  }else req(['GET','HEAD'].includes(method)&&!o.body&&permittedRead(k)&&++reads<=850,'uae_buyer_transport_get_scope');
  return realFetch(i,{...o,redirect:'error'});
 };
 async function read(k:string,cap:number){
  req(permittedRead(k),'uae_buyer_read_path');
  const v=await storage.getBinary(k);req(Buffer.isBuffer(v.data)&&v.data.length===v.size&&v.size>0&&v.size<=cap,'uae_buyer_size');
  return v.data;
 }
 async function snapEditorial(){
  const before=await storage.readObjectMetadata(EDITORIAL_KEY);
  if(!before.found){
   const after=await storage.readObjectMetadata(EDITORIAL_KEY);
   req(!after.found,'uae_buyer_editorial_configuration_changed');
   const index={revision:'0',entries:{}}, receipt=stamp({key:EDITORIAL_KEY,observed:'authenticated_head_404'});
   return {key:EDITORIAL_KEY,wireSha256:receipt,etagSha256:receipt,revision:'0',index,defaultProvenByAbsence:true};
  }
  const w=await read(EDITORIAL_KEY,8*1024*1024),after=await storage.readObjectMetadata(EDITORIAL_KEY), index=JSON.parse(w.toString());
  req(before.etag&&after.found&&after.etag===before.etag&&typeof index?.revision==='string'&&index.revision
   &&index.entries&&typeof index.entries==='object'&&!Array.isArray(index.entries),'uae_buyer_editorial_configuration_changed');
  return {key:EDITORIAL_KEY,wireSha256:sha(w),etagSha256:sha(before.etag),revision:index.revision,index,defaultProvenByAbsence:false};
 }
 async function guardLive(){
  const [m,c,r]=await Promise.all([read(fixed[0],1024*1024),read(fixed[1],1024*1024),
    fetch('https://avtocena.com/api/health',{redirect:'error',signal:AbortSignal.timeout(8000),headers:{accept:'application/json','cache-control':'no-cache'}})]);
  const manifest=JSON.parse(m.toString()),cursor=JSON.parse(c.toString()),health=r.ok?await r.json():null;
  const ua=manifest?.markets?.uae, keys=ua?.chunks?.map((k:string)=>
    /^chunk-\d{4,6}$/.test(k)?'catalog/generations/'+manifest.generationId+'/offers/uae/'+k+'.json':k);
  req(stamp(ua)===expectedGenRecord&&stamp(cursor)===expectedCursor&&stamp(keys)===expectedResolvedRefs
     &&health?.ok===true&&health.releaseSha===EXPECTED.release&&health.calculationVersion===EXPECTED.calc,'uae_buyer_current_predecessor_changed');
  return manifest.generationId;
 }
 phase='exact_evidence';
 const [source,editorial]=await Promise.all([loadSourceEvidence(read),snapEditorial(),guardLive()]);
 const authority=businessAuthority({editorial,fx,now}); // explicitly no paid republication or photo authority in this run
 req(authority.canQualifyPrivately&&!authority.publication&&!authority.photos,'uae_buyer_private_authority_only');
 // Isolated native policy role. It reads its exact checked-in seed paths and one frozen CBR
 // vector only, not the current global settings, knowledge quote objects, or live network.
 const base=path.join(workspace,'native-local');await fs.mkdir(path.join(base,'data','fees'),{mode:0o700,recursive:true});
 await fs.writeFile(path.join(base,'data','fees','exchange-rates.json'),JSON.stringify({...fx.rates,updatedAt:'2026-11-21'}),{flag:'wx',mode:0o600});
 process.chdir(base); E.JSON_STORAGE_DRIVER='local'; E.CATALOG_LIVE_RATE_DISABLED='1';resetJsonStorageForTests();
 const local=getJsonStorage();req(local instanceof LocalJsonStorage,'uae_buyer_native_local_only');
 for(const name of ['writeJson','putBinary','deleteJson','deleteBinary','deleteObjects','deletePrefix','createBinaryDownloadUrl']){
  if(typeof (local as any)[name]==='function')(local as any)[name]=async()=>{throw Error('uae_buyer_no_native_writes');};
 }
 const ports=makeExactUaePorts({editorial,withPinnedNativeInputs:(_fx:any,fn:any)=>fn(),
   exactEditorialPhotoReady:(_o:any,entry:any)=>Array.isArray(entry.photos)&&entry.photos.every((p:any)=>typeof p==='string'&&/^\/api\/site-media\/[a-f0-9]{64}$/.test(p)),
   exactRetainedBuyerProof:(row:any,prior:any)=>row?.id===prior?.id&&
    (prior.pricing?.exactInlineDeliveredRub??0)===0&&catalogOfferFreshness(row)>0&&projectionCanRenderCard(searchProjectionFromOffer(row))});
 phase='native_qualification';
 const q=await classifyPrepared({source,authority,editorial,fx,read,ports,now});
 req(!q.canMaterialize&&!q.published,'uae_buyer_no_ready_without_authority');
 const final=await snapEditorial();await guardLive();
 req(final.wireSha256===editorial.wireSha256&&final.etagSha256===editorial.etagSha256
   ,'uae_buyer_private_input_changed');
 phase='write_private_only';
 async function create(name:string,data:Buffer){
  req(out.test(name)&&data.length>0&&data.length<=1024*1024,'uae_qual_private_write_cap');
  await storage.putBinary(stage+name,data,'application/json',{ifNoneMatch:'*'});
  const back=await read(stage+name,data.length);req(sha(back)===sha(data),'uae_qual_private_wire_readback');
  return {name,bytes:data.length,sha256:sha(data)};
 }
 const byId=new Map(q.candidateOffers.map(v=>[v.row.id,v]));
 function galleryEvidence(row:any){
  const imgs=row?.images??[];const admitted:string[]=[];let editorial=0, held=0;
  for(const img of imgs){
   const url=typeof img?.url==='string'?img.url:'';
   if(/^\/api\/site-media\/[a-f0-9]{64}$/.test(url)){admitted.push(url);editorial++;continue;}
   try{
    const parsed=new URL(url);
    if(parsed.origin==='https://www.dubicars.com'&&!parsed.username&&!parsed.password&&!parsed.search&&!parsed.hash
      &&parsed.pathname.startsWith('/images/')&&/\.(?:jpe?g|png|webp|avif)$/i.test(parsed.pathname)
      &&row.operational?.photoIdentityVerified===true){admitted.push(url);continue;}
   }catch{}
   held++;
  }
  return {digest:stamp(admitted),paidSourceLinks:admitted.length-editorial,editorialRefs:editorial,held};
 }
 const ids=[...q.outcomes.keys()].sort(), descriptors=[];
 for(let i=0;i<ids.length;i+=256){
  const rows=ids.slice(i,i+256).map(id=>{
   const v=byId.get(id);
   return {id,outcome:q.outcomes.get(id),...(v?{state:v.receipt.sourceState,priceKind:v.receipt.priceStatus,
    privateSellerRub:v.receipt.priceStatus==='seller'?v.row.sellerPriceRub??null:null,
    sourcePrice:v.row.sourcePrice??null,observedAt:v.receipt.rawSourceObservedAt,galleryEvidence:galleryEvidence(v.row),photoURLsExported:false}: {})};
  });
  descriptors.push({...(await create('decisions/part-'+String(descriptors.length).padStart(4,'0')+'.ndjson',
    Buffer.from(rows.map(x=>JSON.stringify(x)+'\n').join('')))),rows:rows.length});
 }
 const after=await snapEditorial();await guardLive();
 req(after.wireSha256===editorial.wireSha256&&after.etagSha256===editorial.etagSha256,'uae_buyer_editorial_changed_before_seal');
 const report={version:1,kind:'uae-private-buyer-qualification-v1',market:'uae',sourceReceiptSha256:EXPECTED.sha256,cursor:EXPECTED.cursor,
  sourceRows:q.sourceRows,predecessorRows:q.exactPredecessors,counts:q.counts,heldCount:q.heldCount,editorialWireSha256:editorial.wireSha256,
  fxWireSha256:fx.wireSha256,fxRateDate:'2026-11-21',nativeRelease:EXPECTED.release,calculator:EXPECTED.calc,
  deliveredQuoteAuthority:false,publicActivationAuthorizedByThisReceipt:false,
  exactLivePricingSettingsCaptured:false,galleryReuseScope:'existing_paid_feed_only',galleryProofIsNotLegalOpinion:true,photoURLsExported:false,preparedPrivateOnly:true,
  servable:false,publicationAllowed:false,publicPointerWrites:0,cursorWrites:0,supplierRequests:0,fields:descriptors};
 const receipt=await create('sealed-private-qualification.json',Buffer.from(JSON.stringify(report))),{fields,...summary}=report;
 console.log(JSON.stringify({...summary,receiptSha256:receipt.sha256,decisionRows:ids.length,shards:fields.length,reads,writes}));
}
run().catch(e=>{const code=/^uae_[a-z0-9_]+$/.test(e?.message)?e.message:'uae_private_buyer_hold';
 console.error(JSON.stringify({phase,code,publicationAllowed:false}));process.exitCode=1;});
