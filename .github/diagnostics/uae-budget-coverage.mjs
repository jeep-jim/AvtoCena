import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';

export const CONTRACT=Object.freeze({
 generation:'gen_1794665184205_cfd76b47',market:'uae',
 liveRelease:'83ff17075e9188dcf227c8752dc064248d5f42e0',
 liveCalculation:'4654386ca34f04041effe31f38259d0fae9c396ecda35c364e3a18dd125a4b90',
 encyclopedia:'bf2c72cb7a260ef093c0a43c2b0dad9c4c9094a4d6dc3811dd0d7f7626b0d72b',
 sources:{
  e8462585e8998eaae5a003831a38d79263ca5649:'2a0a3eecd966a1c6a5ffed3760740983803ff172fcf023fc30aefbc102a6e4f2',
  '6d12acbae48cb5b754da0648f350426fee0448bd':'9d1d02df1b33bdaa72a646df9158d7f56e0903598d2ce1b8250efba319264dcf',
 },
 limits:{rows:100000,samples:10,requests:400,objectBytes:512*1024*1024,totalBytes:1024*1024*1024,milliseconds:8*60*1000},
});
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const shaText=value=>createHash('sha256').update(value).digest('hex');
const assert=(condition,code)=>{if(!condition)throw Error('coverage_'+code);};
const own=(object,key)=>Object.prototype.hasOwnProperty.call(object,key);
const sampleId=id=>/^(?:[a-f0-9]{24,64}|dubicars_uae_exact[:_-][a-zA-Z0-9_-]{1,60})$/.test(id)
 ?{id}:{idSha256:shaText(String(id))};
const sorted=values=>[...values].sort();
const summary=values=>({count:values.size,idsSha256:hash(sorted(values)),samples:sorted(values).slice(0,CONTRACT.limits.samples).map(sampleId)});
const minus=(left,right)=>new Set([...left].filter(id=>!right.has(id)));

export function readKeyPolicy(selectorDirectories){
 const prefix=`catalog/generations/${CONTRACT.generation}/indexes/`;
 const projections=[prefix+'projection/uae.json','catalog/public/projection/uae.json'];
 const exact=new Set(['catalog/manifest.json','catalog/import-lock.json','catalog-editorial/current.json',
  `knowledge/encyclopedia/calculation-releases/${CONTRACT.liveRelease}.json`,
  `knowledge/encyclopedia/calculation-indexes/${CONTRACT.encyclopedia}.json`,...projections]);
 const projectionPrefixes=projections.map(key=>prefix+'projection-parts/'+shaText(key)+'/');
 return key=>{
  if(typeof key!=='string'||key.includes('..')||key.includes('\\'))return false;
  if(exact.has(key))return true;
  if(projectionPrefixes.some(part=>key.startsWith(part)&&/^\d+-[a-f0-9]{64}\.json$/.test(key.slice(part.length))))return true;
  return selectorDirectories.some(directory=>{
   const part=prefix+directory+'/';
   return key.startsWith(part)&&/^(?:ready|uae|parts\/uae\/[a-f0-9]{64})\.json$/.test(key.slice(part.length));
  });
 };
}

