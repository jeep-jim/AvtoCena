import {createHash} from 'node:crypto';
import {inspectRow,scope} from './scoped-source.mjs';
const sha=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const check=(x,c)=>{if(!x)throw Error(c)};
const gt0=n=>Number.isSafeInteger(n)&&n>0;
const exact=(s)=>typeof s==='string'&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString()===s;
const re=/^[a-f0-9]{64}$/;
const runRE=/^[1-9]\d{8,14}$/;
const revRE=/^[a-f0-9]{40}$/;
const stages=['initial','phase2','phase3','phase4'];
export const digestReceipt=sha;
export const rootFor=runId=>{check(runRE.test(runId),'encar_prior_run');return 'catalog/operations/korea-encar-scoped-source/v1/'+runId+'/attempt-1';};
export const claimFor=p=>'catalog/operations/korea-encar-scoped-source/v1/continuation-claims/'+p.runId+'/'+p.receiptSha256+'.json';
function validPredecessor(p){
 return p && runRE.test(p.runId||'') && revRE.test(p.revision||'') && stages.includes(p.phase)
  && re.test(p.receiptSha256||'') && re.test(p.chain||'') && gt0(p.nextPage)
  && runRE.test(p.originalRunId||'') && exact(p.originalAnchor?.receivedAt) && /^\d{4}-\d{2}-\d{2}$/.test(p.originalAnchor?.date||'')
  && p.originalAnchor.receivedAt.slice(0,10)===p.originalAnchor.date && Number.isSafeInteger(p.originalAnchor.id)&&p.originalAnchor.id>=0
  && re.test(p.originalAnchorSha256||'') && Number.isSafeInteger(p.priorDepth) && p.priorDepth>=0 && p.priorDepth<15;
}
export function predecessorFromReceipt(r){
 check(r?.successorEligible===true&&r.kind==='scoped_working_checkpoint'&&!r.hold&&r.archivedWholeInventory===false
   &&r.reconciledChanges===false&&r.publicationAllowed===false&&r.cursorAdvanced===false,'encar_prior_not_resumable');
 const p={runId:r.identity?.runId,revision:r.identity?.revision,phase:r.phase,receiptSha256:sha(r),chain:r.chain,nextPage:r.nextPage,
  originalRunId:r.originalRunId,originalAnchor:r.anchor,originalAnchorSha256:r.originalAnchorSha256,priorDepth:r.depth};
 check(validPredecessor(p),'encar_cross_marker');return p;
}
export function authorized(m,tree,now=Date.now()){
 check(m?.version===1&&m.scope==='encar_v3_2022_for_sale_source_only'&&m.noNewPurchase===true&&m.inExistingPaidScopeVerified===true
 &&re.test(m.authorityEvidenceSha256||'')&&re.test(m.privatePrefixApprovalSha256||'')&&/^[a-f0-9]{40}$/.test(tree||'')&&m.workerTree===tree
 &&gt0(m.programMaxHttpAttempts)&&m.programMaxHttpAttempts<=2000
 &&exact(m.checkedAt)&&exact(m.expiresAt)&&Date.parse(m.checkedAt)<=now&&now<Date.parse(m.expiresAt)
 &&Date.parse(m.expiresAt)-Date.parse(m.checkedAt)<=4*3600e3&&m.anchorDate===m.checkedAt.slice(0,10)
 &&m.anchorDate===new Date(now).toISOString().slice(0,10)
 &&(m.predecessor===undefined||(validPredecessor(m.predecessor)&&
   Date.parse(m.predecessor.originalAnchor.receivedAt)<=now&&now-Date.parse(m.predecessor.originalAnchor.receivedAt)<=7*86400e3)),
 'encar_carrier_unapproved');
 return {...m,approvalSha256:sha(m)};
}
export function providerTransport({key,fetchImpl=fetch}){
 check(typeof key==='string'&&key.trim()===key&&key&&!/\s/.test(key),'encar_account_unavailable');
 let lastStarted=0;
 return async (request, timeoutMs=25000)=>{
  const {endpoint,params}=request;
  const isAnchor=endpoint==='change_id'&&Object.keys(params).length===1&&/^\d{4}-\d{2}-\d{2}$/.test(params.date);
  const isList=endpoint==='offers'&&Object.keys(params).length===3&&gt0(params.page)&&params.year_from===2022&&params.for_sale===1;
  check(isAnchor||isList,'encar_unapproved_route');
  const url=new URL('https://api1.auto-api.com/api/v3/encar/'+endpoint);
  for(const [k,v] of Object.entries(params))url.searchParams.set(k,String(v));
  url.searchParams.set('api_key',key);
  const wait=lastStarted+200-Date.now();if(wait>0) await new Promise(r=>setTimeout(r,wait));
  lastStarted=Date.now();
  let res;try {res=await fetchImpl(url,{method:'GET',redirect:'error',headers:{accept:'application/json'},signal:AbortSignal.timeout(timeoutMs)});}catch{throw Error('encar_transport_uncertain');}
  if(!res.ok){await res.body?.cancel();throw Error(res.status===402?'encar_payment_required':res.status===429?'encar_rate_limit_hold':'encar_provider_refused');}
  const reader=res.body?.getReader();check(reader,'encar_body_missing');
  const chunks=[];let len=0;
  try{
   while(true){const {value,done}=await reader.read();if(done)break;len+=value.byteLength;check(len<=8*1024*1024,'encar_body_limit');chunks.push(value);}
   const wire=Buffer.concat(chunks).toString('base64');
   JSON.parse(Buffer.from(wire,'base64').toString('utf8'));return wire;
  }catch(e){throw Error(e?.message==='encar_body_limit'?'encar_body_limit':'encar_response_invalid');}
  finally{try{await reader.cancel()}catch{}}
 };
}
export async function runPhase({storage,root,auth,identity,phase,prior,history,claim,source,checkOwner,deadline,clock=Date.now}){
 check(/^catalog\/operations\/korea-encar-scoped-source\/v1\/[1-9]\d{8,14}\/attempt-1$/.test(root),'encar_scope_prefix');
 const stage=stages.indexOf(phase);check(stage>=0,'encar_phase_scope');
 const k=n=>root+'/'+n, get=n=>storage.readJson(k(n),null);
 const put=async (n,v)=>{
  await storage.writeJson(k(n),v,{ifNoneMatch:'*'});
  check(sha(await get(n))===sha(v),'encar_readback_mismatch');
 };
 const ownerHash=await checkOwner();
 const p=auth.predecessor??null;
 let inherited=null;
 if(p){
   check(p.runId!==identity.runId&&p.originalRunId!==identity.runId&&history&&claim,'encar_cross_owner_scope');
   const oldRoot=rootFor(p.runId), originalRoot=rootFor(p.originalRunId);
   const previous=await history(oldRoot,p.phase+'-receipt.json');
   check(sha(predecessorFromReceipt(previous))===sha(p)&&previous.ownerHash===ownerHash,'encar_cross_receipt_drift');
   for(const s of stages.slice(stages.indexOf(p.phase)+1))
     check(!(await history(oldRoot,s+'-receipt.json')),'encar_cross_newer_checkpoint');
   check(!(await history(oldRoot,'attempt-'+(previous.attempts+1)+'.json')),'encar_cross_orphan');
   const tail=await history(oldRoot,'body-'+previous.attempts+'.json');
   const tailAttempt=await history(oldRoot,'attempt-'+previous.attempts+'.json');
   check(tail?.index===previous.attempts&&sha(tail)===p.chain&&tail.request?.endpoint==='offers'
      &&sha(tailAttempt)===sha({index:tail.index,previous:tail.previous,request:tail.request}),
      'encar_cross_body_drift');
   const rawTail=JSON.parse(Buffer.from(tail.wire,'base64').toString('utf8'));
   check(rawTail?.meta?.next_page===p.nextPage&&rawTail.meta.page===p.nextPage-1,'encar_cross_next_page');
   const original=await history(originalRoot,'body-1.json');
   check(original?.index===1&&sha(original)===p.originalAnchorSha256&&original.request?.endpoint==='change_id'
     &&original.request.params.date===p.originalAnchor.date&&original.receivedAt===p.originalAnchor.receivedAt
     &&JSON.parse(Buffer.from(original.wire,'base64').toString('utf8')).change_id===p.originalAnchor.id,'encar_cross_original_anchor');
   inherited=previous;
   await claim(p,{version:1,successor:identity,priorReceiptSha256:p.receiptSha256,approvalSha256:auth.approvalSha256},stage===0);
 }
 const start={version:1,scope,identity,ownerHash,approvalSha256:auth.approvalSha256,predecessor:p};
 if(phase==='initial'){
   // Using the same dedicated store as the journal: HEAD-if-present GET,
   // create-only PUT, and exact readback all precede any supplier I/O.
   check(!(await get('scope-start.json')),'encar_journal_already_reserved');
   await put('scope-start.json',start);
 }
 else check(sha(await get('scope-start.json'))===sha(start),'encar_start_mismatch');
 let chain=sha(start), next=p?.nextPage??1, anchor=p?.originalAnchor??null,
     originalAnchorSha256=p?.originalAnchorSha256??null, used=0, pages=0, rows=0, unverified=0;
 const seen=new Set();let duplicateRows=0;
 const req=()=>anchor?{endpoint:'offers',params:{page:next,...{year_from:2022,for_sale:1}}}:{endpoint:'change_id',params:{date:auth.anchorDate}};
 function accept(n,r,request) {
   check(r?.index===n&&r.previous===chain&&sha(r.request)===sha(request)&&exact(r.receivedAt)
     &&r.receivedAt.slice(0,10)===auth.anchorDate&&Date.parse(r.receivedAt)>=Date.parse(auth.checkedAt)
     &&Date.parse(r.receivedAt)<Date.parse(auth.expiresAt)&&typeof r.wire==='string'&&r.wire.length<=11184812,'encar_body_binding');
   const raw=Buffer.from(r.wire,'base64');
   check(raw.toString('base64')===r.wire,'encar_body_encoding');
   const payload=JSON.parse(raw.toString('utf8'));
   if(!anchor){check(Number.isSafeInteger(payload.change_id)&&payload.change_id>=0,'encar_anchor_invalid');
    anchor={date:auth.anchorDate,id:payload.change_id,receivedAt:r.receivedAt};originalAnchorSha256=sha(r);}
   else{
    check(Array.isArray(payload.result)&&payload.result.length<=20&&payload.meta?.page===next&&Object.hasOwn(payload.meta,'next_page'),'encar_page_shape');
    check(payload.meta.next_page===null||payload.meta.next_page===next+1&&payload.result.length>0,'encar_pagination_gap');
    for(const row of payload.result){
     const x=inspectRow(row);rows++;if(!x.membership)unverified++;if(x.identity){if(seen.has(x.identity))duplicateRows++;seen.add(x.identity);}
    }
    pages++;next=payload.meta.next_page;
   }
   chain=sha(r);
 }
 const past=stage?await get(stages[stage-1]+'-receipt.json'):null;
 if(stage){
   check(prior&&sha(prior)===sha(past)&&prior.kind==='scoped_working_checkpoint'&&prior.continueAllowed===true
     &&prior.phase===stages[stage-1]&&prior.approvalSha256===auth.approvalSha256&&gt0(prior.attempts)&&prior.attempts<auth.programMaxHttpAttempts,'encar_predecessor');
   for(let startAt=1;startAt<=prior.attempts;startAt+=4){
     // Fetch only bounded batches and consume in exact journal order.
     const batch=await Promise.all(Array.from({length:Math.min(4,prior.attempts-startAt+1)},async (_,i)=>{
       const n=startAt+i;return [n,await get('attempt-'+n+'.json'),await get('body-'+n+'.json')];
     }));
     for(const [n,attempt,body] of batch){
       const request=req();
       check(next!==null&&sha(attempt)===sha({index:n,previous:chain,request}),'encar_attempt_chain');
       accept(n,body,request);used=n;
     }
   }
   check(chain===prior.chain&&next===prior.nextPage&&!(await get('attempt-'+(used+1)+'.json')),'encar_predecessor_drift');
 }
 let hold=null;const firstAttempt=used;
 while(next!==null&&used-firstAttempt<500&&used<auth.programMaxHttpAttempts&&clock()+30000<deadline&&clock()+30000<Date.parse(auth.expiresAt)
   &&auth.anchorDate===new Date(clock()+30000).toISOString().slice(0,10)){
  await checkOwner();const request=req(), n=used+1, attempt={index:n,previous:chain,request};
  if(clock()+28000>=deadline||clock()+28000>=Date.parse(auth.expiresAt)||auth.anchorDate!==new Date(clock()+28000).toISOString().slice(0,10))break;
  await put('attempt-'+n+'.json',attempt);used=n;
  if(clock()+25000>=deadline||clock()+25000>=Date.parse(auth.expiresAt)||auth.anchorDate!==new Date(clock()+25000).toISOString().slice(0,10)){hold='encar_epoch_budget_after_reservation';break;}
  try{
   const wire=await source(request), record={...attempt,receivedAt:new Date(clock()).toISOString(),wire};
   accept(n,record,request);await put('body-'+n+'.json',record);
  }catch(e){hold=/^encar_[a-z0-9_]{1,80}$/.test(e?.message||'')?e.message:'encar_source_result_unresolved';break;}
 }
 const terminal=next===null&&!hold;
 const receipt={version:1,kind:terminal?'provider_terminal_scoped_observation':'scoped_working_checkpoint',
   scope,identity,ownerHash,phase,approvalSha256:auth.approvalSha256,attempts:used,pages,rows,unverified,duplicateRows,nextPage:next,anchor,originalAnchorSha256,
   originalRunId:p?.originalRunId??identity.runId,depth:p?p.priorDepth+1:0,
   cumulativePages:(inherited?.cumulativePages??0)+pages,cumulativeReservedAttempts:(inherited?.cumulativeReservedAttempts??0)+used,
   duplicateCountScope:'current_run_only',successorEligible:!terminal&&!hold&&!!anchor&&pages>0&&used>firstAttempt,
   chain,hold,continueAllowed:stage<3&&!terminal&&!hold&&!!anchor&&pages>0&&used>firstAttempt&&used<auth.programMaxHttpAttempts
     &&clock()+30000<Date.parse(auth.expiresAt)&&auth.anchorDate===new Date(clock()+30000).toISOString().slice(0,10),
   archivedWholeInventory:false,reconciledChanges:false,publicationAllowed:false,cursorAdvanced:false};
 await put(phase+'-receipt.json',receipt);return receipt;
}
