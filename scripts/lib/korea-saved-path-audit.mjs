import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
export const ROOT='catalog/intake-staging/encar/43989797288/1';
export const SNAPSHOT_SHA='c34e0546b1214a3829b7b6317f87c2ff3be05ff8bc9cd7c0ec5db0e212b7ac43';
export const PRODUCER='e51f589f892babdcd6c1251e1ebb06c6d7c91e6d';
export const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export const SAMPLE_PAGES=[...new Set([1,2,684,1330,3007,10123,10198,...Array.from({length:32},(_,i)=>1+Math.floor(i*10197/31))])].sort((a,b)=>a-b);
export const TARGET_IDS=['42799484','42760061'];
export const CONTROLS='catalog/operations/collection-controls-v1.json';
export function allowedAuditPaths(){const keys=new Set([ROOT+'/complete.json',CONTROLS]);for(const page of SAMPLE_PAGES){keys.add(ROOT+'/pages/'+page+'.json');for(const n of [page-1,page,page+1])if(n>=1&&n<=10198)keys.add(ROOT+'/page-receipts/'+n+'.json');}return keys;}
const num=(v,min,max)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max?v:null;
const month=v=>typeof v==='string'&&/^\d{4}-(?:0[1-9]|1[0-2])$/.test(v)?v:null;
export function technicalRaw(data){return {year:num(data.year,1900,2100),modelYear:num(data.model_year,1900,2100),productionMonth:month(data.year_month),registrationMonth:month(data.first_registration),engineCc:num(data.displacement_cc,0,10000),powerHp:num(data.power,0,2500),iceHp:num(data.power_ice_hp,0,2500),motorPeakKw:num(data.power_electro_kw,0,2500),price:num(data.price,0,1e12),currency:['KRW','CNY','USD','EUR'].includes(data.currency)?data.currency:'unknown',powerFieldsPresent:{total:data.power!=null,ice:data.power_ice_hp!=null,motor:data.power_electro_kw!=null}};}
export function dateLossIssues(result){
 const baseline=result?.technical?.before?.engine||result?.technical?.engine, scenario=result?.technical?.before?{engine:result.technical.engine}:result?.technical?.supplierManufactureScenario;
 if(baseline?.status!=='ready'||scenario?.engine?.status!=='ready')return [];
 const monetary=['customsClearanceFeeRub','importDutyRub','exciseRub','vatRub','utilizationFeeRub','knownCustomsRub','totalCustomsRub'];
 const issues=[];
 if(monetary.some(k=>Number.isFinite(baseline[k])&&Number.isFinite(scenario.engine[k])&&baseline[k]!==scenario.engine[k]))issues.push('DATE_LOSS_CHANGES_CUSTOMS');
 const band=v=>v<=36?0:v<=60?1:2;
 if(Number.isFinite(baseline.ageMonths)&&Number.isFinite(scenario.engine.ageMonths)&&band(baseline.ageMonths)!==band(scenario.engine.ageMonths))issues.push('DATE_LOSS_CHANGES_AGE_BAND');
 return issues;
}
export function samplePriority(sample){return sample.issues.includes('DATE_LOSS_CHANGES_CUSTOMS')?4:sample.issues.includes('DATE_LOSS_CHANGES_AGE_BAND')?3:sample.issues.includes('SOURCE_ICE_POWER_PRESENT_NORMALIZED_ABSENT')?2:sample.issues.includes('CARD_DRAFT_VALIDATION_REJECTED')?1:0;}
export function retainSample(samples,sample,limit=64){
 samples.push(sample);samples.sort((a,b)=>samplePriority(b)-samplePriority(a)||a.coordinate.page-b.coordinate.page||a.coordinate.row-b.coordinate.row);
 if(samples.length>limit)samples.length=limit;
}
export async function auditSavedPages({storage,inspectRow,admit,controlsEnabled,snapshotSha=SNAPSHOT_SHA,pages=SAMPLE_PAGES}){
 const snapshot=await storage.readJson(ROOT+'/complete.json',null);assert.equal(hash(snapshot),snapshotSha);assert.equal(snapshot.producerSha,PRODUCER);assert.equal(snapshot.runId,'43989797288');assert.equal(snapshot.attempt,'1');assert.equal(snapshot.count,203948);assert.equal(snapshot.pages,10198);
 const before=await storage.readJson(CONTROLS,null);assert.ok(controlsEnabled(before));const authority={market:before.markets.korea,source:before.sources.encar_feed};
 const rejectedRecords=[],rejectionCounts={},receipts=new Map(),samples=[],issues={},beforeIssues={},strata={},sampleCounts={},targetProofs=Object.fromEntries(TARGET_IDS.map(id=>[hash(id),[]]));let examined=0,admitted=0;
 async function receipt(page){if(!receipts.has(page)){const r=await storage.readJson(ROOT+'/page-receipts/'+page+'.json',null);assert.ok(r);for(const k of ['version','market','provider','runId','attempt','producerSha'])assert.equal(r[k],snapshot[k]);assert.equal(r.page,page);assert.equal(r.next,page<snapshot.pages?page+1:null);receipts.set(page,r);}return receipts.get(page);}
 for(const page of pages){
  const control=await storage.readJson(CONTROLS,null);assert.ok(controlsEnabled(control));assert.deepEqual({market:control.markets.korea,source:control.sources.encar_feed},authority);
  const rows=await storage.readJson(ROOT+'/pages/'+page+'.json',null),r=await receipt(page);assert.ok(Array.isArray(rows)&&rows.length<=20);assert.equal(rows.length,r.count);assert.equal(hash(rows),r.sha256);
  if(page>1){const prev=await receipt(page-1);assert.equal(r.previousSha256,hash(prev));assert.equal(r.totalCount,prev.totalCount+r.count);}else{assert.equal(r.previousSha256,null);assert.equal(r.totalCount,r.count);}
  if(page<snapshot.pages){const next=await receipt(page+1);assert.equal(next.previousSha256,hash(r));assert.equal(next.totalCount,r.totalCount+next.count);}
  for(const [index,raw] of rows.entries()){
   examined++;assert.match(String(raw?.inner_id||''),/^\d{6,10}$/);assert.equal(String(raw.data?.inner_id),String(raw.inner_id));
   const admission=admit(raw.data);if(TARGET_IDS.includes(String(raw.inner_id))){const list=targetProofs[hash(String(raw.inner_id))];assert.ok(list.length<8);list.push({coordinate:{page,row:index+1},rawSha256:hash(raw),admitted:Boolean(admission),raw:technicalRaw(raw.data)});}
   if(!admission){strata.excluded=(strata.excluded||0)+1;continue;}admitted++;
   const result=await inspectRow(raw.data,{id:String(raw.inner_id),observedAt:snapshot.completedAt});
   assert.ok(result&&Array.isArray(result.issues)&&typeof result.stratum==='string');
   if(result.technical?.validation==='rejected'){const diagnostic=result.technical.rejectionDiagnostic;assert.ok(diagnostic&&typeof diagnostic.validationCode==='string','audit_rejection_diagnostic_missing');assert.ok(rejectedRecords.length<740,'audit_rejection_bound');rejectedRecords.push({coordinate:{page,row:index+1},rawSha256:hash(raw),identitySha256:hash(String(raw.inner_id)),stratum:result.stratum,...diagnostic,sourceEvidence:result.technical.sourceEvidence});const key=result.stratum+':'+diagnostic.validationCode;rejectionCounts[key]=(rejectionCounts[key]||0)+1;}
strata[result.stratum]=(strata[result.stratum]||0)+1;
   for(const code of result.technical?.beforeIssues||[])beforeIssues[code]=(beforeIssues[code]||0)+1;
   result.issues=[...new Set([...result.issues,...dateLossIssues(result)])];
   const tags=[result.stratum,...result.issues.map(code=>'issue:'+code)];for(const code of result.issues)issues[code]=(issues[code]||0)+1;
   if(tags.some(tag=>(sampleCounts[tag]||0)<(tag.startsWith('issue:DATE_LOSS_CHANGES_')?12:3))){for(const tag of tags)sampleCounts[tag]=(sampleCounts[tag]||0)+1;retainSample(samples,{coordinate:{page,row:index+1},identitySha256:hash(String(raw.inner_id)),rawSha256:hash(raw),raw:technicalRaw(raw.data),...result});}
  }
 }
 const after=await storage.readJson(CONTROLS,null);assert.ok(controlsEnabled(after));assert.deepEqual({market:after.markets.korea,source:after.sources.encar_feed},authority);assert.equal(hash(await storage.readJson(ROOT+'/complete.json',null)),snapshotSha);
 assert.equal(rejectedRecords.length,issues.CARD_DRAFT_VALIDATION_REJECTED||0,'audit_rejection_count_mismatch');
 return {rejectedRecords,rejectionCounts,version:1,scope:'bounded_saved_source_normalization_diagnostic',snapshotSha256:snapshotSha,pages:pages.length,examined,admitted,strata,issues,beforeIssues,samples,checks:{pageHashes:true,adjacentReceiptLinks:true,fullReceiptChain:false,controlsUnchanged:true,snapshotUnchanged:true},targetProofs,targetSearchComplete:false,missingTargetHashes:Object.entries(targetProofs).filter(([,v])=>v.length===0).map(([k])=>k),missingStrata:['combustion','electric','other_hybrid','series_hybrid'].filter(k=>!strata[k]),publicationAcceptance:false,selectionResolutionPerformed:false,storageWrites:0,supplierRequests:0};
}
