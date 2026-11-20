// Read-only gate for an inert local Europe intent. These records are deliberately
// NOT CatalogManifest v2 and do not confer permission to write any object.
import {createHash} from 'node:crypto';
import {planEuropeAppendReferences,rehearseEuropeAppendReferences,europeReferencedGenerationIds} from './europe-public-reference-retention.mjs';
const EUR=89.8597,A='autoscout_europe_open',market='europe';
const approved=Object.freeze({
 sourceObservedAt:'2026-11-19T23:34:26.268Z',pricingDay:'2026-11-20',eur:EUR,
 pricingUntil:'2026-11-21T00:00:00Z',runtime:'22867cbcfaee27b2e8917b6bf880e44827f67b60',
 calc:'4654386ca34f04041effe31f38259d0fae9c396ecda35c364e3a18dd125a4b90',
 rateSha:'2adeb25ad182398684c4c646e110ded5449f7174e4a4442f8bff6b7d1d32aec6',
 admittedFullRowsSha:'b3b7a4ce414e1af9a7ec680686f956676ee8a4c434133b1ed02b5807cd80081a',
 admittedFullCount:1510,contract:'europe-private-append-reference-intent-v1',
});
const hash=()=>createHash('sha256');
const sha=x=>hash().update(x).digest('hex');
const digestNonNewline=x=>sha(JSON.stringify(x));
const update=(h,x)=>h.update(JSON.stringify(x)+'\n');
const req=(test,code)=>{if(!test)throw Error(code);};
const sameObjectKeys=(a,b)=>Object.keys(a??{}).length===Object.keys(b).length&&Object.entries(b).every(([key,val])=>a[key]===val);
function verifyContext(now,pricing,p){
 req(Number.isSafeInteger(now)&&now>=Date.parse(p.sourceObservedAt)&&now-Date.parse(p.sourceObservedAt)<72*3600000&&
  now<Date.parse(p.pricingUntil)&&new Date(now).toISOString().slice(0,10)===p.pricingDay,'current_source_or_fx_expired');
 req(sameObjectKeys(pricing,{day:p.pricingDay,runtime:p.runtime,calculation:p.calc,cbrWireSha256:p.rateSha,eur:p.eur}),
  'orphan_or_unapproved_pricing_context');
}
export function authorizePrivateAppendIntent(input){return compose(input,approved,planEuropeAppendReferences);}
export function rehearsePrivateAppendIntent(input,p,fixture){return compose(input,{...approved,...p},x=>rehearseEuropeAppendReferences(x,fixture));}
function compose({now,baseManifestBytes,nextId,fullChunks,nativeOwnCompactRows,admittedRowsWire,dryCut,pricing,retentionInputs},p,plan){
 verifyContext(now,pricing,p);
 req(Array.isArray(fullChunks)&&fullChunks.length>0&&fullChunks.length<=3&&Array.isArray(nativeOwnCompactRows)&&nativeOwnCompactRows.length===dryCut?.additions&&
  Number.isSafeInteger(dryCut.additions)&&dryCut.additions>0&&dryCut.additions<=1510,'incomplete_native_stage_rows');
 req(Buffer.isBuffer(admittedRowsWire)&&admittedRowsWire.length>0&&admittedRowsWire.length<=96*1024**2&&
  sha(admittedRowsWire)===p.admittedFullRowsSha,'unapproved_full_native_seller_manifest');
 const approvedRows=JSON.parse(admittedRowsWire);
 req(Array.isArray(approvedRows)&&approvedRows.length===p.admittedFullCount,'wrong_archived_full_admission_count');
 const authoritativeFull=new Map(approvedRows.map(row=>[row.id,row]));
 req(authoritativeFull.size===p.admittedFullCount,'duplicate_archived_native_admission');
 let bytes=0;
 const hashes={ids:hash(),compact:hash()},seen=new Set(),rowsForAdditions=[];
 function verifySeller(r){
  req(r?.market===market&&typeof r.id==='string'&&r.id.length>0&&r.id.length<=128,r?'wrong_stage_scope':'malformed_stage_row');
  req(r.catalogPricingMode==='seller'&&r.calculationStatus==='needs_data'&&r.sourceCurrency==='EUR'&&
   Number.isFinite(r.sourcePrice)&&r.sourcePrice>0&&r.sellerPriceRub===Math.round(r.sourcePrice*p.eur)&&
   r.totalRub===null&&(r.publicVisibleRub??0)===0,'no_delivered_claim_in_seller_stage');
 }
 for(const [i,wire] of fullChunks.entries()){
  req(Buffer.isBuffer(wire)&&wire.length>0&&wire.length<=32*1024**2,'private_chunk_wire_bound');
  bytes+=wire.length;req(bytes<=96*1024**2,'private_total_wire_bound');
  const data=JSON.parse(wire);
  req(Array.isArray(data)&&data.length>0&&data.length<=500&&(i===fullChunks.length-1||data.length===500),'noncanonical_private_chunk_size');
  for(const full of data){
   const compact=nativeOwnCompactRows[seen.size];
   verifySeller(full);verifySeller(compact);
   req(full.sourceId===A&&full.status==='active'&&compact.sourceGroup===A&&full.id===compact.id&&
     full.sourcePrice===compact.sourcePrice&&full.sellerPriceRub===compact.sellerPriceRub&&!seen.has(full.id),'native_identity_order_or_source_drift');
   req(authoritativeFull.has(full.id)&&JSON.stringify(full)===JSON.stringify(authoritativeFull.get(full.id)),
    'native_full_body_or_card_drift');
   seen.add(full.id);update(hashes.ids,full.id);update(hashes.compact,compact);
  }
  rowsForAdditions.push({key:'catalog/generations/'+nextId+'/offers/europe/chunk-'+String(i+1).padStart(4,'0')+'.json',
   sha256:sha(wire),count:data.length});
 }
 req(seen.size===dryCut.additions&&hashes.ids.digest('hex')===dryCut.orderedIdsSha&&hashes.compact.digest('hex')===dryCut.orderedCompactRowsSha,
  'signed_native_addition_digest_drift');
 const scope=plan({market,source:A,baseManifestBytes,nextId,rowsForAdditions,dryCut});
 const inherited=scope.descriptor.chunks.slice(0,scope.inheritedCardChunkCount);
 const inheritedSha=digestNonNewline(inherited);
 const base=JSON.parse(baseManifestBytes), required=[...europeReferencedGenerationIds(base)].sort();
 // This is a private intent admission guard, not proof that a live cleanup
 // controller is installed or that objects exist. It requires the explicit
 // retention obligation to be carried forward with the exact roots.
 req(sameObjectKeys(retentionInputs,{mode:'retain_exact_inherited_public_reference_roots',inheritedRefSetSha256:inheritedSha,
       generationIdsSha256:digestNonNewline(required)}),'inherited_references_not_retained_by_intent');
 return {
  version:1,kind:p.contract,scope:{market,source:A},baseGenerationId:scope.baseGenerationId,candidateGenerationId:nextId,
  sourceProofRun:dryCut.runId,boundPricing:pricing,
  retainedOriginal:{immutableRefs:inherited,orderedRefsSha256:inheritedSha,requiredGenerationIds:required},
  boundCandidate:{archivedFullSellerRowsSha256:p.admittedFullRowsSha,nativeCompactRowsSha256:dryCut.orderedCompactRowsSha,nativeIdsSha256:dryCut.orderedIdsSha,chunks:rowsForAdditions},
  futureEuropeOnlyDescriptor:scope.descriptor,proposedRetentionRefs:[...scope.protectedGenerationIds],
  stagedDataWritten:false,physicalObjectRetentionVerified:false,productionRetentionSeamsDeployed:false,
  internalSettlementProven:false,publicationAuthorized:false,readyToActivate:false,cloudWrites:0,providerCalls:0,
 };
}
