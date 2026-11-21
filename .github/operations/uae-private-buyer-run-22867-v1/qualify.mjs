import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
export const EXPECTED=Object.freeze({
 root:'catalog/operations/uae-source-prepared/v1/44864273301/attempt-1/',
 sha256:'e715e75702b515764cd39eb67fadfbeaf072eba2286b39e19ae3c179aaa0701c',
 deltaSha256:'7b9a244bc6492fb962c7b4401d5ec3993dfc26c28568fc8e6cdcdc3a03a4edc8',
 release:'22867cbcfaee27b2e8917b6bf880e44827f67b60', calc:'4654386ca34f04041effe31f38259d0fae9c396ecda35c364e3a18dd125a4b90',
 cursor:327359, sourceCount:27957, oldCount:25484, holds:5, objects:311,
 observed:'2026-11-21T03:45:04.942Z',
});
export const EDITORIAL_KEY='catalog-editorial/current.json', FX_KEY='fees/exchange-rates.json';
export const CBR_21_NOV=Object.freeze({rateDate:'2026-11-21',AED:22.3801,USD:82.1911,EUR:90.3445});
const SHA=/^[a-f0-9]{64}$/, ID=/^[a-f0-9]{24}$/, OLD_PATH=/^catalog\/generations\/gen_\d{13}_[a-f0-9]{8}\/offers\/uae\/chunk-\d{4,6}\.json$/;
const groupRE=/^(source-input|predecessor-evidence|dispositions|source-holds)$/;
const req=(v,n)=>assert.ok(v,n);
const sha=data=>createHash('sha256').update(data).digest('hex');
const objSha=x=>sha(JSON.stringify(x));
export async function loadSourceEvidence(read,expected=EXPECTED){
 const w=await read(expected.root+'source-prepared.json',1024*1024);
 req(Buffer.isBuffer(w)&&w.length>0&&w.length<=1024*1024&&sha(w)===expected.sha256,'uae_qualified_exact_source_seal');
 const sealed=JSON.parse(w.toString());
 req(sealed.version===1&&sealed.kind==='uae-source-prepared-v2'&&sealed.market==='uae'&&sealed.inputOnly===true
   &&sealed.cursor===expected.cursor&&sealed.sourceObservedThrough===expected.observed&&sealed.newSourceSeal===expected.deltaSha256
   &&sealed.oldPublicCount===expected.oldCount&&sealed.newSourceCount===expected.sourceCount&&sealed.sourceHeld===expected.holds
   &&sealed.supplierRequests===0&&sealed.publicPointerWrites===0&&sealed.cursorWrites===0
   &&sealed.exactReader?.releaseSha===expected.release&&sealed.exactReader?.calculationVersion===expected.calc
   &&sealed.servable===false&&sealed.publicationAllowed===false,'uae_qualified_source_identity');
 const byName=new Map(sealed.inputFiles.map(x=>[x.name,x]));
 req(sealed.inputFiles.length===4&&byName.size===4&&[...byName.keys()].every(x=>groupRE.test(x))
  &&[...byName.values()].reduce((n,g)=>n+g.chunks.length,0)===expected.objects&&sealed.stageWrites===expected.objects+1,
 'uae_qualified_source_plan');
 req(Array.isArray(sealed.protectedPredecessorRefs)&&sealed.protectedPredecessorRefs.length>0&&sealed.protectedPredecessorRefs.length<=200
  &&new Set(sealed.protectedPredecessorRefs.map(x=>x.key)).size===sealed.protectedPredecessorRefs.length
  &&sealed.protectedPredecessorRefs.every(x=>OLD_PATH.test(x.key)&&SHA.test(x.sha256)&&x.rows>0&&x.rows<=500&&x.bytes>0&&x.bytes<=8*1024*1024)
  &&sealed.protectedPredecessorRefs.reduce((n,x)=>n+x.rows,0)===expected.oldCount,'uae_qualified_predecessor_references');
 const done=new Set();
 async function* group(name){
  req(groupRE.test(name)&&!done.has(name),'uae_qualified_source_group');
  done.add(name);
  const m=byName.get(name), digest=createHash('sha256');let count=0,bytes=0;
  for(const [i,b] of m.chunks.entries()){
   const exact=name+'/chunk-'+String(i).padStart(4,'0')+'.ndjson';
   req(b.key===exact&&SHA.test(b.sha256)&&b.bytes>0&&b.bytes<=4*1024*1024&&b.rows>0&&b.rows<=256,'uae_qualified_shard_descriptor');
   const raw=await read(expected.root+exact,b.bytes);
   req(Buffer.isBuffer(raw)&&raw.length===b.bytes&&raw.at(-1)===10&&sha(raw)===b.sha256,'uae_qualified_shard_wire');
   const lines=raw.toString().slice(0,-1).split('\n');
   req(lines.length===b.rows,'uae_qualified_shard_row_count');
   count+=b.rows;bytes+=b.bytes;digest.update(raw);
   for(const line of lines)yield JSON.parse(line);
  }
  req(count===m.count&&bytes===m.bytes&&digest.digest('hex')===m.sha256,'uae_qualified_group_not_complete');
 }
 return {sealed,group};
}
/** Keep authorization independent of supplied rows, provider data, and market flags.
 * reviewGrant is a trusted retailer legal/owner-review record, never typed from a feed URL. */
