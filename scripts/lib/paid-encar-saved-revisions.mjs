import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
export const SAVED_ENCAR_SELECTION_POLICY='same-vehicle-forward-full-record-quarantine-v1';
export const rawHash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const same=(a,b)=>rawHash(a??null)===rawHash(b??null);
const date=v=>{assert.ok(typeof v==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,19)===v.slice(0,19),'encar_revision_invalid_timestamp');return Date.parse(v);};
const reportDate=v=>{assert.ok(typeof v==='string'&&/^\d{4}-\d\d-\d\d$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v,'encar_revision_invalid_report_date');return Date.parse(v);};
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const idOf=raw=>{const id=String(raw?.inner_id||'');assert.match(id,/^\d{6,10}$/,'encar_revision_invalid_identity');assert.equal(String(raw?.data?.inner_id),id,'encar_revision_identity_mismatch');return id;};
const present=v=>v!==null&&v!==undefined&&v!=='';
const identityFields=['inner_id','vin','url','mark','model','generation','generation_code','configuration','complectation','year','model_year','first_registration_date','displacement_cc','engine_type','transmission_type','body_type','drive_type'];
function validateRevision(raw,completedAt){
 idOf(raw);assert.ok(object(raw.data),'encar_revision_full_record_required');assert.equal(raw.change_type,'added','encar_revision_full_added_required');
 assert.ok(Number.isSafeInteger(raw.id)&&raw.id>0&&raw.id===raw.data.id,'encar_revision_provider_identity');
 assert.equal(raw.created_at,raw.data.created_at,'encar_revision_created_envelope');
 for(const k of ['created_at','offer_created','first_advertised_at'])assert.ok(date(raw.data[k])<=completedAt,'encar_revision_future_timestamp');
 for(const k of ['inner_id','vin','url','mark','model','year'])assert.ok(present(raw.data[k]),'encar_revision_missing_identity:'+k);
 assert.match(raw.data.vin,/^[A-HJ-NPR-Z0-9]{17}$/,'encar_revision_invalid_vin');
 let u;try{u=new URL(raw.data.url);}catch{assert.fail('encar_revision_listing_url');}assert.ok(['www.encar.com','encar.com','fem.encar.com'].includes(u.hostname)&&['http:','https:'].includes(u.protocol)&&!u.username&&!u.password,'encar_revision_listing_url');
 const carid=u.searchParams.get('carid');assert.ok(carid===String(raw.inner_id)||u.pathname.split('/').includes(String(raw.inner_id)),'encar_revision_listing_url_identity');
}
/** Source-specific, corroborated full-record ordering. Never inspect page order.
 * Exact raw duplicates require no revision inference. Nonidentical rows must
 * agree on stable vehicle identity and all independent chronology signals. */
export function compareSavedEncarRevisions(a,b,snapshot){
 assert.equal(idOf(a),idOf(b),'encar_revision_different_listing');
 if(rawHash(a)===rawHash(b))return 0;
 const completedAt=date(snapshot.completedAt);validateRevision(a,completedAt);validateRevision(b,completedAt);
 for(const k of identityFields)assert.ok(same(a.data[k],b.data[k]),'encar_revision_vehicle_identity:'+k);
 for(const k of ['advertisement_type','sales_status','is_duplicate','duplicate_of','lease'])assert.ok(same(a.data[k],b.data[k]),'encar_revision_admission_change:'+k);
 const direction=Math.sign(b.id-a.id);assert.notEqual(direction,0,'encar_revision_provider_tie');
 const [older,newer]=direction>0?[a,b]:[b,a];
 assert.ok(date(newer.created_at)>date(older.created_at),'encar_revision_created_order');
 for(const k of ['offer_created','first_advertised_at'])assert.ok(date(newer.data[k])>=date(older.data[k]),'encar_revision_seller_order:'+k);
 for(const [block,key] of [['history','report_date'],['inspection','issue_date'],['diagnosis','date']]){
  const old=older.data[block]??null,next=newer.data[block]??null;
  if(same(old,next))continue;
  assert.ok(object(old)&&object(next),'encar_revision_report_presence:'+block);
  assert.ok(reportDate(next[key])>=reportDate(old[key])&&reportDate(next[key])<=completedAt,'encar_revision_report_order:'+block);
 }
 return direction;
}
const earlier=(a,b)=>a.page<b.page||a.page===b.page&&a.row<b.row;
/** One prepass, four in-flight reads, ordered receipt verification. Retains
 * hashes/coordinates, not the entire 200k-row supplier payload in memory. */
