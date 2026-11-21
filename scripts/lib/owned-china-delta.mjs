import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {REV6} from '../../.github/operations/china-daily-rev6-bootstrap-readonly-v1/daily-core.mjs';
import {V3} from '../../.github/operations/china-daily-rev6-bootstrap-readonly-v1/rev6-bootstrap.mjs';
export const chinaDeltaPrefix='catalog/owned-feed/v1/china';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const integer=n=>Number.isSafeInteger(n)&&n>=0;
const run=id=>typeof id==='string' && /^[1-9]\d*$/.test(id);
const condition=entry=>entry.found?{ifMatch:entry.etag}:{ifNoneMatch:'*'};
export async function acceptedChinaBase(storage) {
 const [control,archive]=await Promise.all([storage.getBinary('catalog/independent-market-public-v1/china/control.json'),storage.getBinary(V3.root+'/complete.json')]);
 const state=JSON.parse(control.data),manifest=JSON.parse(archive.data);
 assert(sha(control.data)===REV6.controlSha256 && state.active?.generationId===REV6.generationId &&
  state.active?.readySha256===REV6.readySha256 && sha(archive.data)===REV6.archiveSha256 &&
  manifest.market==='china' && manifest.collection?.complete===true && manifest.reportDigest===V3.reportSha256,
  'china_bootstrap_generation_changed');
 return {cursor:REV6.cursor,generationId:REV6.generationId,archiveRoot:V3.root,archiveSha256:REV6.archiveSha256};
}
export function validateChangePage(payload,cursor) {
 assert(Array.isArray(payload?.result)&&payload.meta?.cur_change_id===cursor,'china_change_page_identity');
 if(!payload.result.length) return null;
 const next=payload.meta.next_change_id;
 assert(integer(next)&&next>cursor,'china_change_page_next');
 for(const row of payload.result) assert(integer(row.id)&&row.id>=cursor&&row.id<=next&&/^\d+$/.test(String(row.inner_id))&&
  ['added','changed','removed'].includes(row.change_type),'china_change_row');
 return next;
}
// Persist the original envelope before advancing. Empty terminal pages belong
// to one run. The next download may see new events at the same cursor.
export async function collectChinaDelta({storage,runId,initialBase=acceptedChinaBase,request,bindRates,log=()=>{}}){
 assert(run(runId),'invalid_china_run');
 const key=chinaDeltaPrefix+'/source.json';
 let entry=await storage.readJsonWithMeta(key,null);
 async function checkpoint(value){
  await storage.writeJson(key,value,condition(entry));
  entry=await storage.readJsonWithMeta(key,null);
  assert(entry.found&&entry.etag&&JSON.stringify(entry.value)===JSON.stringify(value),'china_cursor_readback');
 }
 let state=entry.value;
 if(state)assert(state.version===1&&state.market==='china'&&run(state.runId)&&integer(state.cursor)&&
   integer(state.startCursor)&&state.cursor>=state.startCursor&&integer(state.pages)&&integer(state.rows)&&
   ['fetching','complete'].includes(state.status),'invalid_china_source_state');
 if(!state||state.status==='complete'&&state.runId!==runId){
  const base=state?.base??await initialBase(storage);
  const startCursor=state?.cursor??base.cursor;
  state={version:1,market:'china',status:'fetching',base,runId,startCursor,cursor:startCursor,
   previousRun:state?.runId??null,startedAt:new Date().toISOString(),pages:0,rows:0};
  await checkpoint(state);
 }
 if(state.status==='complete')return state;
 await bindRates(state.runId);
 const root=chinaDeltaPrefix+'/runs/'+state.runId;
 log({phase:'china_delta_start',runId:state.runId,base:state.base.generationId,cursor:state.cursor});
 while(state.status==='fetching'){
  const pageKey=root+'/pages/'+state.cursor+'.json';
  let saved=await storage.readJson(pageKey,null);
  if(!saved){
   const payload=await request(state.cursor);
   validateChangePage(payload,state.cursor);
   saved={version:1,cursor:state.cursor,receivedAt:new Date().toISOString(),payload};
   await storage.writeJson(pageKey,saved,{ifNoneMatch:'*'});
   const copy=await storage.readJson(pageKey,null);
   assert(copy&&sha(JSON.stringify(copy))===sha(JSON.stringify(saved)),'china_source_page_readback');
  }
  assert(saved.version===1&&saved.cursor===state.cursor,'china_saved_page_identity');
  const next=validateChangePage(saved.payload,state.cursor);
  if(next===null){
   state={...state,status:'complete',completedAt:saved.receivedAt};
   const manifestKey=root+'/complete.json',previous=await storage.readJson(manifestKey,null);
   if(previous)assert.deepEqual(previous,state);else await storage.writeJson(manifestKey,state,{ifNoneMatch:'*'});
   assert.deepEqual(await storage.readJson(manifestKey,null),state);
  }else{
   state={...state,cursor:next,pages:state.pages+1,rows:state.rows+saved.payload.result.length};
  }
  await checkpoint(state);
  if(state.pages===1 || state.pages%100===0 || state.status==='complete')
   log({phase:state.status,runId:state.runId,pages:state.pages,sourceEvents:state.rows,cursor:state.cursor});
 }
 return state;
}
