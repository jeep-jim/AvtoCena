import {appendFileSync} from 'node:fs';
import {ObjectJsonStorage} from '../../../apps/web/lib/data.ts';
import {openConfiguredUaeRegcloudFiles,UAE_PUBLIC_CONTROL} from '../../../apps/web/lib/catalog/uae-regcloud-object-reader.ts';
import {isSellerPricedOffer} from '../../../apps/web/lib/catalog/seller-price-contract.ts';
import {isPriceOnRequestDubicarsOffer} from '../../../apps/web/lib/catalog/dubicars-owner-policy.ts';
import {isPreparedUaeGallery,isPreparedUaeGalleryPath} from '../../../apps/web/lib/catalog/dubicars-gallery-policy.ts';
import {rankedCatalogImageUrls} from '../../../apps/web/lib/catalog/image-quality.ts';
import {planReboundUaeReady,rebindWithPrivateCapability,REAL,sha,prefix} from './repair.mjs';
import {makeUaeRebindStorage} from './storage.mjs';
const req=(ok:any,code:string)=>{if(!ok)throw Error('uae_rebind:'+code);};
const E=process.env, mode=process.argv[2], runId=E.GITHUB_RUN_ID!;
const W='jeep-jim/AvtoCena/.github/workflows/uae-exact-private-ready-rebind-v1.yml@refs/heads/main';
req(process.argv.length===3&&['proof','rebind'].includes(mode)&&E.GITHUB_JOB===mode&&
 E.GITHUB_REPOSITORY==='jeep-jim/AvtoCena'&&E.GITHUB_REPOSITORY_ID==='1289722938'&&E.GITHUB_REF==='refs/heads/main'&&
 E.GITHUB_RUN_ATTEMPT==='1'&&E.GITHUB_WORKFLOW_REF===W&&/^[0-9a-f]{40}$/.test(E.GITHUB_SHA??'')&&
 E.YC_OBJECT_STORAGE_ENDPOINT==='https://s3.regru.cloud'&&E.YC_OBJECT_STORAGE_REGION==='us-east-1'&&E.YC_OBJECT_STORAGE_BUCKET==='avtocena-staging-8120751'&&
 E.YC_OBJECT_STORAGE_PREFIX==='migration-staging/full-20261011/','actor_scope');
const storage=makeUaeRebindStorage({runId,access:E.YC_OBJECT_STORAGE_ACCESS_KEY_ID!,secret:E.YC_OBJECT_STORAGE_SECRET_ACCESS_KEY!,mode,fetcher:globalThis.fetch});
const incumbent={marketRecord:'b2513d16f614312978534964327de665bf3b35e67a7c698b184789d0cbc93beb',
 cursor:'7af8b18e95cb5f4e63b4ad428eaf25b0942561e9cf17cf4fb9bda40832e5572a',refs:'6cc21d16b68f49d291e983f3b23fbedb9c500092143da9862bb5eedd7268c3c0'};
