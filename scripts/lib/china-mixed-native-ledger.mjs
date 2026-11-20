import {createHash} from 'node:crypto';
const SOURCE='autohome_used_china_open', MARKET='china';
const HASH=/^[a-f0-9]{64}$/, stable=x=>createHash('sha256').update(SOURCE+':'+x).digest('hex').slice(0,24);
const kinds=new Set(['offer','price','removed','quarantine','missing_detail']);
const need=(v,k)=>{if(!v)throw Error('mixed_delta:'+k)};
const integer=n=>Number.isSafeInteger(n)&&n>=0;
function row(value,innerId){
 need(value?.id===stable(innerId)&&value.sourceOfferId===innerId&&value.sourceId===SOURCE&&value.market===MARKET&&
   value.operational?.provider==='auto-api.com'&&value.operational?.detailIdentityVerified===true,'owned_native_row');
 return value;
}
/** Inputs must come from native verified reader. Does not mint archive or serving authority. */
export async function assembleDecisions({cursorFrom,cursorTo,events,expectedEventCount,readFinalReplicaRow,admit,afterVerifiedReaders}){
 need(integer(cursorFrom)&&integer(cursorTo)&&cursorTo>cursorFrom&&integer(expectedEventCount)&&expectedEventCount>=1&&expectedEventCount<=400000,'bounded_terminal');
 const ledger=new Map();let count=0,lastEventId=cursorFrom-1,removalEvents=0;
 for await(const e of events){
  need(++count<=expectedEventCount&&kinds.has(e?.kind)&&integer(e.event)&&e.event>=cursorFrom&&e.event<=cursorTo&&
    e.event>lastEventId&&Number.isFinite(Date.parse(e.at)),'event_sequence');
  lastEventId=e.event;
  const src=e.kind==='offer'?e.offer?.sourceOfferId:e.innerId;
  need(typeof src==='string'&&/^\d{1,20}$/.test(src),'event_identity');if(e.kind==='offer')row(e.offer,src);
  if(e.kind==='price')need(Number.isFinite(e.price)&&e.price>0,'price_event');
  const prior=ledger.get(src);
  if(e.kind==='removed')removalEvents++;
  // Later explicit offer/removal clears an unresolved detail; a price-only update cannot.
  if(prior?.kind==='missing_detail'&&!['offer','removed','quarantine'].includes(e.kind))continue;
  need(e.kind!=='price'||!['removed','quarantine'].includes(prior?.kind),'price_after_unavailable');
  ledger.set(src,e);
 }
 need(count===expectedEventCount,'incomplete_native_events');
 const decisions=new Map();
 for(const [src,e] of ledger){
  const id=stable(src);
  if(e.kind==='missing_detail')throw Error('mixed_delta:unresolved_detail');
  const restored=await readFinalReplicaRow(src);
  if(e.kind==='removed'||e.kind==='quarantine'){
   need(restored===null,'replica_availability_mismatch');
   decisions.set(id,{state:e.kind==='removed'?'explicit_removed':'excluded_quarantine',sourceEventId:e.event});
  }else{
   const value=row(restored,src);
   if(e.kind==='price')need(value.sourcePrice===e.price,'replica_price_mismatch');
   const eligible=await admit(value);
   need(typeof eligible==='boolean','eligibility_unknown');
   decisions.set(id,eligible?{state:'changed_admitted',row:value,sourceEventId:e.event}:{state:'excluded_policy',sourceEventId:e.event});
  }
 }
 await afterVerifiedReaders();
 return {decisions,ledgerCount:count,explicitRemovalEventCount:removalEvents,publicationAuthorized:false};
}
/** Reapply the same legally valid frozen quote context; never reuse across contexts.
 * Both prior and new descriptors are independently hash-verified by caller. */
export async function prepareChangedQuote({decision,verifiedPrior,sourceInputSha256,context,now,calculateWithInstalledEngine}){
 need(decision?.state==='changed_admitted'&&HASH.test(sourceInputSha256)&&Number.isFinite(now)&&
  [context?.fxReceiptSha256,context?.calculationVersion,context?.pricingFingerprint].every(x=>HASH.test(x??''))&&
  Number.isFinite(Date.parse(context.pricingAsOf))&&Date.parse(context.pricingAsOf)<=now&&
  Number.isFinite(context.legalValidUntil)&&context.legalValidUntil>now,'invalid_quote_scope');
 const p=verifiedPrior;
 if(p?.id===decision.row.id&&p.sourceInputSha256===sourceInputSha256&&HASH.test(p.immutableReceiptSha256??'')&&
   p.fxReceiptSha256===context.fxReceiptSha256&&p.calculationVersion===context.calculationVersion&&p.pricingFingerprint===context.pricingFingerprint&&
   p.pricingAsOf===context.pricingAsOf&&Number.isFinite(p.legalValidUntil)&&p.legalValidUntil>now&&typeof p.frozenQuote==='object'&&p.frozenQuote!==null){
    return {mode:'reuse_exact_frozen',quote:p.frozenQuote,provenanceSha256:p.immutableReceiptSha256};
 }
 const quote=await calculateWithInstalledEngine(decision.row,context);
 need(quote?.id===decision.row.id&&Number.isSafeInteger(quote.totalRub)&&quote.totalRub>0,'invalid_quote');
 return {mode:'recalculated_once',quote};
}
