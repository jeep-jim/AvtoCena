import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createInterface} from 'node:readline';
import {NATIVE_OLD,ORIGIN,offerId,classifyPredecessor} from './replay.mjs';
import {FRESH,hash} from './chain.mjs';
const HEX=/^[0-9a-f]{64}$/, ID=/^[0-9a-f]{24}$/;
const histHash='4cb1c0ef98082f3b19a44bf8abe43e9ee0637b166d7e924e67d4ed3986e9d33e';
const req=(x,c)=>assert.ok(x,c);
const stable=(obj)=>Array.isArray(obj)?obj.map(stable):
 obj&&typeof obj==='object'?Object.fromEntries(Object.keys(obj).sort().map(k=>[k,stable(obj[k])])):obj;
const canonical=(values)=>hash(stable(values));
export async function readOldArchive(stream){
 const input=createInterface({input:stream,crlfDelay:Infinity}), rows=[], historicRemovals=[];
 let header=null, rowHash=createHash('sha256'), removedHash=createHash('sha256');
 for await(const line of input){
   req(Buffer.byteLength(line)<8*1024*1024,'uae_archive_input_line_too_large');
   const value=JSON.parse(line);
   if(!header){header=value;req(header.kind==='uae_archive_full_input'&&header.count===27581
      &&header.cursor===324989&&header.observedThrough==='2026-11-19T23:40:39.128Z'&&header.normalizedSha256===NATIVE_OLD
      &&header.historicRemovals===1263&&header.historicRemovalsSha256===histHash,'uae_exact_old_archive_header');continue;}
   if(rows.length<header.count){rows.push(value);rowHash.update(line+'\n');}
   else{req(historicRemovals.length<header.historicRemovals,'uae_historic_removal_bound');historicRemovals.push(value);removedHash.update(line+'\n');}
 }
 req(header!==null&&rows.length===27581&&historicRemovals.length===1263
   &&rowHash.digest('hex')===NATIVE_OLD&&removedHash.digest('hex')===histHash,'uae_authenticated_archive_stream_drift');
 return {priorRows:rows,historicRemovals};
}
function receipt(kind,fields){return {kind,version:1,market:'uae',...fields};}
/** Price provenance checks, not a pricing engine. 'prepare' must be the bound exact native callback. */
export async function prepareOutcomes({replayed,predecessor,prepare,proof,native,clock=Date.now}){
 const now=clock();
 req(proof?.release==='22867cbcfaee27b2e8917b6bf880e44827f67b60'&&proof.calculation==='4654386ca34f04041effe31f38259d0fae9c396ecda35c364e3a18dd125a4b90'
  &&['fxWireSha256','editorialSha256','retainedDetailsSha256','priceInputsSha256','photoRightsSha256'].every(k=>HEX.test(proof[k]))
  &&Number.isSafeInteger(proof.legalValidUntil)&&proof.legalValidUntil>now&&Date.parse(replayed.observedThrough)<=now
  &&now-Date.parse(replayed.observedThrough)<48*3600000,'uae_bound_buyer_inputs');
 req(typeof native?.isSeller==='function'&&typeof native?.isRequest==='function'&&typeof native?.deliveredRub==='function'&&typeof native?.deliverablePhotoProof==='function'
  &&typeof prepare==='function','uae_exact_native_port');
 const ids=new Set(), details=[], outcome=new Map(), counters={seller:0,onRequest:0,retainedDelivered:0};
 const retained=new Map();
 for(const row of predecessor){
  req(!retained.has(row.id),'uae_retained_identity');
  retained.set(row.id,row);
 }
 for(const [key,raw] of replayed.rows){
  const id=offerId(key);req(ID.test(id)&&!ids.has(id)&&raw?.id===id&&raw.sourceId===ORIGIN,'uae_prepare_staged_id');ids.add(id);
  if(replayed.held.has(key)){outcome.set(key,replayed.held.get(key).reason);continue;}
  const old=retained.get(id);
  const decision=await prepare(raw,old);
  if(!decision||decision.kind==='needsQualification'){outcome.set(key,'unknown_native_buyer_qualification');continue;}
  if(decision.kind==='notEligible'){
   req(['editorial_hidden','native_vehicle_scope','native_inventory_age','native_retention','photo_rights_denied'].includes(decision.reason),'uae_no_fabricated_exclusion');
   outcome.set(key,decision.reason);continue;
  }
  const offer=decision.offer, state=decision.kind;
  req(['seller','onRequest','retainedDelivered'].includes(state)&&offer?.id===id&&offer.sourceId===ORIGIN
   &&offer.market==='uae'&&offer.status==='active'&&(!offer.images?.length||native.deliverablePhotoProof(offer,proof.photoRightsSha256)),
   'uae_buyer_native_offer_identity_or_photos');
  const delivered=native.deliveredRub(offer)||0;
  if(old?.exactNativeDeliveredRub>0){
   req(state==='retainedDelivered'&&old.exactNativeDeliveredRub===delivered
     &&old.exactNativeReceiptSha256===decision.retainedNativeReceiptSha256&&HEX.test(decision.retainedNativeReceiptSha256)
     &&offer.sourcePrice===raw.sourcePrice,'uae_retained_delivered_price_changed');
  }
  if(state==='retainedDelivered'){
   req(old?.exactNativeDeliveredRub>0&&delivered>0,'uae_retained_delivered_exact_predecessor');
  }else if(state==='seller'){
   req(!delivered&&native.isSeller(offer)&&offer.sourceCurrency==='AED'&&offer.sourcePrice===raw.sourcePrice
     &&offer.calculationSnapshot?.currencyRate?.rateSource==='cbr'&&offer.calculationSnapshot?.currencyRate?.rateDate===proof.fxRateDate
     &&Number.isFinite(proof.aedRub)&&proof.aedRub>0&&offer.sellerPriceRub===Math.round(raw.sourcePrice*proof.aedRub),'uae_seller_amount_unbound_or_local_total');
  }else{
   req(!delivered&&raw.sourcePrice==null&&native.isRequest(offer),'uae_no_invented_price_on_request');
  }
  counters[state]++;outcome.set(key,state);details.push(offer);
 }
 const dispositions=classifyPredecessor({old:predecessor,result:replayed,now,admittedDirty:outcome});
 const unknown=[...outcome.values()].filter(x=>/unknown|review|qualification|without|invalid/.test(x)).length;
 const historicDecisionDigest=canonical(dispositions.rows);
 const priceReceipt=receipt('uae-buyer-price-evidence-v1',{...proof,admitted:counters,
    admittedPriceIdentity:canonical(details.map(x=>[x.id,x.catalogPricingMode??null,x.sellerPriceRub??null,native.deliveredRub(x)||null]).sort()),
    historicDecisionDigest});
 const sourceReceipt=receipt('uae-full-source-replay-evidence-v1',{deltaSeal:FRESH.seal,deltaChain:FRESH.chain,
   cursor:FRESH.cursor,observedThrough:replayed.observedThrough,sourceRows:replayed.rows.size,rawHeld:replayed.held.size,
   explicitRemovals:replayed.removals.size,historicDecisionDigest,prepared:counters,unknownBuyerRows:unknown,unresolvedPredecessor:dispositions.unresolved});
 return {sourceReceipt,priceReceipt,dispositions,details,admitted:counters,
  canProposeReady:unknown===0&&replayed.held.size===0&&dispositions.unresolved===0&&details.length>0,
  doNotPublish:true};
}
