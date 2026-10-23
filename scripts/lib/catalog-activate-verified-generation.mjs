import crypto from 'node:crypto';
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
export async function activateVerifiedGeneration(storage,proof,scope,now=()=>Date.now()){
 const {generationId,expectedBaseGenerationId,expectedCounts,readModelsWrittenAt}=scope;
 const cutoff=Date.parse(readModelsWrittenAt),verifiedAt=Date.parse(proof?.verifiedAt);
 if(!/^gen_\d+_[a-z0-9]+$/.test(generationId)||generationId===expectedBaseGenerationId||!Number.isFinite(cutoff)||!Number.isFinite(verifiedAt)||verifiedAt<cutoff||verifiedAt>now()||now()-verifiedAt>30*60000||proof?.generationId!==generationId||proof?.expectedBaseGenerationId!==expectedBaseGenerationId||proof?.published!==false||proof?.validatedRunId!==scope.validatedRunId||!same(proof.counts,expectedCounts)||proof.manifest?.generationId!==generationId||proof.manifest?.version!==2)throw Error('recovery_proof_invalid');
 const counts=Object.fromEntries(Object.entries(proof.manifest.markets||{}).map(([k,v])=>[k,v.count]));
 if(!same(counts,expectedCounts)||!Object.values(proof.manifest.markets).every(v=>Array.isArray(v.chunks)&&v.chunks.length===Math.ceil(v.count/500)&&v.chunks.every((c,i)=>c===`chunk-${String(i+1).padStart(4,'0')}`)))throw Error('recovery_manifest_invalid');
 const lockPath='catalog/import-lock.json',operationId='catalog_staged_recovery_'+crypto.randomUUID();
 const lock=await storage.readJsonWithMeta(lockPath,null);
 if(Date.parse(lock.value?.lockedUntil||'')>now())throw Error('recovery_writer_busy');
 await storage.writeJson(lockPath,{operationId,operationType:'catalog_staged_recovery_china',startedAt:new Date(now()).toISOString(),lockedUntil:new Date(now()+300000).toISOString()},lock.found?{ifMatch:lock.etag}:{ifNoneMatch:'*'});
 try{
  const [base,internal]=await Promise.all([storage.readJsonWithMeta('catalog/manifest.json',null),storage.readJson('catalog/internal/manifest.json',null)]);
  if(!base.etag||base.value?.generationId!==expectedBaseGenerationId||internal?.generationId!==generationId)throw Error('recovery_base_or_stage_changed');
  const prefix=`catalog/generations/${generationId}/`;
  const immutable=await storage.listObjects(prefix);
  const mutable=await storage.listObjects('catalog/public/');
  const used=mutable.filter(o=>/^catalog\/public\/(?:offers\/|projection\/|projection-brand\/|facets\.json$|brand-summary\.json$)/.test(o.key));
  // A verified generation and its aliases must be unchanged since the original
  // writer completed them. S3 supplies these modification times, not the marker.
  if(!immutable.length||!used.length||[...immutable,...used].some(o=>!Number.isFinite(Date.parse(o.lastModified||''))||Date.parse(o.lastModified)>cutoff))throw Error('recovery_verified_objects_changed');
  const expectedKeys=['catalog/public/projection/all.json','catalog/public/facets.json','catalog/public/brand-summary.json',...Object.keys(expectedCounts).map(m=>`catalog/public/projection/${m}.json`),...Array.from({length:256},(_,i)=>`catalog/public/offers/${i.toString(16).padStart(2,'0')}.json`)];
  const keys=new Set(used.map(o=>o.key));if(expectedKeys.some(k=>!keys.has(k)))throw Error('recovery_alias_missing');
  for(const key of ['catalog/public/facets.json','catalog/public/brand-summary.json'])if((await storage.readJson(key,null))?.generationId!==generationId)throw Error('recovery_alias_generation');
  const currentLock=await storage.readJson(lockPath,null);if(currentLock?.operationId!==operationId||Date.parse(currentLock.lockedUntil)<=now())throw Error('recovery_lock_lost');
  await storage.writeJson('catalog/previous-manifest.json',base.value);
  await storage.writeJson('catalog/manifest.json',proof.manifest,{ifMatch:base.etag});
  return {...proof,published:true,publishedAt:new Date(now()).toISOString(),intakeCursorUnchanged:true};
 }finally{
  const current=await storage.readJsonWithMeta(lockPath,null);
  if(current.value?.operationId===operationId)await storage.writeJson(lockPath,{...current.value,lockedUntil:'',finishedAt:new Date(now()).toISOString()},{ifMatch:current.etag});
 }
}
