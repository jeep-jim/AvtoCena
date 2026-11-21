import {createHash} from 'node:crypto';
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const rawHash=b=>createHash('sha256').update(b).digest('hex');
const check=(b,c)=>{if(!b)throw Error(c)};
const hex=/^[0-9a-f]{64}$/;
const source='korea-encar-scoped-source';
const prefix='catalog/operations/'+source+'/v1/';
const base=id=>prefix+id+'/attempt-1/';
const original=base('44863525814'), latest=base('44876364589');
const latestHead='eee44623ea85b9d95bbe6d02e0b9b7abe7df769d';
const expectedOwner='e0c565ead963fc9b6ce6f82859f7372819a583fd52f2e2609fee146b1c6a230f';
const expectedApproval='d2750a8d74635a8a4a90495f5bdcb0771da6f3975d099cdf08e55ef51e65d954';
const oldReceiptSha='7f5386c479b50e82a506a6841fe34189f802531c0eb22f5f85351c31d24a9ef0';
const anchorSha='6a96d6c226f0da849f0cece3aadde95008189fa1c6b70aa63ec759021af98c6c';
const oldHead='175413fda63f02cce3ecce7b2ed5e769487db736';
const shape={market:'korea',API:'encar_v3',year_from:2022,for_sale:1};
const anchored={date:'2026-11-21',id:10197174,receivedAt:'2026-11-21T03:56:32.124Z'};
const bump=(o,k)=>o[k]=(o[k]??0)+1;
const valid=n=>Number.isSafeInteger(n)&&n>0;
const id=s=>typeof s==='string'&&/^[1-9][0-9]{1,17}$/.test(s);
export function sampleCounts(rows,count={}){
 for(const r of rows){
  bump(count,'sampleRows');
  const d=r?.data;
  if(!id(r?.inner_id)||!d||typeof d!=='object'||Array.isArray(d)){bump(count,'wrappedMissing');continue;}
  const nestedId=id(d.inner_id);
  if(!nestedId){bump(count,'nestedIdentityMissing');continue;}
  if(r.inner_id!==d.inner_id){bump(count,'nestedIdentityConflict');continue;}
  bump(count,'wrappedAligned');
  for(const [k,v] of Object.entries({fuel:typeof d.engine_type==='string'&&!!d.engine_type.trim(),cc:valid(d.displacement_cc),
   totalHp:valid(d.power),iceHp:valid(d.power_ice_hp),electricKw:Number.isFinite(d.power_electro_kw)&&d.power_electro_kw>0,
   drive:typeof d.drive_type==='string'&&!!d.drive_type.trim(),manufacture:typeof d.year_month==='string'&&/^\d{4}-(0[1-9]|1[0-2])$/.test(d.year_month),
   firstRegistration:typeof d.first_registration_date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d.first_registration_date),
   photos:Array.isArray(d.photos)&&d.photos.length>0,inspection:d.inspection!=null,history:d.history!=null,diagnosis:d.diagnosis!=null,options:d.options!=null}))
   if(v)bump(count,k);
  const conflict=['year','model_year','sales_status','advertisement_type','is_duplicate'].some(k=>Object.hasOwn(r,k)&&Object.hasOwn(d,k)&&r[k]!==d[k])
   ||d.year!=null&&d.model_year!=null&&d.year!==d.model_year;
  if(conflict)bump(count,'yearOrSaleConflict');
  else if(valid(d.model_year??d.year)&&(d.model_year??d.year)>=2022&&d.advertisement_type==='Sale'&&d.sales_status==='Available'&&d.is_duplicate===false)
   bump(count,'strictEligibleSample');
  else bump(count,'unconfirmedSaleOrYear');
 }
 return count;
}
export async function verify({read,head}){
 const bodyCap=12*1024*1024, small=32768;
 const get=async(k,cap=small)=>{
  const b=await read(k,cap);check(Buffer.isBuffer(b)&&b.length&&b.length<=cap,'encar_sample_byte_bound');
  const j=JSON.parse(b);check(rawHash(b)===hash(j),'encar_sample_exact_wire'); return j;
 };
 check(await head(latest+'attempt-417.json')===false,'encar_latest_orphan');
 const [r,start,old,o]=await Promise.all([get(latest+'initial-receipt.json'),get(latest+'scope-start.json'),
 get(original+'phase4-receipt.json'),get(original+'body-1.json')]);
 check(hash(old)===oldReceiptSha&&old.identity?.revision===oldHead&&old.nextPage===1584&&old.ownerHash===expectedOwner,'encar_old_checkpoint');
 check(r.identity?.runId==='44876364589'&&r.identity.attempt==='1'&&r.identity.revision===latestHead
  &&r.phase==='initial'&&r.kind==='scoped_working_checkpoint'&&r.ownerHash===expectedOwner&&r.approvalSha256===expectedApproval
  &&r.attempts===416&&r.pages===416&&r.rows===8320&&r.duplicateRows===0&&r.hold===null&&r.nextPage===2000
  &&r.cumulativePages===1999&&r.cumulativeReservedAttempts===2000&&r.originalRunId==='44863525814'&&r.depth===1
  &&r.successorEligible===true&&r.continueAllowed===false&&r.originalAnchorSha256===anchorSha&&hash(r.anchor)===hash(anchored)
  &&r.archivedWholeInventory===false&&r.reconciledChanges===false&&r.cursorAdvanced===false&&r.publicationAllowed===false
  &&hash(r.scope)===hash(shape)&&hex.test(r.chain),'encar_latest_checkpoint');
 check(hash(start.identity)===hash(r.identity)&&start.approvalSha256===r.approvalSha256&&start.ownerHash===expectedOwner
  &&start.predecessor?.receiptSha256===oldReceiptSha&&start.predecessor.nextPage===1584&&start.predecessor.originalAnchorSha256===anchorSha
  &&hash(start.scope)===hash(shape),'encar_latest_start_binding');
 check(hash(o)===anchorSha&&o.index===1&&o.request.endpoint==='change_id'&&o.request.params.date===anchored.date
  &&o.receivedAt===anchored.receivedAt&&JSON.parse(Buffer.from(o.wire,'base64')).change_id===anchored.id,'encar_latest_anchor');
 const cohorts={baseline:{},continuation:{}};
 const picks=[[original,2,1,'baseline'],[original,792,791,'baseline'],[original,1584,1583,'baseline'],
  [latest,1,1584,'continuation'],[latest,209,1792,'continuation'],[latest,416,1999,'continuation']];
 for(const [root,index,page,cohort] of picks){
  const [a,b]=await Promise.all([get(root+'attempt-'+index+'.json'),get(root+'body-'+index+'.json',bodyCap)]);
  const req={endpoint:'offers',params:{page,year_from:2022,for_sale:1}};
  check(hash(a)===hash({index,previous:b.previous,request:req})&&b.index===index&&hash(b.request)===hash(req)
    &&hex.test(b.previous)&&Number.isFinite(Date.parse(b.receivedAt))&&typeof b.wire==='string','encar_sample_attempt_body');
  const raw=Buffer.from(b.wire,'base64');check(raw.toString('base64')===b.wire,'encar_sample_encoding');
  const j=JSON.parse(raw);check(j.meta?.page===page&&j.meta.next_page===page+1&&Array.isArray(j.result)&&j.result.length===20,'encar_sample_page');
  if(index===416&&root===latest)check(hash(b)===r.chain,'encar_latest_tail_hash');
  if(index===1584&&root===original)check(hash(b)===old.chain,'encar_previous_tail_hash');
  sampleCounts(j.result,cohorts[cohort]);
 }
 const digest=hash(r);
 const claim=prefix+'continuation-claims/44876364589/'+digest+'.json';
 check(await head(latest+'attempt-417.json')===false&&await head(claim)===false,'encar_latest_following_or_claim');
 check(hash(await get(latest+'initial-receipt.json'))===digest,'encar_latest_receipt_changed');
 const predecessor={runId:r.identity.runId,revision:r.identity.revision,phase:r.phase,receiptSha256:digest,chain:r.chain,nextPage:r.nextPage,
  originalRunId:r.originalRunId,originalAnchor:r.anchor,originalAnchorSha256:r.originalAnchorSha256,priorDepth:r.depth};
 return {kind:'verified_korea_successor_checkpoint_and_nested_sample',predecessor,
   sampling:'six fixed early/middle/tail pages, non-statistical; read non-tail pairs, not full chain replay',cohorts,
   cumulativeReservedAttempts:2000,providerTerminal:false,fullFieldCoverageVerified:false,publish:false,objectWrites:0,providerCalls:0};
}