/** Both the storage singleton and raw HTTP are fenced; imports cannot bypass PUT denial. */
export function fenceStorage(storage,allowed){
 const state={readFailures:0,blockedOperations:0};
 for(const name of ['readJsonWithMeta','getBinary','readObjectMetadata']){
  if(typeof storage[name]!=='function')continue;
  const read=storage[name].bind(storage);
  storage[name]=async(key,...args)=>{
   if(!allowed(key)){state.blockedOperations++;throw Error('coverage_read_forbidden');}
   try{return await read(key,...args);}catch(error){state.readFailures++;throw error;}
  };
 }
 storage.readJson=async(key,fallback)=>(await storage.readJsonWithMeta(key,fallback)).value;
 for(const name of ['writeJson','deleteJson','putBinary','deleteBinary','deleteObjects','deletePrefix',
  'abortMultipartUpload','listObjects','listBucketObjects','listObjectVersions','listMultipartUploads','createBinaryDownloadUrl']){
  storage[name]=async()=>{state.blockedOperations++;throw Error('coverage_mutation_or_listing_forbidden');};
 }
 return state;
}
export function fenceNetwork(env,allowed,fetchImpl=fetch,limits=CONTRACT.limits){
 const endpoint=new URL(env.YC_OBJECT_STORAGE_ENDPOINT||'https://s3.regru.cloud');
 const base='/'+[env.YC_OBJECT_STORAGE_BUCKET,String(env.YC_OBJECT_STORAGE_PREFIX||'').replace(/^\/+|\/+$/g,'')].filter(Boolean).join('/')+'/';
 assert(endpoint.origin==='https://s3.regru.cloud'&&Boolean(env.YC_OBJECT_STORAGE_BUCKET),'storage_endpoint_invalid');
 const started=Date.now(),stats={requests:0,bytes:0,methods:{GET:0,HEAD:0}};
 const guarded=async(input,options={})=>{
  const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);
  const method=String(options.method||input?.method||'GET').toUpperCase();
  assert(['GET','HEAD'].includes(method),'http_method_forbidden');
  const key=decodeURIComponent(url.pathname).slice(base.length);
  const storage=url.origin===endpoint.origin&&!url.search&&decodeURIComponent(url.pathname).startsWith(base)&&allowed(key);
  const health=url.origin==='https://avtocena.com'&&url.pathname==='/api/health'&&!url.search&&method==='GET';
  assert(storage||health,'http_target_forbidden');
  assert(++stats.requests<=limits.requests&&Date.now()-started<=limits.milliseconds,'network_bound_exceeded');
  stats.methods[method]++;
  const response=await fetchImpl(input,{...options,redirect:'error',signal:AbortSignal.any([
   ...(options.signal?[options.signal]:[]),AbortSignal.timeout(Math.min(30000,limits.milliseconds-(Date.now()-started))),
  ])});
  assert(Number(response.headers.get('content-length')||0)<=limits.objectBytes,'object_bound_exceeded');
  if(!response.body)return response;
  let bytes=0;
  const body=response.body.pipeThrough(new TransformStream({transform(chunk,controller){
   bytes+=chunk.byteLength;stats.bytes+=chunk.byteLength;
   assert(bytes<=limits.objectBytes&&stats.bytes<=limits.totalBytes,'byte_bound_exceeded');controller.enqueue(chunk);
  }}));
  return new Response(body,{status:response.status,statusText:response.statusText,headers:response.headers});
 };
 return {fetch:guarded,stats};
}

export function idsOf(rows){
 const ids=new Set(),duplicates=new Set();let invalid=0;
 for(const row of rows){const id=row?.id;if(typeof id!=='string'||!id||id!==id.trim()){invalid++;continue;}if(ids.has(id))duplicates.add(id);ids.add(id);}
 return {ids,duplicates,invalid};
}
export function describeMissing(row,runtime,memberships){
 const manual=runtime.manual.applyUaeManualSpecifications(row);
 const enriched=runtime.encyclopedia.applyEncyclopediaCalculation(manual);
 const safe=runtime.safety.safePublicPricing(enriched);
 const rate=row.calculationSnapshot?.currencyRate;
 const fields=value=>({positiveTotal:Number(value?.totalRub)>0,positiveSellerPrice:Number(value?.sellerPriceRub)>0,
  needsData:value?.calculationStatus==='needs_data',sellerMode:value?.catalogPricingMode==='seller',
  hasPower:Number(value?.powerHp)>0,hasDisplacement:Number(value?.engineCc)>0,
  encyclopediaEvidence:runtime.evidence.hasEncyclopediaCalculationEvidence(value),
  renderable:runtime.catalog.projectionCanRenderCard(value)});
 return {...sampleId(row.id),inSelector:Object.fromEntries(Object.entries(memberships).map(([name,ids])=>[name,ids?.has(row.id)??null])),
  sourceCategory:row.sourceGroup==='dubicars_uae_exact'?'dubicars':row.sourceGroup?'other':'absent',
  hasPhoto:Boolean(row.cardImageUrl),hasSourcePrice:Number(row.sourcePrice)>0,
  officialRate:['cbr','cbr_live'].includes(rate?.rateSource),
  rateBoundToPrice:Boolean(rate&&rate.currency===row.sourceCurrency&&Number(rate.sourcePrice)===Number(row.sourcePrice)),
  raw:fields(row),afterManual:fields(manual),afterEncyclopedia:fields(enriched),afterSafety:fields(safe)};
}

