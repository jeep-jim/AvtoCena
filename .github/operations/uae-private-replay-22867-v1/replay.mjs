import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
export const ORIGIN='dubicars_uae_exact', NATIVE_OLD='990edf60121625b1426b96ff8660bf7d953157cc0fbcec8ef35a6ede3e1c83f6';
const idRx=/^[1-9]\d{0,17}$/;
const req=(x,c)=>assert.ok(x,c), sha=b=>createHash('sha256').update(b).digest('hex');
export const offerId=key=>sha(ORIGIN+':'+key).slice(0,24);
const isSame=(row,key)=>row?.id===offerId(key)&&String(row.sourceOfferId)===key&&row.market==='uae'
 &&row.sourceId===ORIGIN&&row.status==='active'&&row.sourceCurrency==='AED';
const validPrice=p=>p===null||typeof p==='number'&&Number.isFinite(p)&&p>=0;
const date=s=>Date.parse(s);
const observationHistory=(row,ts)=>({...row,updatedAt:ts,operational:{...row.operational,lastSeenAt:ts}});
/** Never reads network. Caller owns original authenticated raw stream and exact 22867 native normalizer. */
export function replay({priorRows,historicRemovals=[],events,normalize,observedThrough}){
 const rows=new Map(), removals=new Map(), held=new Map(), eventById=new Map();
 const counts={added:0,changed:0,removed:0};
 for(const row of priorRows){
   const key=String(row?.sourceOfferId);
   req(idRx.test(key)&&isSame(row,key)&&!rows.has(key),'uae_native_old_membership');rows.set(key,row);
 }
 for(const r of historicRemovals){
   const key=String(r?.inner_id);
   req(idRx.test(key)&&r.change_type==='removed'&&Number.isSafeInteger(r.id)&&Number.isFinite(date(r.created_at))&&!rows.has(key)&&!removals.has(key),
     'uae_native_old_removal_witness');removals.set(key,r);
 }
 let prevId=null, countsBefore=rows.size;
 for(const e of events){
   const key=String(e?.inner_id);
   req(idRx.test(key)&&Number.isSafeInteger(e.id)&&(prevId===null||e.id===prevId+1)&&Object.hasOwn(counts,e.change_type)
     &&Number.isFinite(date(e.created_at))&&date(e.created_at)<=date(observedThrough)+300000,'uae_native_event_unverified');
   prevId=e.id;counts[e.change_type]++;
   const priorEvent=eventById.get(key)||removals.get(key);
   req(!priorEvent||date(priorEvent.created_at)<=date(e.created_at),'uae_same_id_event_clock_regressed');
   eventById.set(key,e);
   if(e.change_type==='removed'){
     rows.delete(key);held.delete(key);removals.set(key,{id:e.id,inner_id:key,change_type:'removed',created_at:e.created_at});continue;
   }
   if(e.change_type==='added'){
     const normalized=normalize(e,e.created_at);
     if(!isSame(normalized,key)){
       held.set(key,{reason:'native_identity_or_scope_requires_review',eventId:e.id});
       continue;
     }
     rows.set(key,normalized);removals.delete(key);held.delete(key);continue;
   }
   if(removals.has(key)){held.set(key,{reason:'price_after_explicit_removal_without_readd',eventId:e.id});continue;}
   if(!rows.has(key)){held.set(key,{reason:'price_change_without_exact_active_id',eventId:e.id});continue;}
   if(!e.data||Object.keys(e.data).length!==1||!Object.hasOwn(e.data,'new_price')||!validPrice(e.data.new_price)){
     held.set(key,{reason:'invalid_or_unqualified_source_price',eventId:e.id});continue;
   }
   const h=held.get(key);
   if(h&&h.reason!=='invalid_or_unqualified_source_price')continue;
   const after=observationHistory(rows.get(key),e.created_at);
   after.sourcePrice=e.data.new_price===0||e.data.new_price===null?undefined:e.data.new_price;
   after.calculationStatus='needs_data';after.totalRub=null;
   // Raw source replica must not inherit a seller or delivered computation from older data.
   for(const f of ['sellerPriceRub','publicVisibleRub','calculationSnapshot','savedCalculationPreview','deliveredCalculationPreview','japanDeliveredPreview'])delete after[f];
   rows.set(key,after);held.delete(key);
 }
 return {market:'uae',rows,removals,held,counts,countsBefore,observedThrough};
}
export function classifyPredecessor({old,result,now=Date.now(),admittedDirty=null}){
 req(Array.isArray(old)&&old.length>0,'uae_prior_rows_required');
 const seen=new Set(), changes=[], uncertain=new Set();
 for(const row of old){
   const key=String(row?.sourceOfferId??'');
   req(row?.market==='uae'&&row.sourceId===ORIGIN&&idRx.test(key)&&row.id===offerId(key)&&!seen.has(key),'uae_prior_row_scope');
   seen.add(key);
   const resultRow=result.rows.get(key), rm=result.removals.get(key), h=result.held.get(key);
   let disposition;
   if(h){disposition=h.reason;uncertain.add(key);}
   else if(resultRow){
     disposition=admittedDirty?.get(key)||'present_in_source_needs_native_admission';
   } else if(rm&&date(rm.created_at)<=now+300000)disposition='provider_explicit_removed_not_sold';
   else{disposition='absence_not_sale_requires_comparison';uncertain.add(key);}
   changes.push({id:row.id,sourceOfferId:key,disposition,removalAt:disposition==='provider_explicit_removed_not_sold'?rm.created_at:null});
 }
 return {rows:changes,unresolved:uncertain.size};
}
