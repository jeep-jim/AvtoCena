import assert from 'node:assert/strict';
import {chinaDeltaPrefix,validateChangePage} from './owned-china-delta.mjs';
import {readArchivedReport} from './nonjp-intake-archive.mjs';
const validRun=id=>typeof id==='string' && /^[1-9]\d*$/.test(id);
const root=id=>{
 assert(validRun(id),'invalid_china_cut_id');
 return chinaDeltaPrefix+'/runs/'+id;
};
const headKey=chinaDeltaPrefix+'/prepared.json';

export async function selectChinaCut(storage){
 const head=await storage.readJsonWithMeta(headKey,null);
 const source=await storage.readJson(chinaDeltaPrefix+'/source.json',null);
 if(!source)return null;
 assert(source.version===1&&source.market==='china'&&['complete','fetching'].includes(source.status),'china_source_head');
 const seen=new Set();
 let id=source.status==='complete'?source.runId:source.previousRun;
 if(!id||id===head.value?.runId)return null;
 while(id){
  assert(!seen.has(id),'china_source_cycle');
  seen.add(id);
  const cut=await storage.readJson(root(id)+'/complete.json',null);
  assert(cut?.status==='complete'&&cut.version===1&&cut.market==='china'&&cut.runId===id&&
   Number.isSafeInteger(cut.startCursor)&&Number.isSafeInteger(cut.cursor)&&cut.cursor>=cut.startCursor,'china_cut_manifest');
  if(cut.previousRun===(head.value?.runId??null)){
   const base=head.value??cut.base;
   assert(base?.cursor===cut.startCursor,'china_materialization_gap');
   return {cut,head,base};
  }
  id=cut.previousRun;
 }
 throw Error('china_materialization_lineage');
}

export async function savedChinaInventory(storage,selection,binding){
 const {base,cut}=selection;
 const report=await readArchivedReport(storage,base.archiveRoot,base.archiveSha256);
 const matches=report.sources?.filter(s=>s.sourceId==='autohome_used_china_open'&&s.provider==='auto_api_che168');
 const row=matches?.[0];
 assert(report.market==='china'&&report.completed===true&&matches?.length===1&&row.completeInventory===true&&
  row.stopReason==='source_finished'&&row.cursor===cut.startCursor&&row.replica?.cursor===row.cursor&&
  row.replica.binding===binding&&row.snapshotBinding===binding,'china_prepared_replica_lineage');
 return {version:1,market:'china',generationId:base.generationId??base.runId,updatedAt:report.completedAt,sources:[row]};
}

export function ownedChinaRequests(storage,cut,request){
 let activeCursor;
 return async(endpoint,args)=>{
  if(endpoint==='changes'){
   const cursor=args.change_id;
   assert(Number.isSafeInteger(cursor)&&cursor>=cut.startCursor&&cursor<=cut.cursor,'china_cut_cursor');
   const page=await storage.readJson(root(cut.runId)+'/pages/'+cursor+'.json',null);
   assert(page?.version===1&&page.cursor===cursor,'china_cut_page_missing');
   const next=validateChangePage(page.payload,cursor);
   assert(next===null?cursor===cut.cursor:next<=cut.cursor,'china_cut_boundary');
   activeCursor=cursor;
   return page.payload;
  }
  const id=String(args.inner_id);
  assert(endpoint==='offer'&&activeCursor!==undefined&&/^\d+$/.test(id),'unexpected_china_request');
  const key=root(cut.runId)+'/details/'+activeCursor+'/'+id+'.json';
  const existing=await storage.readJson(key,null);
  if(existing)return existing;
  const payload=await request(endpoint,args);
  await storage.writeJson(key,payload,{ifNoneMatch:'*'});
  const saved=await storage.readJson(key,null);
  assert.deepEqual(saved,payload);
  return saved;
 };
}

export async function commitChinaPrepared(storage,{cut,head},receipt){
 const report=await readArchivedReport(storage,receipt.root,receipt.manifestSha256);
 const source=report.sources?.find(s=>s.provider==='auto_api_che168');
 assert(receipt.market==='china'&&report.completed===true&&report.market==='china'&&source?.completeInventory===true&&
  source.initialCursor===cut.startCursor&&source.cursor===cut.cursor&&source.changes===cut.rows&&source.replica?.cursor===cut.cursor,'china_prepared_output_mismatch');
 const value={version:1,market:'china',runId:cut.runId,cursor:cut.cursor,archiveRoot:receipt.root,
  archiveSha256:receipt.manifestSha256,observations:source.observations,rateRun:cut.runId};
 await storage.writeJson(headKey,value,head.found?{ifMatch:head.etag}:{ifNoneMatch:'*'});
 assert.deepEqual(await storage.readJson(headKey,null),value);
 return value;
}
