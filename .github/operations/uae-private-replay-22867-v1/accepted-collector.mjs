import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
export const BASE_RUN='44860475749';
export const SOURCE_SEAL='3b5ba2f178016f8e19f14c73a03a29d94406470cd75d31fddfdabf312d533fc0';
export const OBSERVED='2026-11-19T23:40:39.128Z';
export const START=324989;
export const SEAL_KEY='catalog/operations/uae-source-stage/v1/'+BASE_RUN+'/attempt-1/sealed-source-evidence.json';
export const ROOT='catalog/operations/uae-dubicars-private-delta/v1/'+SOURCE_SEAL+'/';
const SHA=/^[a-f0-9]{64}$/, inner=/^[1-9]\d{0,17}$/;
const req=(x,c)=>assert.ok(x,c);
const wire=x=>Buffer.from(JSON.stringify(x));
const digest=b=>createHash('sha256').update(b).digest('hex');
const hash=x=>digest(wire(x));
const inTime=(date,first,last)=>Number.isFinite(Date.parse(date))&&Date.parse(date)>=first&&Date.parse(date)<=last;
function exactKeys(v,keys){return !!v&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));}
export function admit(p,now){
 req(exactKeys(p,['version','scope','sealSha256','serviceAuthority','checkedAt','expiresAt','programMaxHttpAttempts','accountAction','reviewedWorkerTree'])
   &&p.version===1&&p.scope==='existing_paid_dubicars_changes_only'&&p.sealSha256===SOURCE_SEAL
   &&p.serviceAuthority==='existing_owner_confirmed_paid_dubicars_v2'&&/^[a-f0-9]{40}$/.test(p.reviewedWorkerTree)&&p.accountAction==='none','uae_delta_paid_authority');
 const from=Date.parse(p.checkedAt), until=Date.parse(p.expiresAt);
 req(Number.isFinite(from)&&Number.isFinite(until)&&from<=now&&now<until&&until-from<=24*3600000
   &&now<Date.parse(OBSERVED)+48*3600000&&Number.isSafeInteger(p.programMaxHttpAttempts)&&p.programMaxHttpAttempts===600,'uae_delta_limits_or_expiry');
 return {budget:p.programMaxHttpAttempts,until:Math.min(until,Date.parse(OBSERVED)+48*3600000),digest:hash(p)};
}
export function inspectPage(payload,cursor,observedAt){
 const payloadKeys=['result','meta'];
 req(exactKeys(payload,payloadKeys)&&Array.isArray(payload.result)&&payload.result.length<=20&&payload.meta?.limit===20
   &&payload.meta.cur_change_id===cursor&&Object.hasOwn(payload.meta,'next_change_id'),'uae_delta_provider_page_shape');
 const next=payload.meta.next_change_id, a=payload.result;
 // This strict exact pagination was proved on the archived 4,226-event delta.
 // For a future provider schema change refuse rather than silently skipping unknown IDs.
 req((a.length===0&&next===null)||(Number.isSafeInteger(next)&&next===cursor+a.length&&a.length>0),'uae_delta_provider_terminal_or_gap');
 const types={added:0,changed:0,removed:0}, unqualified={added:0,changed:0};
 for(const [i,row] of a.entries()){
   req(row&&row.id===cursor+i&&inner.test(String(row.inner_id))&&Object.hasOwn(types,row.change_type)
     &&inTime(row.created_at,0,Date.parse(observedAt)+300000),'uae_delta_provider_event_identity');
   types[row.change_type]++;
   if(row.change_type==='changed'&&!(exactKeys(row.data,['new_price'])&&(row.data.new_price===null||
      (typeof row.data.new_price==='number'&&Number.isFinite(row.data.new_price)&&row.data.new_price>=0))))unqualified.changed++;
   if(row.change_type==='added'&&!(String(row.data?.inner_id)===String(row.inner_id)&&typeof row.data?.url==='string'
      &&typeof row.data?.mark==='string'&&typeof row.data?.model==='string'))unqualified.added++;
   // Do not repair/alter any provider fields or fetch details. A future serving cut
   // must resolve unqualified payloads; a source terminal doesn't qualify them.
 }
 return {next,events:a.length,types,unqualified};
}
const plus=(a,b)=>Object.fromEntries(Object.keys(a).map(k=>[k,a[k]+b[k]]));
const pageKey=c=>ROOT+'page-'+c+'.json', attemptKey=c=>ROOT+'attempt-'+c+'.json';
async function read(io,key,cap){const b=await io.read(key,cap);if(b===null)return null;
 req(Buffer.isBuffer(b)&&b.length>0&&b.length<=cap,'uae_delta_readback_bytes');return JSON.parse(b.toString('utf8'));}