/** Real reader + real eligibility function. Does not warm, backfill, reprice or search. */
export async function inspectUaeCoverage({storage,runtime,selectorDirectories,manifest}){
 const prefix=`catalog/generations/${manifest.generationId}/indexes/`,selectors={},memberships={};
 for(const [label,directory] of Object.entries(selectorDirectories)){
  const meta=await storage.readJsonWithMeta(prefix+directory+'/ready.json',null);
  if(!meta.found){selectors[label]={status:'absent'};memberships[label]=null;continue;}
  const ready=meta.value;
  if(ready?.generationId!==manifest.generationId){selectors[label]={status:'wrong_generation'};memberships[label]=null;continue;}
  if(label!=='base'&&ready?.encyclopediaDigest!==CONTRACT.encyclopedia){selectors[label]={status:'wrong_encyclopedia'};memberships[label]=null;continue;}
  const entry=ready.markets?.uae;
  assert(!entry?.chunks||entry.chunks.length<=100,'selector_chunk_bound_exceeded');
  assert(!entry||(Number.isSafeInteger(entry.rows)&&Number.isSafeInteger(entry.otherRows)
   &&entry.rows>=0&&entry.otherRows>=0&&entry.rows+entry.otherRows<=CONTRACT.limits.rows),'selector_row_bound_exceeded');
  const index=await runtime.publication.readCompressedSelector(ready,'uae',name=>storage.readJson(prefix+directory+'/'+name+'.json',null));
  if(!index){selectors[label]={status:'invalid_or_unreadable'};memberships[label]=null;continue;}
  const rows=[...index.rows,...(index.otherRows||[])];assert(rows.length<=CONTRACT.limits.rows,'row_bound_exceeded');
  const keys=idsOf(rows.map(row=>row[5]));
  const schemaReady=index.version===3&&index.specificationFilterVersion===1&&index.bodyFilterVersion===1&&index.displayOrderVersion===1;
  memberships[label]=label==='base'||schemaReady?keys.ids:null;
  selectors[label]={status:label==='base'||schemaReady?'valid':'wrong_specification_schema',
   sourceRows:index.sourceRows,pricedRows:index.rows.length,otherRows:index.otherRows?.length||0,schemaReady,
   ids:summary(keys.ids),duplicates:summary(keys.duplicates),invalidIds:keys.invalid,
   foreignMarkets:rows.filter(row=>row[0]!=='uae').length};
 }
 const projections={},samples=[];
 for(const [label,key] of [['immutable',prefix+'projection/uae.json'],['public','catalog/public/projection/uae.json']]){
  const exists=await storage.readObjectMetadata(key);
  if(!exists.found){projections[label]={status:'absent'};continue;}
  const ids=new Set(),duplicates=new Set(),eligible=new Set(),eligibleDuplicates=new Set(),publicEligible=new Set();
  let count=0,invalidIds=0,foreignMarkets=0,actualGeneration;
  for await(const batch of runtime.parts.readCatalogProjectionBatches(storage,key)){
   actualGeneration=batch.generationId;
   assert(batch.generationId===manifest.generationId,'projection_generation_changed');
   assert(Array.isArray(batch.items)&&(count+=batch.items.length)<=CONTRACT.limits.rows,'projection_bound_exceeded');
   for(let offset=0;offset<batch.items.length;offset+=1000){
    const rows=batch.items.slice(offset,offset+1000),gate=runtime.catalog.prepareCatalogProjectionRows(rows);
    for(const row of rows){
     if(typeof row?.id!=='string'||!row.id||row.id!==row.id.trim()){invalidIds++;continue;}
     if(ids.has(row.id))duplicates.add(row.id);ids.add(row.id);if(row.market!=='uae')foreignMarkets++;
    }
    for(const row of gate){if(eligible.has(row.id))eligibleDuplicates.add(row.id);eligible.add(row.id);
     if(label==='immutable'&&samples.length<CONTRACT.limits.samples&&Object.values(memberships).some(set=>set&&!set.has(row.id))){
      const raw=rows.find(item=>item.id===row.id);samples.push(describeMissing(raw,runtime,memberships));
     }
    }
    const ordinary=await runtime.editorial.withCatalogEditorial(async()=>runtime.catalog.prepareCatalogProjectionRows(rows));
    for(const row of ordinary)publicEligible.add(row.id);
   }
  }
  projections[label]={status:'read',generationId:actualGeneration,rows:count,ids,duplicates,invalidIds,foreignMarkets,
   gateEligible:eligible,gateEligibleDuplicates:eligibleDuplicates,ordinaryPublicEligible:publicEligible};
 }
 const immutable=projections.immutable;
 assert(immutable?.status==='read'&&immutable.rows===manifest.markets.uae.count,'immutable_projection_incomplete');
 for(const [label,selector] of Object.entries(selectors)){
  if(selector.status!=='valid')continue;
  selector.missingGateEligible=summary(minus(immutable.gateEligible,memberships[label]));
  selector.missingOrdinaryPublicEligible=summary(minus(immutable.ordinaryPublicEligible,memberships[label]));
  selector.notInImmutableProjection=summary(minus(memberships[label],immutable.ids));
 }
 const publicDifference=projections.public?.status==='read'?{
  onlyImmutable:summary(minus(immutable.ids,projections.public.ids)),onlyPublic:summary(minus(projections.public.ids,immutable.ids)),
 }:null;
 for(const value of Object.values(projections))for(const key of ['ids','duplicates','gateEligible','gateEligibleDuplicates','ordinaryPublicEligible']){
  if(value[key] instanceof Set)value[key]=summary(value[key]);
 }
 const candidate=selectors.candidate;
 const complete=candidate?.status==='valid'&&candidate.schemaReady&&candidate.missingGateEligible.count===0&&candidate.notInImmutableProjection.count===0
  &&candidate.duplicates.count===0&&candidate.invalidIds===0&&candidate.foreignMarkets===0
  &&immutable.duplicates.count===0&&immutable.gateEligibleDuplicates.count===0&&immutable.invalidIds===0&&immutable.foreignMarkets===0;
 return {market:'uae',manifestRows:manifest.markets.uae.count,selectors,projections,publicDifference,missingSamples:samples,
  observedCandidateCoverage:complete?'complete':'incomplete_or_unavailable',releaseAccepted:false};
}

