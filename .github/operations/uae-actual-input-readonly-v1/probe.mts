import assert from 'node:assert/strict';
import {ObjectJsonStorage} from '../../../apps/web/lib/data.ts';
import {catalogProjectionBatches} from '../../../apps/web/lib/catalog-projection-parts.ts';
import {isSellerPricedOffer} from '../../../apps/web/lib/catalog/seller-price-contract.ts';
import {isPriceOnRequestDubicarsOffer} from '../../../apps/web/lib/catalog/dubicars-owner-policy.ts';
import {isPreparedUaeGallery,isPreparedUaeGalleryPath} from '../../../apps/web/lib/catalog/dubicars-gallery-policy.ts';
import {rankedCatalogImageUrls} from '../../../apps/web/lib/catalog/image-quality.ts';
import {REAL,sha,prefix,inspectMissingSourceSeal} from './repair.mjs';
import {inspectExactLegacyUaeFeed} from './static-gzip.mjs';
const scope='https://s3.regru.cloud',scopePath='/avtocena-staging-8120751/migration-staging/full-20261011/';
const control='catalog/independent-market-public-v1/uae/control.json', editorial='catalog-editorial/current.json';
const base='catalog/manifest.json', meta='catalog/public/feeds/openai-products.json', gzip='catalog/public/feeds/openai-products.csv.gz';
const projection='catalog/public/projection/uae.json', old='b2513d16f614312978534964327de665bf3b35e67a7c698b184789d0cbc93beb';
const auth='jeep-jim/AvtoCena/.github/workflows/uae-actual-input-readonly-v1.yml@refs/heads/main';
const mi=1024*1024, resourceLimit=160*mi, requestLimit=60;
const publicOrigin='https://avtocena.com',release='22867cbcfaee27b2e8917b6bf880e44827f67b60',runtime='4654386ca34f04041effe31f38259d0fae9c396ecda35c364e3a18dd125a4b90';
const req=(a:any,code:string)=>assert.ok(a,code);
const E=process.env;
req(E.GITHUB_REPOSITORY==='jeep-jim/AvtoCena'&&E.GITHUB_REPOSITORY_ID==='1289722938'&& E.GITHUB_REF==='refs/heads/main'&&
 E.GITHUB_RUN_ATTEMPT==='1'&&E.GITHUB_JOB==='storage'&& E.GITHUB_WORKFLOW_REF===auth&&E.JSON_STORAGE_DRIVER==='object'&&
 E.YC_OBJECT_STORAGE_ENDPOINT===scope&&E.YC_OBJECT_STORAGE_BUCKET==='avtocena-staging-8120751'&&
 E.YC_OBJECT_STORAGE_PREFIX==='migration-staging/full-20261011/'&&E.YC_OBJECT_STORAGE_REGION==='us-east-1'&&
 !!E.YC_OBJECT_STORAGE_ACCESS_KEY_ID&&!!E.YC_OBJECT_STORAGE_SECRET_ACCESS_KEY,'probe_authority');