const parse=(b:Buffer)=>{try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(b));}catch{throw Error('uae_rebind:guard_json');}};
const digest=(x:any)=>sha(JSON.stringify(x));
let phase='verify_exact_old_source_and_price';
async function fencedIncumbent(){
 const [m,c,e,absent]=await Promise.all([storage.get('catalog/manifest.json',1024*1024).then(parse),
  storage.get('catalog/intake-cursors/v1/uae.json',1024*1024).then(parse),storage.get('catalog-editorial/current.json',8*1024*1024),storage.controlAbsent()]);
 const u=m?.markets?.uae,keys=u?.chunks?.map((k:string)=>/^chunk-\d{4,6}$/.test(k)?'catalog/generations/'+m.generationId+'/offers/uae/'+k+'.json':k);
 req(u&&keys&&digest(u)===incumbent.marketRecord,'incumbent_market_changed');
 req(digest(c)===incumbent.cursor&&digest(keys)===incumbent.refs,'incumbent_cursor_or_refs_changed');
 req(sha(e)===REAL.editorial,'editorial_changed');
 req(absent,'independent_pointer_not_absent');
 return {scope:incumbent.marketRecord,cursor:incumbent.cursor,refs:incumbent.refs,editorial:REAL.editorial,ownPointerAbsent:true};
}
async function samples(plan:Awaited<ReturnType<typeof planReboundUaeReady>>){
 const samples=new Map<string,any>();
 for(const i of [0,1,REAL.blocks-1]){
  if(samples.size===2)break;
  const part=parse(await plan.readObject(plan.descriptors[i]));
  for(const offer of part.items){
   const type=isSellerPricedOffer(offer)?'seller':isPriceOnRequestDubicarsOffer(offer)?'onRequest':null;
   req(type&&offer.market==='uae'&&offer.sourceGroup==='dubicars_uae_exact'&&offer.totalRub==null&&isPreparedUaeGalleryPath(offer.cardImageUrl)&&/^[a-f0-9]{24}$/.test(offer.id),'old_projection_buyer_parity');
   if(!samples.has(type!))samples.set(type!,offer);
  }
 }
 req(samples.size===2,'old_buyer_samples');
 for(const [kind,p] of samples){
  const k='details/'+sha(p.id).slice(0,2)+'.json',binding=plan.descriptors.find(x=>x[0]===k);
  req(binding,'old_sample_shard');
  const doc=parse(await plan.readObject(binding!)),same=doc.items.filter((r:any)=>r.id===p.id);
  req(same.length===1,'old_sample_id');
  const d=same[0];
  req(d.market==='uae'&&d.status==='active'&&d.sourceId==='dubicars_uae_exact'&&d.totalRub==null&&d.images?.length>0&&
    isPreparedUaeGallery(d.images)&&rankedCatalogImageUrls(d)[0]===p.cardImageUrl&&(d.sellerPriceRub??null)===(p.sellerPriceRub??null)&&
    (kind==='seller'?isSellerPricedOffer(d)&&d.sourceCurrency==='AED':isPriceOnRequestDubicarsOffer(d)),'old_detail_buyer_parity');
 }
 return samples;
}
async function run(){
 req(Date.now()+30*60*1000<REAL.legalValidUntil,'insufficient_legal_horizon_for_start');
 const plan=await planReboundUaeReady({read:storage.get,newRunId:runId});
 phase='read_only_incumbent_privacy_and_buyer_parity';
 const [current,privacy,examples]=await Promise.all([fencedIncumbent(),storage.permission(),samples(plan)]);
 const gateSha=digest({runId,workflowCommit:E.GITHUB_SHA,source:REAL.source,price:REAL.price,oldReady:REAL.ready,
  newReady:plan.readySha256,sourcePrefix:prefix(REAL.runId),current,ownerDigest:privacy.ownerDigest,policy:privacy.policy,samples:examples.size});
 req(storage.totals().privatePuts===0,'preflight_zero_writes');plan.mustCurrent();
 console.log(JSON.stringify({state:'uae_exact_read_only_gate_passed',gateSha,privateOldSourceVerified:true,privateOldBuyerVerified:true,
  expectedNativeClasses:examples.size,providerCalls:0,publicWrites:0,...storage.totals()}));
 if(mode==='proof'){appendFileSync(E.GITHUB_OUTPUT!,`gate_sha=${gateSha}\n`,{encoding:'utf8'});return;}
 req(E.UAE_REBIND_GATE_SHA===gateSha,'first_job_proof_not_identical');
 const cap=storage.openPrivateOnlyCapability({gateSha,expectedGateSha:E.UAE_REBIND_GATE_SHA,privacy});
 async function nativeVerify(beforeReady:boolean){
 phase=beforeReady?'native_prepublication_before_ready':'actual_prepared_reader_private_only';
 // Private in-process view of the proposed reference only. This does not touch
 // the real control: prior and final current absence are separately signed.
 // Native READY/directory/detail validation runs against exact bytes on Regcloud.
 const state=Buffer.from(JSON.stringify({version:1,market:'uae',revision:1,active:{runId,generationId:plan.generationId,readySha256:plan.readySha256},previous:null}));
 const proto=ObjectJsonStorage.prototype,oldCtrl=proto.readScopedControl,oldGet=proto.getBinaryBounded,oldFlag=E.AVTOCENA_UAE_REGCLOUD_RUNTIME;
 E.AVTOCENA_UAE_REGCLOUD_RUNTIME='1';
 try{
  proto.readScopedControl=async key=>{req(key===UAE_PUBLIC_CONTROL,'native_preview_key');return {data:state,etag:sha(state),checksum:sha(state)};};
  proto.getBinaryBounded=async (key,cap)=>{
   req(key.startsWith(prefix(runId)),'native_preview_scope');
   const b=beforeReady&&key===prefix(runId)+'READY.json'?plan.readyBytes:await storage.get(key,cap);
   req(b.length<=cap,'native_preview_cap');return {data:b,size:b.length,checksum:sha(b)};
  };
  const handle=await openConfiguredUaeRegcloudFiles();req(handle?.generationId===plan.generationId,'native_preview_ready');
  const d=await handle!.readPublicDirectory();
  for(const [kind,original] of examples){
   const row:any=await handle!.readDetail(d,original.id);
   req(row?.id===original.id&&row.totalRub==null&&rankedCatalogImageUrls(row)[0]===original.cardImageUrl&&
    (kind==='seller'?isSellerPricedOffer(row):isPriceOnRequestDubicarsOffer(row)),'native_preview_buyer_parity');
  }
  await handle!.assertCurrent();
 }finally{
  proto.readScopedControl=oldCtrl;proto.getBinaryBounded=oldGet;
  if(oldFlag===undefined)delete E.AVTOCENA_UAE_REGCLOUD_RUNTIME;else E.AVTOCENA_UAE_REGCLOUD_RUNTIME=oldFlag;
 }
 }
 phase='fresh_scoped_createonly';
 const result=await rebindWithPrivateCapability({plan,capability:cap,assertMarketFence:async()=>{await fencedIncumbent();},beforeReady:()=>nativeVerify(true)});
 await nativeVerify(false);plan.mustCurrent();await fencedIncumbent();
 console.log(JSON.stringify({...result,runId,generationId:plan.generationId,nativePrivateReaderVerified:true,syntheticControlInProcessOnly:true,
  legalValidUntil:REAL.legalValidUntil,sourceReceiptSha256:REAL.source,publicWrites:0,cursorWrites:0,providerCalls:0,...storage.totals()}));
}
run().catch(e=>{
 const s=String(e?.message??'');
 const code=/^(?:uae_rebind|uae_ready_repair|uae_regcloud):[a-z0-9_]+$/.test(s)?s:/^s3_read_\d{3}$/.test(s)?s:'scope_or_transport_unverified';
 console.error(JSON.stringify({phase,code,publicWrites:0,cursorWrites:0,providerCalls:0,...storage.totals()}));process.exitCode=1;
});