export async function buildSavedEncarSelection({storage,root,snapshot,pageVerifier,assertEnabled=async()=>{},onProgress=()=>{},concurrency=4}){
 assert.match(root,/^catalog\/intake-staging\/encar\/\d+\/[1-9]\d*$/);
 assert.ok(pageVerifier&&typeof pageVerifier.verify==='function'&&typeof pageVerifier.finish==='function','encar_revision_full_receipt_verifier_required');
 assert.ok(Number.isSafeInteger(snapshot.pages)&&snapshot.pages>0&&Number.isSafeInteger(snapshot.count)&&snapshot.count>0,'encar_revision_snapshot_bounds');
 assert.ok(Number.isInteger(concurrency)&&concurrency>=1&&concurrency<=4);
 const snapshotHash=rawHash(snapshot);assert.equal(rawHash(await storage.readJson(root+'/complete.json',null)),snapshotHash,'encar_revision_snapshot_changed');
 const selected=new Map(),allVersions=new Map(),quarantine=new Map(),pageHashes=new Map(),jobs=new Map();let count=0;
 const fetchPage=async page=>{await assertEnabled();const [rows,receipt]=await Promise.all([storage.readJson(`${root}/pages/${page}.json`,null),storage.readJson(`${root}/page-receipts/${page}.json`,null)]);assert.ok(Array.isArray(rows),'encar_revision_page_missing');return {rows,receipt};};
 const start=p=>{const job=fetchPage(p);job.catch(()=>{});jobs.set(p,job);};
 for(let p=1;p<=Math.min(concurrency,snapshot.pages);p++)start(p);
 async function reread(v){const rows=await storage.readJson(`${root}/pages/${v.page}.json`,null);assert.equal(rawHash(rows),pageHashes.get(v.page),'encar_revision_page_changed');const raw=rows[v.row-1];assert.equal(rawHash(raw),v.rawSha256,'encar_revision_coordinate_changed');return raw;}
 for(let page=1;page<=snapshot.pages;page++){
  const {rows,receipt}=await jobs.get(page);jobs.delete(page);if(page+concurrency<=snapshot.pages)start(page+concurrency);
  pageVerifier.verify(page,rows,receipt);pageHashes.set(page,rawHash(rows));
  for(let i=0;i<rows.length;i++){
   const raw=rows[i],id=idOf(raw),next={page,row:i+1,rawSha256:rawHash(raw)},prior=selected.get(id);count++;
   // Contradictory raw identity is corruption, not a content disagreement.
   assert.ok(object(raw.data)&&Number.isSafeInteger(raw.id)&&raw.id>0&&raw.id===raw.data.id,'encar_revision_provider_identity');
   if(!prior){selected.set(id,next);continue;}
   const versions=allVersions.get(id)||[prior];
   assert.ok(versions.length<1000,'encar_revision_per_id_bound');
   if(!quarantine.has(id)){
    try{
     // All pairwise relationships, not only current maximum: a third revision
     // can expose contradictory chronology among older variants.
     for(const v of versions){const before=v.page===page?rows[v.row-1]:await reread(v);compareSavedEncarRevisions(before,raw,snapshot);}
     const before=prior.page===page?rows[prior.row-1]:await reread(prior),order=compareSavedEncarRevisions(before,raw,snapshot);
     if(order>0||order===0&&earlier(next,prior))selected.set(id,next);
    }catch(error){
     const reason=String(error?.message||'').match(/^encar_revision_[a-z_]+(?::[a-z_]+)?$/)?.[0];
     // Source corruption remains fatal. Only explicit semantic uncertainty
     // becomes quarantine; programming/I/O failures cannot be hidden here.
     const allowed=/^encar_revision_(?:invalid_timestamp|future_timestamp|invalid_report_date|full_record_required|full_added_required|missing_identity|invalid_vin|listing_url|listing_url_identity|vehicle_identity|admission_change|provider_tie|created_order|seller_order|report_presence|report_order)(?::[a-z_]+)?$/;
     if(!reason||!allowed.test(reason))throw error;
     quarantine.set(id,reason);
    }
   }
   versions.push(next);allVersions.set(id,versions);
  }
  if(page%250===0)onProgress({pagesRead:page,rawRows:count,uniqueIds:selected.size,duplicateRows:count-selected.size});
 }
 pageVerifier.finish();assert.equal(count,snapshot.count,'encar_revision_total_mismatch');
 assert.equal(rawHash(await storage.readJson(root+'/complete.json',null)),snapshotHash,'encar_revision_snapshot_changed');
 const bindings=[...selected].filter(([id])=>!quarantine.has(id)).sort(([a],[b])=>a.localeCompare(b)).map(([id,v])=>[id,v.page,v.row,v.rawSha256]);
 const quarantined=[...quarantine].sort(([a],[b])=>a.localeCompare(b)).map(([id,reason])=>({sourceOfferId:id,reason,versions:[...allVersions.get(id)].sort((a,b)=>a.page-b.page||a.row-b.row)}));
 const quarantinedRows=quarantined.reduce((n,x)=>n+x.versions.length,0),publishableIds=selected.size-quarantine.size;
 const manifest={version:1,policy:SAVED_ENCAR_SELECTION_POLICY,root,snapshotSha256:snapshotHash,entries:quarantined};
 const summary=Object.freeze({policy:SAVED_ENCAR_SELECTION_POLICY,snapshotSha256:snapshotHash,rawRows:count,uniqueIds:selected.size,publishableIds,
  supersededRows:count-quarantinedRows-publishableIds,quarantinedRows,quarantinedIds:quarantine.size,duplicateIds:allVersions.size,
  selectionSha256:rawHash(bindings),quarantineSha256:rawHash(manifest)});
 assert.equal(count,summary.publishableIds+summary.supersededRows+summary.quarantinedRows,'encar_revision_accounting');
 // Closures keep the selected map immutable to downstream callers.
 return Object.freeze({summary,quarantineManifest:()=>JSON.parse(JSON.stringify(manifest)),
  assertPage(page,rows){assert.equal(rawHash(rows),pageHashes.get(page),'encar_revision_page_changed');},
  classify(page,row,raw){const id=idOf(raw),v=selected.get(id);assert.ok(v,'encar_revision_unknown_id');if(quarantine.has(id))return 'quarantined';if(v.page!==page||v.row!==row)return 'superseded';assert.equal(rawHash(raw),v.rawSha256,'encar_revision_selected_changed');return 'selected';},
  accepts(page,row,raw){if(quarantine.has(idOf(raw)))return false;const v=selected.get(idOf(raw));assert.ok(v,'encar_revision_unknown_id');if(v.page!==page||v.row!==row)return false;assert.equal(rawHash(raw),v.rawSha256,'encar_revision_selected_changed');return true;},
  assertSnapshot(value){assert.equal(rawHash(value),snapshotHash,'encar_revision_snapshot_changed');}
 });
}