const storage=new ObjectJsonStorage(),actual=globalThis.fetch;
const stage=prefix(REAL.runId);
const explicit=new Set([base,meta,gzip,projection,editorial,control,REAL.sourceKey,REAL.priceKey,...['READY.json','public-directory.json','input-evidence.json','retained-evidence.json'].map(k=>stage+k)]);
const dyn=new Set<string>(), activeCaps=new Map<string,number>(), proofs=new Map<string,string>();
let gets=0,heads=0,healthCalls=0,readBytes=0;
globalThis.fetch=async (i,o:any={})=>{
 const u=new URL(i instanceof Request?i.url:String(i));
 const method=o.method??(i instanceof Request?i.method:'GET');
 if(u.origin===publicOrigin&&u.pathname==='/api/health'&&!u.search&&method==='GET'&&!o.body&&++healthCalls<=1)
  return actual(i,{...o,redirect:'error'});
 req(u.origin===scope&&u.pathname.startsWith(scopePath)&&!u.search&&!u.username&&!u.password&&!o.body&&['GET','HEAD'].includes(method),'probe_transport');
 const key=decodeURIComponent(u.pathname.slice(scopePath.length)), headers=new Headers(o.headers);
 req((explicit.has(key)||dyn.has(key))&&headers.get('authorization')?.startsWith('AWS4-HMAC-SHA256 Credential=')&&gets+heads<requestLimit,'probe_storage_key');
 if(method==='HEAD'){heads++;return actual(i,{...o,redirect:'error'});}
 gets++; const cap=key===control?32768:activeCaps.get(key);
 req(cap&&cap<=82*mi,'probe_cap');
 const r=await actual(i,{...o,redirect:'error'});
 if(r.status===404){await r.body?.cancel();return new Response(null,{status:404,headers:r.headers});}
 req(r.ok&&r.body,'probe_object_response');
 const etag=r.headers.get('etag');req(etag,'probe_etag');proofs.set(key,etag!.replace(/^"|"$/g,''));
 const advertised=Number(r.headers.get('content-length')??0);
 req(!advertised||advertised<=cap!,'probe_response_bound');
 const rdr=r.body!.getReader(), chunks:Buffer[]=[];let n=0;
 try{for(;;){const next=await rdr.read();if(next.done)break;
  n+=next.value.byteLength;readBytes+=next.value.byteLength;
  if(n>cap!||readBytes>resourceLimit){await rdr.cancel();throw Error('probe_response_bound');}
  chunks.push(Buffer.from(next.value));
 }}finally{rdr.releaseLock();}
 // Re-expose only bounded bytes to the unchanged native signer/consumer.
 return new Response(Buffer.concat(chunks,n),{status:r.status,headers:r.headers});
};
const parse=b=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(b));
async function read(key:string,cap:number){activeCaps.set(key,cap);try{return (await storage.getBinary(key)).data;}finally{activeCaps.delete(key);}}
const obj=(k:string,c:number)=>read(k,c).then(parse);
async function stable(key:string){
 const h=await storage.readObjectMetadata(key);return h.found&&!!h.etag&&h.etag.replace(/^"|"$/g,'')===proofs.get(key);
}
async function legacy(){
 const m=await obj(base,1024*1024), md=await obj(meta,32768), gen=m?.generationId;
 req(/^gen_\d{13}_[a-z0-9_-]{1,32}$/.test(gen)&&md?.generationId===gen&&sha(JSON.stringify(m?.markets?.uae))===old,'legacy_generation_or_predecessor_changed');
 const root=await obj(projection,82*mi);
 req(root?.generationId===gen&&(!root.parts||Array.isArray(root.parts)&&root.parts.length<=35),'legacy_projection_scope');
 const ids=new Set<string>();
 const childRoot='catalog/generations/'+gen+'/indexes/projection-parts/'+sha(projection)+'/';
 const adapter:any={readJson:async key=>{
  req(key.startsWith(childRoot)&&/^\d{1,3}-[0-9a-f]{64}\.json$/.test(key.slice(childRoot.length)),'legacy_part_scope');
  dyn.add(key);return obj(key,4*mi);
 }};
 for await(const block of catalogProjectionBatches(adapter,projection,root)){
  req(block.generationId===gen,'legacy_projection_generation');
  for(const row of block.items){req(row?.market==='uae'&&/^[a-f0-9]{24}$/.test(row.id)&&!ids.has(row.id),'legacy_membership');ids.add(row.id);}
 }
 req(ids.size===25484&&m.markets.uae.count===ids.size,'legacy_membership_count');
 const gz=await read(gzip,64*mi);
 const report=inspectExactLegacyUaeFeed({legacyMetadata:md,gzipBytes:gz,legacyUaeIds:ids});
 req((await Promise.all([base,meta,gzip,projection].map(stable))).every(Boolean),'legacy_changed_inflight');
 return report;
}
async function candidate(){
 const view=await inspectMissingSourceSeal({read});
 const choices=new Map<string,any>();let sampled=0;
 for(const ordinal of [0,1,REAL.blocks-1]){
  if(choices.size===2)break;
  const part=view.directory.blocks[ordinal],name='projection/'+ordinal+'.json';
  dyn.add(stage+name);const doc=await view.get(name,part.sha256).then(parse);
  req(doc?.version===1&&doc.market==='uae'&&doc.generationId===REAL.generationId&&doc.ordinal===ordinal&&
   Array.isArray(doc.items)&&doc.items.length===part.rows,'private_projection_scope');sampled+=doc.items.length;
  for(const row of doc.items){
   const kind=isSellerPricedOffer(row)?'seller':isPriceOnRequestDubicarsOffer(row)?'onRequest':null;
   req(row?.market==='uae'&&row.sourceGroup==='dubicars_uae_exact'&&row.totalRub==null&&/^([a-f0-9]{24})$/.test(row.id)&&
    kind&&isPreparedUaeGalleryPath(row.cardImageUrl),'private_projection_class_and_cover');
   if(!choices.has(kind!))choices.set(kind!,row);
  }
 }
 req(choices.size===2,'private_required_sample');
 for(const [kind,row] of choices){
  const shard=sha(row.id).slice(0,2),part=view.directory.detailShards[shard],name='details/'+shard+'.json';
  req(part,'private_sample_missing_shard');dyn.add(stage+name);
  const doc=await view.get(name,part.sha256).then(parse);
  req(doc?.version===1&&doc.market==='uae'&&doc.generationId===REAL.generationId&&doc.shard===shard&&Array.isArray(doc.items)&&
   doc.items.length===part.rows&&doc.items.every(x=>sha(x.id).slice(0,2)===shard),'private_detail_scope');
  const q=doc.items.filter(x=>x.id===row.id);req(q.length===1,'private_sample_exact_id');const v=q[0];
  req(v.market==='uae'&&v.status==='active'&&v.sourceId==='dubicars_uae_exact'&&v.totalRub==null&&v.sourcePrice===row.sourcePrice&&
   (v.sellerPriceRub??null)===(row.sellerPriceRub??null)&&v.images.length>0&&isPreparedUaeGallery(v.images)&&
   rankedCatalogImageUrls(v)[0]===row.cardImageUrl&&
   (kind==='seller'?isSellerPricedOffer(v)&&v.sourceCurrency==='AED':isPriceOnRequestDubicarsOffer(v)),'private_sample_card_photo_price_parity');
 }
 const editorialBytes=await read(editorial,8*mi);
 req(await stable(editorial),'private_editorial_changed_inflight');
 return {generation:REAL.generationId,readySha256:REAL.ready,sourceFieldMissing:true,sourceEvidenceDigestReverified:true,
  exactPriceReceiptReverified:true,eligibleRowsAccordingToSignedBundle:Object.values(REAL.admitted).reduce((x,y)=>x+y,0),
  authorizedGalleryShapeListAndDetailSamples:choices.size,projectionRowsSampled:sampled,observedLegalHorizonUnchanged:REAL.legalValidUntil,
  unexpired:view.unexpired,editorialBytesStillExact:sha(editorialBytes)===REAL.editorial,nativeRuntimeAcceptsThisReady:false};
}
function reason(e){const s=String(e?.message??'');return /^(?:legacy_|private_|probe_|uae_ready_repair:|uae_ai_feed:)[a-z0-9_]+$/.test(s)?s:'proof_resource_or_schema_unverified';}
async function probe(){
 const begin=await storage.readScopedControl(control), h=await fetch(publicOrigin+'/api/health',{signal:AbortSignal.timeout(6000)});
 const heart=h.ok?await h.json():null;
 const results:any={};
 for(const [name,fn] of [['legacyStatic',legacy],['privateReady',candidate]] as const){
  try{results[name]=await fn();}catch(e){results[name]={verified:false,code:reason(e)};}
 }
 const end=await storage.readScopedControl(control);
 console.log(JSON.stringify({status:'uae_readonly_actual_inputs',...results,ownPointer:(!begin&&!end)?'absent_both_reads':'other_no_go',
  publicExactIncumbent:heart?.ok===true&&heart.releaseSha===release&&heart.calculationVersion===runtime,
  gets,heads,readBytes,healthCalls,storageWrites:0,hostWrites:0,providerCalls:0,photoFetches:0,publicationAuthorized:false}));
}
probe().catch(e=>{console.error(JSON.stringify({status:'uae_read_only_unverified',code:reason(e),gets,heads,storageWrites:0,providerCalls:0,photoFetches:0}));process.exitCode=1;});
