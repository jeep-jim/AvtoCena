import 'server-only';
import {headers} from 'next/headers';
import {DetailReadCache} from './detail-read-cache';
import {ajesClient} from './ajes-runtime';
import {AjesUnavailable,readAjesModelDirectory} from './ajes-client';
import {ajesQuery,type AjesQuery} from './ajes-query';
import type {AjesPublicEvidenceSnapshot} from './ajes-public';
import {buildJapanBodyCandidatePlan} from './japan-body-selection';
import {buildJapanPowerCandidatePlan,resolveJapanSourceSelection} from './japan-source-selection';

// This is the permitted names directory for the visitor's selection, never a
// collection of vehicle LIST pages. Reuse only its remaining source freshness.
const directories=new DetailReadCache<Awaited<ReturnType<typeof readAjesModelDirectory>>>({
 maxEntries:16,maxBytes:4*1024*1024,ttlMs:30*60000,concurrency:2,
 expiresAt:value=>Date.parse(value.observedAt)+30*60000,shouldCache:value=>!value.stale,
});
// Retain only a completed names observation for refusal recovery. This does
// not refresh its date or certify current inventory; it keeps an already issued
// source selection stable when metadata temporarily becomes unavailable.
const retainedDirectories=new DetailReadCache<Awaited<ReturnType<typeof readAjesModelDirectory>>>({
 maxEntries:16,maxBytes:4*1024*1024,ttlMs:7*86400000,concurrency:2,
 expiresAt:value=>Date.parse(value.observedAt)+7*86400000,shouldCache:value=>!value.stale,
});
const recoverable=(error:unknown)=>error instanceof AjesUnavailable
 &&/^(?:http_(?:429|5\d\d)|local_busy|visitor_restricted|request_timeout|connect_timeout|request_failed|quota_exhausted|quota_busy|invalid_response|empty_response|response_too_large|query_too_large|directory_too_large|directory_page_repeated)$/.test(error.reason)
 ||error instanceof Error&&/^detail_cache_queue_(?:timeout|full)$/.test(error.message);

/** Put the actual candidate selection before the supplier LIMIT. Local
 * admission still decides each car's membership. A directory refusal keeps the
 * previous broad query available, with explicit incompleteness; it never proves
 * that the known phase is empty or authorizes a source-wide vehicle walk. */
export async function readAjesSourceSelection(query:AjesQuery,params:Record<string,unknown>,snapshot:AjesPublicEvidenceSnapshot){
 const body=String(params.bodyType||params.body||'');
 const power=query.powerFrom!==undefined||query.powerTo!==undefined;
 if(!body&&!power)return {query,selectionIncomplete:false,sourceScopeComplete:true};
 const namesQuery={...query};
 delete namesQuery.page;delete namesQuery.pageSize;delete namesQuery.sort;
 delete namesQuery.powerFrom;delete namesQuery.powerTo;
 const key=ajesQuery({...namesQuery,aggregate:'models'},snapshot.calculationIndex).sql;
 const ip=(await headers()).get('x-real-ip')||'';
 let directory:Awaited<ReturnType<typeof readAjesModelDirectory>>;
 try{
  directory=await directories.get(key,()=>readAjesModelDirectory(ajesClient,namesQuery,ip),ip+'\0'+key);
 }catch(error){
  if(!recoverable(error))throw error;
  const retained=retainedDirectories.peekFresh(key);
  if(!retained)return {query,selectionIncomplete:true,sourceScopeComplete:false};
  directory={...retained,stale:true};
 }
 if(directory.stale){
  // A stale first directory page is not the previously completed directory.
  // Use the latter as a whole, or keep the existing broad reader explicitly
  // incomplete. Never narrow to the first 500 names after a refused refresh.
  const retained=retainedDirectories.peekFresh(key);
  if(!retained)return {query,selectionIncomplete:true,sourceScopeComplete:false};
  directory={...retained,stale:true};
 }else{
  const retained=retainedDirectories.peekFresh(key);
  if(!retained||Date.parse(directory.observedAt)>Date.parse(retained.observedAt)){
   retainedDirectories.invalidate(key);
   await retainedDirectories.get(key,async()=>directory);
  }
 }
 const observedSourceFields=body?await ajesClient.readSavedSourceFields(query):undefined;
 const powerPlan=power?buildJapanPowerCandidatePlan({powerFrom:query.powerFrom,powerTo:query.powerTo,
  index:snapshot.calculationIndex,editorial:snapshot.editorial}):undefined;
 const bodyPlan=body?buildJapanBodyCandidatePlan({selection:body,index:snapshot.calculationIndex,
  editorial:snapshot.editorial,observedSourceFields}):undefined;
 const plan=resolveJapanSourceSelection({power:powerPlan,body:bodyPlan,sourceModels:directory.models,directoryComplete:true});
 if(!plan.selection)return {query,selectionIncomplete:true,sourceScopeComplete:false};
 return {query:{...query,sourceSelection:plan.selection},selectionIncomplete:directory.stale,sourceScopeComplete:plan.complete&&!directory.stale};
}