export function businessAuthority({reviewGrant,editorial,fx,expected=EXPECTED,now}){
 req(Number.isSafeInteger(now)&&now>=Date.parse(expected.observed)&&now-Date.parse(expected.observed)<48*3600000,
  'uae_qualified_fresh_source_only');
 const blockers=[];
 const fxThrough=Date.parse(fx?.validThrough||'');
 if(!editorial||editorial.key!==EDITORIAL_KEY||!SHA.test(editorial.wireSha256||'')||!editorial.etagSha256
   ||!editorial.revision||!editorial.index||editorial.index.revision!==editorial.revision)blockers.push('exact_current_crm_editorial_not_verified');
 if(!fx||fx.key!==FX_KEY||!SHA.test(fx.wireSha256||'')||!fx.etagSha256||!Number.isFinite(fxThrough)||now>=fxThrough||!['AED','USD','EUR'].every(k=>
    fx.rates?.[k]?.rateSource==='cbr'&&fx.rates[k].cbrRate===CBR_21_NOV[k]&&fx.rates[k].nominal===1
    &&fx.rates[k].rateDate===CBR_21_NOV.rateDate&&Date.parse(fx.rates[k].rateDate)<=now))
    blockers.push('exact_applicable_cbr_vector_not_verified');
 const g=reviewGrant?.value;
 let publication=false, photos=false;
 if(g?.version===1&&g.market==='uae'&&g.source==='dubicars_feed'&&g.sourceId==='dubicars_uae_exact'
   &&g.origin==='auto_api_dubicars_v2'&&g.destination==='https://avtocena.com'&&g.paidContractListingRepublication===true
   &&SHA.test(g.verifiedGrantDocumentSha256)&&SHA.test(reviewGrant.wireSha256||'')&&reviewGrant.reviewedByAuthorizedBuyer===true
   &&now>=Date.parse(g.validFrom)&&now<Date.parse(g.validThrough)){
   publication=true;photos=g.paidContractPhotoRepublication===true;
 }
 if(!publication)blockers.push('paid_listing_republication_grant_not_verified');
 if(!photos)blockers.push('paid_source_photo_republication_grant_not_verified');
 return {blockers,publication,photos,authorizesSourceImages:photos,
  legalValidUntil:publication&&Number.isFinite(fxThrough)&&fxThrough>now?Math.min(Date.parse(g.validThrough),fxThrough,Date.parse(expected.observed)+48*3600000):null,
  canQualifyPrivately:!blockers.some(x=>/editorial|cbr/.test(x)),canPublish:false};
}
const compactObs=e=>e.lastSeenAt??e.updatedAt??e.appearedAt;
export function predecessorDisposition({decision,evidence,now,ports}){
 req(decision?.id===evidence?.id&&ID.test(evidence.id)&&decision.sourceOfferId===evidence.sourceOfferId
   &&evidence.market==='uae'&&evidence.sourceId==='dubicars_uae_exact','uae_qualified_prior_disposition_identity');
 if(decision.disposition==='provider_explicit_removed_not_sold')return {state:'removed_not_sold'};
 if(decision.disposition==='present_in_source_needs_native_admission')return {state:'live_id_has_current_source_counterpart'};
 if(decision.disposition==='absence_not_sale_requires_comparison'){
  const observedAt=compactObs(evidence);
  if(!Number.isFinite(Date.parse(observedAt))||Date.parse(observedAt)>now)return {state:'held_missing_predecessor_date'};
  if(ports.withinRetention({market:'uae',operational:{lastSeenAt:observedAt}},now))
    return {state:'retain_exact_predecessor_not_fresh',observedAt,needsWireRead:true};
  return {state:'expired_policy_not_sold',observedAt};
 }
 return {state:'held_new_source_not_qualified'};
}
export async function exactPriorRow({evidence,ref,read}){
 req(ref.key===evidence.immutableKey&&OLD_PATH.test(ref.key)&&SHA.test(ref.sha256)&&ref.bytes<=8*1024*1024,'uae_qualified_prior_wire_locator');
 const w=await read(ref.key,ref.bytes);req(Buffer.isBuffer(w)&&w.length===ref.bytes&&sha(w)===ref.sha256,'uae_qualified_prior_wire_changed');
 const rows=JSON.parse(w.toString());
 req(Array.isArray(rows)&&rows.length===ref.rows&&Number.isSafeInteger(evidence.ordinal)&&evidence.ordinal>=0,'uae_qualified_prior_wire_shape');
 const row=rows[evidence.ordinal];
 req(row?.id===evidence.id&&String(row.sourceOfferId)===evidence.sourceOfferId&&objSha(row)===evidence.rowSha256,'uae_qualified_prior_row_changed');
 return row;
}

