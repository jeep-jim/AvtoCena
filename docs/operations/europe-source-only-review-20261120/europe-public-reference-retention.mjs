// Local proof helper; not a publisher. Never discover keys through LIST or
// expand an append into another market's manifest.
import {createHash} from 'node:crypto';
const GEN='gen_\\d{1,20}_[-a-z0-9]{1,64}';
export const EUROPE_STORED_OFFER_CHUNK=new RegExp('^catalog/generations/('+GEN+')/offers/europe/chunk-\\d{4,8}\\.json$');
const validGen=new RegExp('^'+GEN+'$');
const relative=/^chunk-\d{4,8}$/;
const sha=x=>createHash('sha256').update(x).digest('hex');
const ask=(test,code)=>{if(!test)throw Error(code);};

function canonicalReference(generation,chunk){
 if(typeof chunk==='string'&&relative.test(chunk))return 'catalog/generations/'+generation+'/offers/europe/'+chunk+'.json';
 ask(typeof chunk==='string'&&EUROPE_STORED_OFFER_CHUNK.test(chunk),'malformed_or_foreign_europe_chunk_reference');
 return chunk;
}
function europeBaseline(manifest) {
 ask(manifest?.version===2&&validGen.test(manifest.generationId)&&manifest.markets&&typeof manifest.markets==='object'&&!Array.isArray(manifest.markets),
      'europe_baseline_manifest_invalid');
 const d=manifest.markets.europe;
 if(d===undefined)return null;
 ask(Number.isSafeInteger(d.count)&&d.count>=0&&Array.isArray(d.chunks)&&(d.count===0?d.chunks.length===0:d.chunks.length>0)
   &&d.chunks.length<=10000,'europe_baseline_descriptor_invalid');
 const references=d.chunks.map(chunk=>canonicalReference(manifest.generationId,chunk));
 ask(references.length===new Set(references).size,'duplicate_europe_chunk_reference');
 return {d,references};
}
export function europeReferencedGenerationIds(...manifests){
 const ids=new Set();
 for(const manifest of manifests){
  // Existing older sites can have no previous pointer. Do not allow a
  // present/invalid pointer to be interpreted as empty; callers should
  // independently require both pointers before approving append activation.
  if(manifest===null||manifest===undefined)continue;
  const base=europeBaseline(manifest);
  if(base)for(const key of base.references)ids.add(key.match(EUROPE_STORED_OFFER_CHUNK)[1]);
 }
 return ids;
}
const published=Object.freeze({
 baseSha:'4c34c20d9784b571414390cab450ceeeaee60b00c168476100419ec5c05cb038',
 generation:'gen_1794878284419_a611dfcf',originalCount:38964,originalChunks:78,limitAdditions:1447,
 cut:{runId:44773701560,preservedOverlap:63,additions:1447,
  orderedIdsSha:'2a9a1c8dcfb8706f1702885d6f98949ffc6ee6f0e46d63c56e2b681d340c84f3',
  orderedCompactRowsSha:'e776091390cd4abc995cf2bdbb87e4c1ac2196489c5480af4b864fbec067d6b5'},
});
export function planEuropeAppendReferences(input){return compare(input,published);}
export function rehearseEuropeAppendReferences(input,c){return compare(input,c);}
function compare({baseManifestBytes,nextId,rowsForAdditions,source,market,dryCut},c){
 ask(market==='europe'&&source==='autoscout_europe_open','only_exact_europe_autoscout_scope');
 ask(Buffer.isBuffer(baseManifestBytes)&&baseManifestBytes.length<=1024**2&&sha(baseManifestBytes)===c.baseSha,
   'baseline_wire_commitment_drift');
 const manifest=JSON.parse(baseManifestBytes);
 ask(manifest.generationId===c.generation&&validGen.test(nextId)&&nextId!==c.generation,'unbound_candidate_generation');
 const base=europeBaseline(manifest);
 ask(base&&base.d.count===c.originalCount&&base.references.length===c.originalChunks,'legacy_public_europe_proof_drift');
 ask(Array.isArray(rowsForAdditions)&&rowsForAdditions.length>0&&rowsForAdditions.length<=Math.ceil(c.limitAdditions/500),'candidate_chunk_count_bound');
 if(c.cut)ask(dryCut&&Object.entries(c.cut).every(([k,v])=>dryCut[k]===v),'fresh_native_approved_dry_cut_required');
 const keys=[];let additions=0;
 for(const [i,row] of rowsForAdditions.entries()){
  const relativeName='chunk-'+String(i+1).padStart(4,'0');
  const key=canonicalReference(nextId,relativeName);
  ask(row?.key===key&&Number.isSafeInteger(row.count)&&row.count>0&&row.count<=500&&/^[a-f0-9]{64}$/.test(row.sha256),
    'unbound_candidate_chunk');
  ask(!base.references.includes(key),'candidate_reuses_protected_key');
  additions+=row.count;keys.push(key);
 }
 ask(additions<=c.limitAdditions,'candidate_exceeds_pinned_seller_leads');
 if(c.cut)ask(additions===c.cut.additions,'candidate_count_not_exact_dry_cut');
 const descriptor={...base.d,count:base.d.count+additions,chunks:[...base.references,...keys]};
 const protectedGenerationIds=[...europeReferencedGenerationIds(manifest,{version:2,generationId:nextId,markets:{europe:descriptor}})].sort();
 return {targetMarketOnly:'europe',targetSourceOnly:'autoscout_europe_open',baseGenerationId:manifest.generationId,
  candidateGenerationId:nextId,descriptor,protectedGenerationIds,inheritedCardChunkCount:base.references.length,
  additions,noGlobalManifestBuilt:true,rawBodyRead:false,fullSiblingReadModelsVerified:false,
  readyToActivate:false,cloudWrites:0,providerCalls:0};
}
