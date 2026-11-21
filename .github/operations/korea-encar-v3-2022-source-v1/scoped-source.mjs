import {createHash} from 'node:crypto';
import {open, readFile, readdir, mkdir} from 'node:fs/promises';
import {join} from 'node:path';

export const scope=Object.freeze({market:'korea',API:'encar_v3',year_from:2022,for_sale:1});
const hex=/^[0-9a-f]{64}$/;
const sha=b=>createHash('sha256').update(b).digest('hex');
const bytes=v=>Buffer.from(JSON.stringify(v));
const digest=v=>sha(bytes(v));
const assert=(ok,c)=>{if(!ok)throw Error(c)};
const positive=v=>Number.isSafeInteger(v)&&v>0;
const exactTime=s=>typeof s==='string'&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString()===s;
const maxBody=8*1024*1024;
const name=(prefix,n)=>prefix+'-'+String(n).padStart(7,'0')+'.json';
async function exclusive(path,data){
 const fd=await open(path,'wx',0o600);
 try{await fd.writeFile(bytes(data));await fd.sync();}finally{await fd.close();}
 const dir=await open(join(path,'..'),'r');try{await dir.sync();}finally{await dir.close();}
}
async function local(path){try{return JSON.parse(await readFile(path,'utf8'))}catch(e){if(e.code==='ENOENT')return null;throw e}}
export function marker(value,now){
 const {version,mode,runId,checkedAt,expiresAt,authorizedFixtureAttempts,workerEvidenceSha256}=value??{};
 assert(version===1&&mode==='offline_fixture_only'&&typeof runId==='string'&&/^[a-z0-9_-]{1,40}$/.test(runId)
  &&positive(authorizedFixtureAttempts)&&authorizedFixtureAttempts<=30000&&hex.test(workerEvidenceSha256||'')
  &&exactTime(checkedAt)&&exactTime(expiresAt)&&Date.parse(checkedAt)<=now&&now<Date.parse(expiresAt)
  &&Date.parse(expiresAt)-Date.parse(checkedAt)<=24*3600e3,'encar_fixture_marker');
 return {scope,version,mode,runId,checkedAt,expiresAt,authorizedFixtureAttempts,workerEvidenceSha256};
}
const lastAnchor=(response,at,date)=> {
 assert(Number.isSafeInteger(response?.change_id)&&response.change_id>=0&&at.slice(0,10)===date,'encar_dated_anchor');
 return {response,date,at,changeId:response.change_id,bodySha256:digest(response)};
};
function id(row){const value=row?.inner_id;return typeof value==='string'&&/^[1-9]\d{1,17}$/.test(value)?value:null}
const num=v=>typeof v==='number'&&Number.isFinite(v)&&v>0?v:null;
export function inspectRow(r){
 const year=Number.isInteger(r?.model_year)?r.model_year:Number.isInteger(r?.year)?r.year:null;
 const manufacture=typeof r?.year_month==='string'&&/^\d{4}-(0[1-9]|1[0-2])$/.test(r.year_month)?r.year_month:null;
 const identity=id(r);
 const regDate=typeof r?.first_registration_date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(r.first_registration_date)?r.first_registration_date:null;
 const regMonth=typeof r?.first_registration==='string'&&/^\d{4}-(0[1-9]|1[0-2])$/.test(r.first_registration)?r.first_registration:null;
 const membership=!!identity&&year>=2022&&year<=2100&&(!Number.isInteger(r?.model_year)||!Number.isInteger(r?.year)||r.model_year===r.year)
   &&r.advertisement_type==='Sale'&&r.sales_status==='Available'&&r.is_duplicate===false;
 return {identity,modelYear:year,rawYear:r?.year??null,rawModelYear:r?.model_year??null,manufacturedMonth:manufacture,firstRegistrationDate:regDate,firstRegistrationMonth:regMonth,membership,
   fuel:typeof r?.engine_type==='string'&&r.engine_type.trim()?r.engine_type:null,
   engineCc:positive(r?.displacement_cc)?r.displacement_cc:null,totalHp:num(r?.power),iceHp:num(r?.power_ice_hp),
   electricComponentKwNotCertified30m:num(r?.power_electro_kw), certified30mKw:null,
   drive:typeof r?.drive_type==='string'&&r.drive_type.trim()?r.drive_type:null,
   structuredFields:['photos','photo_details','options','inspection','diagnosis','history','original','catalog_ids']
      .filter(k=>r?.[k]!=null)
 };
}
function validatePage(payload,expected){
 assert(Array.isArray(payload?.result)&&payload.result.length<=20&&payload.meta?.page===expected&&Object.hasOwn(payload.meta,'next_page'),'encar_v3_page');
 const next=payload.meta.next_page;
 assert(next===null||(next===expected+1&&payload.result.length>0),'encar_v3_next_page');
 return next;
}
/** Transport is deliberately dependency injection only; shipped CLI provides a local fixture. */
export async function runFixture({dir,approval,transport,windowPages,clock=Date.now}){
 const a=marker(approval,clock()), limit=a.authorizedFixtureAttempts;
 assert(positive(windowPages)&&windowPages<=500,'encar_fixture_window');
 await mkdir(dir,{mode:0o700,recursive:true});
 const metaPath=join(dir,'marker.json'), meta=await local(metaPath);
 if(meta)assert(digest(meta)===digest(a),'encar_marker_changed');
 else{assert((await readdir(dir)).length===0,'encar_nonempty_new_scope');await exclusive(metaPath,a);}
 let used=0, previous=digest(a),anchor=null,next=1,seen=new Set(),rows=0,unverified=0,duplicate=0;
 const list=await readdir(dir), attempts=list.filter(x=>/^attempt-\d{7}\.json$/.test(x)).length;
 assert(list.every(n=>n==='marker.json'||/^(?:attempt|body)-\d{7}\.json$/.test(n)),'encar_foreign_file');
 const counts={displacementCc:0,totalHp:0,iceHp:0,electricKw:0,fuel:0,manufacture:0,structured:0};
 const requestOf=()=>anchor?{endpoint:'offers',params:{page:next,year_from:2022,for_sale:1}}
   :{endpoint:'change_id',params:{date:a.checkedAt.slice(0,10)}};
 const accept=(record,req,index)=>{
   assert(record?.index===index&&record.previous===previous&&digest(record.request)===digest(req)
     &&record.payloadSha256===digest(record.payload)&&exactTime(record.receivedAt)
     &&Date.parse(record.receivedAt)<Date.parse(a.expiresAt)&&Date.parse(record.receivedAt)>=Date.parse(a.checkedAt),'encar_body_chain');
   assert(bytes(record.payload).length<=maxBody,'encar_body_bound');
   if(!anchor)anchor=lastAnchor(record.payload,record.receivedAt,req.params.date);
   else{
     next=validatePage(record.payload,next);
     for(const r of record.payload.result){
       const e=inspectRow(r);rows++;
       if(e.identity){if(seen.has(e.identity))duplicate++;seen.add(e.identity);}
       if(!e.membership)unverified++;
       for(const [k,v] of Object.entries({displacementCc:e.engineCc,totalHp:e.totalHp,iceHp:e.iceHp,
         electricKw:e.electricComponentKwNotCertified30m,fuel:e.fuel,manufacture:e.manufacturedMonth,structured:e.structuredFields.length}))
         if(v)counts[k]++;
     }
   }
   previous=digest(record);
 };
 for(let n=1;n<=attempts;n++){
   const req=requestOf(), attempt=await local(join(dir,name('attempt',n)));
   assert(next!==null&&attempt?.index===n&&attempt.previous===previous&&digest(attempt.request)===digest(req),'encar_attempt_chain');
   const record=await local(join(dir,name('body',n)));
   assert(record,'encar_unresolved_attempt_hold');accept(record,req,n);used=n;
 }
 assert(list.length===1+2*used,'encar_orphan_checkpoint_record');
 let pagesThisWindow=0;
 while(next!==null&&pagesThisWindow<windowPages&&used<limit&&clock()<Date.parse(a.expiresAt)){
   const n=used+1, request=requestOf();
   const attempt={index:n,previous,request};
   await exclusive(join(dir,name('attempt',n)),attempt); // durable attempt before transport
   const payload=await transport(request);
   const record={...attempt,receivedAt:new Date(clock()).toISOString(),payloadSha256:digest(payload),payload};
   const isPage=!!anchor;
   accept(record,request,n);
   await exclusive(join(dir,name('body',n)),record);
   used=n;if(isPage)pagesThisWindow++;
 }
 const snapshotEnd=next===null;
 return {mode:a.mode,scope,attempts:used,pages:Math.max(0,used-1),rows,uniqueIds:seen.size,duplicateRows:duplicate,
   scopeUnverifiedRows:unverified,specFieldCounts:counts,anchor:anchor?{date:anchor.date,at:anchor.at,receipt:anchor.bodySha256}:null,
   nextPage:next,checkpointSha256:previous,snapshotEnd,hold:!snapshotEnd&&(used>=limit||clock()>=Date.parse(a.expiresAt)),
   nextPhase:snapshotEnd?'separate_anchored_changes_scope_and_authority_review':'resume_exact_checkpoint_only',
   fullInventory:false,providerCalls:0,acceptanceReady:false,published:false,cursorAdvanced:false};
}