export async function main(root){
 root=path.resolve(root);process.chdir(root);
 const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
 const source=git('rev-parse','HEAD');assert(own(CONTRACT.sources,source),'source_unreviewed');
 assert(!git('status','--porcelain','--untracked-files=no'),'source_dirty');
 const runtime=async relative=>{const value=await import(pathToFileURL(path.join(root,relative)).href);return value.default||value;};
 const calculation=CONTRACT.sources[source];
 const version=await runtime('scripts/catalog-calculation-version.mjs');assert(version.calculationVersion(root)===calculation,'calculation_mismatch');
 process.env.JSON_STORAGE_DRIVER='object';process.env.CATALOG_STORAGE_TIMING='0';
 process.env.AVTOCENA_RELEASE_SHA=source;process.env.AVTOCENA_CALCULATION_VERSION=calculation;
 const directories={base:'budget-markets-v3',candidate:`budget-markets-v7/${hash([CONTRACT.encyclopedia,calculation])}`};
 if(source!=='e8462585e8998eaae5a003831a38d79263ca5649')directories.previousCandidate=`budget-markets-v7/${hash([CONTRACT.encyclopedia,CONTRACT.sources.e8462585e8998eaae5a003831a38d79263ca5649])}`;
 const allowed=readKeyPolicy(Object.values(directories)),network=fenceNetwork(process.env,allowed);
 globalThis.fetch=network.fetch;
 const {getJsonStorage}=await runtime('apps/web/lib/data.ts'),storage=getJsonStorage(),storageReads=fenceStorage(storage,allowed);
 const health=async()=>{const response=await fetch('https://avtocena.com/api/health');assert(response.ok,'health_unavailable');
  const value=await response.json();assert(value.ok===true&&value.releaseSha===CONTRACT.liveRelease&&value.calculationVersion===CONTRACT.liveCalculation,'live_identity_changed');};
 await health();
 const manifest=await storage.readJsonWithMeta('catalog/manifest.json',null);
 assert(manifest.found&&manifest.etag&&manifest.value?.generationId===CONTRACT.generation,'generation_changed');
 assert(Number.isSafeInteger(manifest.value.markets?.uae?.count)&&manifest.value.markets.uae.count>0
  &&manifest.value.markets.uae.count<=CONTRACT.limits.rows,'uae_partition_invalid');
 const roots=['catalog/import-lock.json','catalog-editorial/current.json',
  `knowledge/encyclopedia/calculation-releases/${CONTRACT.liveRelease}.json`,
  `catalog/generations/${CONTRACT.generation}/indexes/projection/uae.json`,'catalog/public/projection/uae.json',
  ...Object.values(directories).map(directory=>`catalog/generations/${CONTRACT.generation}/indexes/${directory}/ready.json`)];
 const initial=new Map();for(const key of roots){const value=await storage.readObjectMetadata(key);
  assert(!value.found||Boolean(value.etag),'object_revision_missing');initial.set(key,value);}
 const binding=await storage.readJson(`knowledge/encyclopedia/calculation-releases/${CONTRACT.liveRelease}.json`,null);
 assert(binding?.release===CONTRACT.liveRelease&&binding.digest===CONTRACT.encyclopedia
  &&binding.key===`knowledge/encyclopedia/calculation-indexes/${CONTRACT.encyclopedia}.json`,'private_binding_mismatch');
 const restore=await runtime('scripts/encyclopedia/restore-calculation-index.mjs');
 assert(!git('ls-files','data/knowledge/encyclopedia/calculation-v1.json'),'private_index_path_tracked');
 assert(await restore.restoreReleaseEncyclopedia(storage,root,CONTRACT.liveRelease)===CONTRACT.encyclopedia,'private_index_mismatch');
 const modules={};for(const [name,file] of Object.entries({catalog:'catalog/storage.ts',publication:'catalog/budget-selector-publication.ts',
  parts:'catalog-projection-parts.ts',editorial:'catalog/editorial.ts',manual:'catalog/uae-manual-specifications.ts',
  encyclopedia:'encyclopedia/calculation-index.ts',evidence:'encyclopedia/calculation-evidence.ts',safety:'catalog/safe-public-pricing.ts'}))modules[name]=await runtime('apps/web/lib/'+file);
 assert(modules.encyclopedia.readCalculationIndex()?.digest===CONTRACT.encyclopedia,'runtime_private_index_mismatch');
 const day=new Date().toISOString().slice(0,10),policyDay=new Date(Date.now()+7*3600000).toISOString().slice(0,10);
 const result=await inspectUaeCoverage({storage,runtime:modules,selectorDirectories:directories,manifest:manifest.value});
 for(const [key,before] of initial){const after=await storage.readObjectMetadata(key);
  assert(before.found===after.found&&before.etag===after.etag,'observed_object_changed');}
 const after=await storage.readJsonWithMeta('catalog/manifest.json',null);
 assert(after.found&&after.etag===manifest.etag&&hash(after.value)===hash(manifest.value),'manifest_changed');
 assert(day===new Date().toISOString().slice(0,10)&&policyDay===new Date(Date.now()+7*3600000).toISOString().slice(0,10),'policy_day_changed');
 await health();assert(git('rev-parse','HEAD')===source&&!git('status','--porcelain','--untracked-files=no'),'source_changed');
 assert(storageReads.readFailures===0&&storageReads.blockedOperations===0,'read_incomplete');
 const report={version:1,diagnosticOnly:true,checkedAt:new Date().toISOString(),source,calculationVersion:calculation,
  installedSource:CONTRACT.liveRelease,generationId:CONTRACT.generation,encyclopediaDigest:CONTRACT.encyclopedia,
  readOnly:true,storageWrites:0,privateIndexRestoredLocally:true,limits:CONTRACT.limits,network:network.stats,storageReads,...result};
 console.log(JSON.stringify(report));return report;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 main(process.argv[2]||process.cwd()).then(report=>{if(report.observedCandidateCoverage!=='complete')process.exitCode=2;})
  .catch(error=>{const code=/^coverage_[a-z_]+$/.test(error?.message||'')?error.message:'coverage_read_failed';
   console.log(JSON.stringify({version:1,diagnosticOnly:true,releaseAccepted:false,readOnly:true,error:code}));process.exitCode=1;});
}