/** Exact snapshot classification, pricing only through the installed native producer.
 * Does not serialize to serving paths. Decision callback avoids guessing manual overrides. */
export async function classifyPrepared({source,authority,editorial,fx,read,ports,now}){
 req(authority.canQualifyPrivately&&ports.releaseSha===EXPECTED.release&&ports.calculationVersion===EXPECTED.calc,
  'uae_qualified_native_inputs_required');
 const old=new Map(), decisions=new Map(), holds=new Map(), matched=new Set(), outcomes=new Map(), candidateOffers=[];
 const counts={};const inc=k=>{counts[k]=(counts[k]||0)+1;};
 const refs=new Map(source.sealed.protectedPredecessorRefs.map(r=>[r.key,r]));
 for await(const item of source.group('predecessor-evidence')){
  req(ID.test(item.id)&&!old.has(item.id)&&refs.has(item.immutableKey)&&SHA.test(item.rowSha256)&&SHA.test(item.nativePriceEvidenceSha256),
   'uae_qualified_compact_predecessor_row');
  old.set(item.id,item);
 }
 for await(const item of source.group('dispositions')){
  req(old.has(item.id)&&!decisions.has(item.id),'uae_qualified_predecessor_coverage');
  decisions.set(item.id,predecessorDisposition({decision:item,evidence:old.get(item.id),now,ports}));
 }
 for await(const item of source.group('source-holds')){
  req(item?.sourceOfferId&&typeof item.hold?.reason==='string'&&!holds.has(String(item.sourceOfferId)),'uae_qualified_native_hold_row');
  holds.set(String(item.sourceOfferId),item.hold);
 }
 req(old.size===source.sealed.oldPublicCount&&decisions.size===old.size&&holds.size===source.sealed.sourceHeld,'uae_qualified_complete_old_and_holds');
 const optionalPhotos=authority.photos;
 const ids=new Set();
 async function native({row,retained=false,prior}){
  const original=row;
  const match=ports.editorialEntry(row,editorial.index);
  if(ports.editorialHidden(row,editorial.index))return 'editorial_contract_hidden';
  if(match?.sellerPrice&&(match.sellerPrice.amount!==row.sourcePrice||match.sellerPrice.currency!==row.sourceCurrency))
    return 'held_editorial_money_requires_exact_path';
  row=ports.applyEditorial(row,editorial.index);
  if(!ports.inScope(row))return 'native_vehicle_scope';
  if(!ports.withinRetention(row,now))return 'expired_policy_not_sold';
  const hasPublicGallery=(row.images?.length??0)>0;
  if(hasPublicGallery&&match?.photos&&!ports.exactEditorialPhotoReady(row,match))return 'held_editorial_gallery';
  if(hasPublicGallery&&!match?.photos&&!optionalPhotos&&!retained)inc('private_source_gallery_unverified_for_public');
  if(retained&&!ports.exactRetainedBuyerProof(row,prior))return 'held_predecessor_display_proof';
  const refreshed=retained?row:await ports.prepareSeller(row,fx);
  if(!refreshed||!ports.siteEligible(refreshed))return 'held_native_admission_needs_qualification';
  const amount=ports.deliveredRub(refreshed)||0;
  let s;
  if(amount>0){
   if(!prior||prior.pricing.exactInlineDeliveredRub!==amount||!ports.exactRetainedBuyerProof(refreshed,prior))
    return 'held_new_or_changed_delivered_needs_native_receipt';
   s='retainedDelivered';
  } else if(ports.isSeller(refreshed)){
   if(!retained){
    const rate=refreshed.calculationSnapshot?.currencyRate;
    req(refreshed.sourceCurrency==='AED'&&refreshed.sourcePrice===original.sourcePrice&&rate?.rateSource==='cbr'
      &&rate.rateDate===CBR_21_NOV.rateDate&&refreshed.sellerPriceRub===Math.round(refreshed.sourcePrice*CBR_21_NOV.AED),
      'uae_qualified_seller_price_parity');
   }
   s='seller';
  } else if(original.sourcePrice==null&&ports.isRequest(refreshed))s='onRequest';
  else {return 'held_non_native_or_invented_price';}
  const receipt={id:refreshed.id,kind:s,sourceState:retained?'legacy_retention_not_fresh':'verified_source_state',
   priceStatus:s,rawSourceObservedAt:original.operational?.lastSeenAt??original.updatedAt,exactPreserved:retained};
  candidateOffers.push({row:refreshed,receipt});
  return s;
 }
 for await(const x of source.group('source-input')){
  const row=x.row, key=String(row?.sourceOfferId);
  req(row?.market==='uae'&&row.sourceId==='dubicars_uae_exact'&&ID.test(row.id)&&!ids.has(row.id)
     &&((!x.hold&&!holds.has(key))||(x.hold&&objSha(x.hold)===objSha(holds.get(key)))),'uae_qualified_current_source_membership');
  ids.add(row.id);if(old.has(row.id))matched.add(row.id);
  const k=holds.has(key)?'held_unqualified_paid_source_price':await native({row,prior:old.get(row.id)});
  outcomes.set(row.id,k);inc(k);
 }
 req(ids.size===source.sealed.newSourceCount,'uae_qualified_complete_source');
 let currentShard=null,currentRows=null;
 const takePrior=async(evidence)=>{
  const ref=refs.get(evidence.immutableKey);
  req(ref&&OLD_PATH.test(ref.key)&&SHA.test(ref.sha256),'uae_qualified_prior_wire_locator');
  if(currentShard!==ref.key){
   const w=await read(ref.key,ref.bytes);req(Buffer.isBuffer(w)&&w.length===ref.bytes&&sha(w)===ref.sha256,'uae_qualified_prior_wire_changed');
   currentRows=JSON.parse(w.toString()); currentShard=ref.key;
   req(Array.isArray(currentRows)&&currentRows.length===ref.rows,'uae_qualified_prior_wire_shape');
  }
  req(Number.isSafeInteger(evidence.ordinal)&&evidence.ordinal>=0,'uae_qualified_prior_wire_shape');
  const row=currentRows[evidence.ordinal];
  req(row?.id===evidence.id&&String(row.sourceOfferId)===evidence.sourceOfferId&&objSha(row)===evidence.rowSha256,'uae_qualified_prior_row_changed');
  return row;
 };
 const oldDecisions=[...decisions].sort(([a],[b])=>old.get(a).immutableKey.localeCompare(old.get(b).immutableKey));
 for(const [id,d] of oldDecisions){
  if(d.state==='retain_exact_predecessor_not_fresh'){
    req(!ids.has(id),'uae_qualified_absent_has_source_counterpart');
    const o=old.get(id),row=await takePrior(o);
    const k=await native({row,retained:true,prior:o});inc('prior_'+k);outcomes.set(id,k);continue;
  }
  if(d.state==='live_id_has_current_source_counterpart')req(matched.has(id),'uae_qualified_lost_exact_source_match');
  else if(d.state==='removed_not_sold'||d.state==='expired_policy_not_sold'){
    req(!ids.has(id),'uae_qualified_removed_source_overlap');
    inc('prior_'+d.state);outcomes.set(id,d.state);
  }else if(d.state.startsWith('held_')&&!outcomes.has(id)){inc('prior_'+d.state);outcomes.set(id,d.state);}
 }
 const heldCount=[...outcomes.values()].filter(x=>x.startsWith('held_')).length;
 const canMaterialize=authority.publication&&authority.photos&&authority.legalValidUntil>now&&heldCount===0&&candidateOffers.length>0;
 return {counts,heldCount,sourceRows:ids.size,exactPredecessors:old.size,candidateOffers,outcomes,authority,
  canMaterialize,published:false,cursorAdvanced:false};
}