/** Post-scan policy rehearsal only. No storage or cursor changes. Unknown/older
 * price-only events are not evidence of listing identity or membership. */
export function classifyChange(existing,event){
 const identity=id(event), t=Date.parse(event?.created_at), prior=Date.parse(existing?.provenEffectiveAt);
 if(!identity||!Number.isFinite(t)||existing&&identity!==id(existing.row))return 'hold_invalid_identity_or_time';
 if(existing&&(!Number.isFinite(prior)||t<=prior))return 'hold_unproven_event_order';
 if(event.change_type==='removed')return existing?'observed_removed_from_sale_not_sold':'outside_known_scope_removal_evidence_only';
 if(event.change_type==='changed'&&event.data&&Object.keys(event.data).length===1&&Object.hasOwn(event.data,'new_price')){
   if(!positive(event.data.new_price))return 'hold_invalid_price_only';
   if(!existing||!inspectRow(existing.row).membership)return 'hold_unknown_price_only';
   return 'observed_existing_price_change_krw';
 }
 if(event.change_type==='added'){
   if(id(event.data)!==identity)return 'hold_added_body_identity';
   const r=inspectRow(event.data);
   if(event.data.sales_status==='Sold')return 'observed_sold_status_outside_scope';
   return r.membership?'scoped_observation_only':'hold_unverified_scope';
 }
 return 'hold_unrecognized_change_shape';
}