async function createStrict(io,key,body){
 const b=wire(body);req(b.length<=4*1024*1024,'uae_delta_wire_bound');
 // A conflict doesn't confer the lock. Do not retry a create before a paid call.
 await io.create(key,b);
 const saved=await io.read(key,4*1024*1024);req(Buffer.isBuffer(saved)&&digest(saved)===digest(b),'uae_delta_create_readback');
}
export async function collect({io,permit,fetchOne,assertOwner,phaseBudget,phaseDeadline,clock=Date.now}){
 const auth=admit(permit,clock());
 req(Number.isSafeInteger(phaseBudget)&&phaseBudget>0&&phaseBudget<=auth.budget,'uae_delta_phase_cap');
 await assertOwner();
 const raw=await io.read(SEAL_KEY,1024*1024);
 req(Buffer.isBuffer(raw)&&digest(raw)===SOURCE_SEAL,'uae_delta_source_seal');
 const seal=JSON.parse(raw.toString('utf8'));
 req(seal?.kind==='private-uae-source-stage-v1'&&seal.scope==='paid_dubicars_only'&&seal.market==='uae'
   &&seal.sourceRows===27581&&seal.cursorObserved===START&&seal.sourceObservedThrough===OBSERVED
   &&seal.servable===false&&seal.publicationAllowed===false&&seal.publicPointerWrites===0&&seal.cursorWrites===0,'uae_delta_source_shape');
 return collectBound({io,auth,fetchOne,assertOwner,phaseBudget,phaseDeadline,clock});
}
export async function collectBound({io,auth,fetchOne,assertOwner,phaseBudget,phaseDeadline=Infinity,clock}){
 const owner=await assertOwner();req(SHA.test(owner||''),'uae_delta_owner_authority');
 let cursor=START, pages=0, phase=0, count=0, previous=null;
 let kinds={added:0,changed:0,removed:0}, unresolved={added:0,changed:0};
 while(pages<=auth.budget){
   const existing=await read(io,pageKey(cursor),4*1024*1024);
   const reservation=await read(io,attemptKey(cursor),1024*1024);
   let page=existing;
   if(!page){
     req(!reservation,'uae_delta_ambiguous_attempt_never_repeat');
     if(phase>=phaseBudget||pages>=auth.budget||clock()+30000>=Math.min(auth.until,phaseDeadline))
       return {scope:'uae_private_dubicars_v2_delta',state:'partial',workingCursor:cursor,paidAttempts:pages,
         phaseAttempts:phase,events:count,canContinue:pages<auth.budget&&clock()+30000<auth.until,published:false,cursorAdvanced:false};
     req(await assertOwner()===owner,'uae_delta_owner_changed');
     req(clock()<auth.until,'uae_delta_paid_authority_expired_before_request');
     const attempt={version:1,market:'uae',seal:SOURCE_SEAL,permit:auth.digest,owner,cursor,previous,observedAt:new Date(clock()).toISOString()};
     await createStrict(io,attemptKey(cursor),attempt);
     req(await assertOwner()===owner&&clock()+15000<Math.min(auth.until,phaseDeadline),'uae_delta_authority_changed_after_reservation');
     const response=await fetchOne(cursor);
     req(response?.status===200,[402,429].includes(response?.status)?'uae_delta_provider_billing_or_quota_hold':'uae_delta_provider_request_failed');
     const observedAt=new Date(clock()).toISOString();
     const check=inspectPage(response.payload,cursor,observedAt);
     page={version:1,attempt,observedAt,check,body:response.payload};
     await createStrict(io,pageKey(cursor),page);
     phase++;
   } else {
     req(reservation&&hash(reservation)===hash(page.attempt),'uae_delta_saved_reservation_changed');
   }
   req(page.version===1&&page.attempt.version===1&&page.attempt.market==='uae'&&page.attempt.seal===SOURCE_SEAL&&page.attempt.permit===auth.digest&&page.attempt.owner===owner
     &&page.attempt.cursor===cursor&&page.attempt.previous===previous&&inTime(page.attempt.observedAt,Date.parse(OBSERVED),clock()+300000)
     &&inTime(page.observedAt,Date.parse(page.attempt.observedAt),clock()+300000),'uae_delta_saved_chain_changed');
   const check=inspectPage(page.body,cursor,page.observedAt);
   req(hash(check)===hash(page.check),'uae_delta_saved_check_changed');
   previous=hash(page);pages++;count+=check.events;kinds=plus(kinds,check.types);unresolved=plus(unresolved,check.unqualified);
   if(check.next===null){
     const summaryKey=ROOT+'sealed-delta.json';
     const output={version:1,scope:'uae_private_dubicars_v2_delta',state:'source_terminal',market:'uae',provider:'auto_api_dubicars',
       priorSeal:SOURCE_SEAL,authority:auth.digest,initialCursor:START,workingCursor:cursor,observedThrough:page.observedAt,paidAttempts:pages,
       events:count,eventKinds:kinds,sourcePayloadNeedsQualification:unresolved,chainSha256:previous,
       completeMarketReplica:false,prepared:false,published:false,cursorAdvanced:false,publicPointerWrites:0,detailRequests:0};
     const sealed=await read(io,summaryKey,1024*1024);
     if(sealed)req(hash(sealed)===hash(output),'uae_delta_terminal_seal_changed');
     else {req(await assertOwner()===owner,'uae_delta_owner_changed');await createStrict(io,summaryKey,output);}
     return {...output,sealSha256:hash(output)};
   }
   cursor=check.next;
 }
 throw Error('uae_delta_paid_cap');
}
