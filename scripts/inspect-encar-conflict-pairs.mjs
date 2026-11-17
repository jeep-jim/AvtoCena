import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
export const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const kind=v=>v===null?'null':Array.isArray(v)?'array':typeof v;
const safeKeys=new Set('history inspection diagnosis data result results response error errors status code message success ok available unavailable fetchedAt fetched_at updatedAt updated_at observedAt observed_at createdAt created_at timestamp generatedAt generated_at retry retryable count total items records type version checks accidents repair repairs owner owners insurance mileage distance damage details summary'.split(' '));
const label=k=>safeKeys.has(k)?k:'key#'+hash(k).slice(0,16);
export function leaf(v,key){
 const type=kind(v),o={type,digest:hash(v)};
 if(type==='array')o.length=v.length;
 if(type==='object')o.keys=Object.keys(v).map(label).sort();
 if(type==='string'){
  o.length=v.length;
  if(/^(?:fetched|updated|observed|created|generated)(?:At|_at)$|^timestamp$/.test(key)&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(v))o.technicalTimestamp=v;
  if(['status','code','success','ok','error'].includes(key)&&/^(?:ok|success|error|failed|failure|pending|unavailable|available|timeout|rate_limit|not_found|200|404|429|500|502|503|504)$/i.test(v))o.technicalStatus=v;
  if(['error','message'].includes(key))o.transientTextSignals={timeout:/timeout|timed out/i.test(v),rateLimit:/rate.?limit|too many requests/i.test(v),temporarilyUnavailable:/temporar|service unavailable|bad gateway/i.test(v),notFound:/not found/i.test(v)};
 }
 if(type==='boolean'&&['success','ok','retryable','available','unavailable'].includes(key))o.technicalFlag=v;
 if(type==='number'&&['status','code'].includes(key)&&[200,400,401,403,404,408,429,500,502,503,504].includes(v))o.technicalStatus=v;
 return o;
}
export function differences(a,b){
 const out=[];let visited=0;
 function walk(x,y,path,key,depth){
  assert.ok(++visited<=200000,'diff_node_limit');
  if(hash(x)===hash(y))return;
  assert.ok(out.length<2000,'diff_leaf_limit');
  if(kind(x)==='object'&&kind(y)==='object'&&depth<12){
   for(const k of [...new Set([...Object.keys(x),...Object.keys(y)])].sort()){
    if(!Object.hasOwn(x,k)||!Object.hasOwn(y,k)){out.push({path:[...path,label(k)],previous:Object.hasOwn(x,k)?leaf(x[k],k):{type:'missing'},incoming:Object.hasOwn(y,k)?leaf(y[k],k):{type:'missing'}});continue;}
    walk(x[k],y[k],[...path,label(k)],k,depth+1);
   }
  }else if(Array.isArray(x)&&Array.isArray(y)&&x.length===y.length&&depth<12){for(let i=0;i<x.length;i++)walk(x[i],y[i],[...path,i],key,depth+1);}
  else out.push({path,previous:leaf(x,key),incoming:leaf(y,key)});
 }
 walk(a,b,[],'',0);return out;
}
const fields=raw=>Object.fromEntries(['history','inspection','diagnosis'].map(k=>[k,raw.data[k]??null]));
export function authorityEvidence(a,b,snapshot){
 const present=v=>v!==null&&v!==undefined&&v!=='';
 const field=(x,k)=>({present:present(x[k]),type:kind(x[k])});
 const identityFields=['inner_id','vin','url','mark','model','generation','generation_code','configuration','complectation','year','model_year','first_registration_date','displacement_cc','engine_type','transmission_type','body_type','drive_type'];
 const identity=Object.fromEntries(identityFields.map(k=>[k,{previous:field(a.data,k),incoming:field(b.data,k),equal:hash(a.data[k]??null)===hash(b.data[k]??null)}]));
 const timestamp=v=>typeof v==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(v)&&Number.isFinite(Date.parse(v))?Date.parse(v):null;
 const dates={};for(const k of ['created_at','offer_created','first_advertised_at']){const x=timestamp(a.data[k]),y=timestamp(b.data[k]);dates[k]={previousValid:x!==null,incomingValid:y!==null,order:x!==null&&y!==null?Math.sign(y-x):null,bothBeforeSnapshot:x!==null&&y!==null&&Math.max(x,y)<=Date.parse(snapshot.completedAt)};}
 const reportDates={};for(const [block,key] of [['history','report_date'],['inspection','issue_date'],['diagnosis','date']]){const x=a.data[block]?.[key],y=b.data[block]?.[key],valid=v=>typeof v==='string'&&/^\d{4}-\d\d-\d\d$/.test(v)&&Number.isFinite(Date.parse(v));reportDates[block]={previousBlockType:kind(a.data[block]??null),incomingBlockType:kind(b.data[block]??null),previousDateValid:valid(x),incomingDateValid:valid(y),order:valid(x)&&valid(y)?Math.sign(Date.parse(y)-Date.parse(x)):null};}
 const ids={bothPositiveIntegers:[a.id,b.id].every(x=>Number.isSafeInteger(x)&&x>0),incomingGreater:Number.isSafeInteger(a.id)&&Number.isSafeInteger(b.id)?b.id>a.id:null,envelopeMatchesData:a.id===a.data.id&&b.id===b.data.id};
 const envelope={ids,createdAtMatchesData:a.created_at===a.data.created_at&&b.created_at===b.data.created_at,bothFullAdded:a.change_type==='added'&&b.change_type==='added',sameEnvelopeKeys:hash(Object.keys(a).sort())===hash(Object.keys(b).sort())};
 return {identity,dates,reportDates,envelope,sameSaleAdmission:['advertisement_type','sales_status','is_duplicate','duplicate_of','lease'].every(k=>hash(a.data[k]??null)===hash(b.data[k]??null)),samePriceAndCurrency:hash([a.data.price,a.data.currency])===hash([b.data.price,b.data.currency]),notAnAuthorityDecision:true};
}
export async function inspectPairs({storage,plan}){
 assert.equal(plan.root,'catalog/intake-staging/encar/43989797288/1');assert.equal(plan.conflicts.length,21);
 const root=plan.root,snapshot=await storage.readJson(root+'/complete.json',null);assert.equal(hash(snapshot),plan.snapshotSha256);
 assert.equal(snapshot.pages,plan.pages);assert.equal(snapshot.count,plan.count);
 const identity=['version','market','provider','runId','attempt','producerSha'];
 assert.equal(snapshot.runId,'43989797288');assert.equal(snapshot.attempt,'1');assert.equal(snapshot.market,'korea');
 const pages=new Map(),receipts=new Map();
 async function receipt(n){if(!receipts.has(n)){const r=await storage.readJson(root+'/page-receipts/'+n+'.json',null);assert.ok(r);for(const k of identity)assert.equal(r[k],snapshot[k]);assert.equal(r.page,n);assert.equal(r.next,n<snapshot.pages?n+1:null);assert.match(r.sha256,/^[a-f0-9]{64}$/);receipts.set(n,r);}return receipts.get(n);}
 async function page(n){
  if(pages.has(n))return pages.get(n);
  const rows=await storage.readJson(root+'/pages/'+n+'.json',null),r=await receipt(n);assert.ok(Array.isArray(rows));assert.equal(rows.length,r.count);assert.equal(hash(rows),r.sha256);
  if(n>1){const p=await receipt(n-1);assert.equal(hash(p),r.previousSha256);assert.equal(r.totalCount,p.totalCount+r.count);assert.equal(r.startedAt,p.startedAt);}
  else{assert.equal(r.previousSha256,null);assert.equal(r.totalCount,r.count);}
  if(n<snapshot.pages){const next=await receipt(n+1);assert.equal(next.previousSha256,hash(r));assert.equal(next.totalCount,r.totalCount+next.count);assert.equal(next.startedAt,r.startedAt);}
  pages.set(n,rows);return rows;
 }
 const reports=[];
 for(const c of plan.conflicts){
  const raw=[];for(const p of [c.previous,c.incoming]){const rows=await page(p.page),r=rows[p.row-1];assert.ok(r);assert.equal(String(r.inner_id),c.id);assert.equal(String(r.data?.inner_id),c.id);assert.equal(hash(fields(r)),p.digest);raw.push(r);}
  const [a,b]=raw;reports.push({id:c.id,authorityEvidence:authorityEvidence(a,b,snapshot),coordinates:{previous:[c.previous.page,c.previous.row],incoming:[c.incoming.page,c.incoming.row]},reportDifferences:differences(fields(a),fields(b)),envelopeDifferences:differences(Object.fromEntries(Object.entries(a).filter(([k])=>k!=='data')),Object.fromEntries(Object.entries(b).filter(([k])=>k!=='data'))),nonReportDataDifferences:differences(Object.fromEntries(Object.entries(a.data).filter(([k])=>!['history','inspection','diagnosis'].includes(k))),Object.fromEntries(Object.entries(b.data).filter(([k])=>!['history','inspection','diagnosis'].includes(k))))});
 }
 assert.equal(hash(await storage.readJson(root+'/complete.json',null)),plan.snapshotSha256);
 return {version:1,snapshotSha256:plan.snapshotSha256,conflicts:reports,selectedPages:pages.size,receiptsRead:receipts.size,checks:{rawPageHashes:true,adjacentReceiptLinks:true,fullSnapshotReceiptChain:false,fullInventoryRescan:false,idsAndExpectedReportHashes:true,snapshotUnchanged:true},resolutionSelected:false};
}
