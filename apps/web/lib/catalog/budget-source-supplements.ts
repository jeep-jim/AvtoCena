import {createHash} from 'node:crypto';
import {buildBudgetCountIndex,type BudgetCountIndex,type BudgetCountRow} from './budget-count-index';
import type {CatalogSearchProjection} from './storage';

const markets=new Set(['china','korea','uae','europe','georgia']);
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const validId=(id:unknown):id is string=>typeof id==='string'&&/^[A-Za-z0-9_-]{1,150}$/.test(id);
export const BUDGET_SUPPLEMENT_LIMITS={rows:10000,objects:200,objectBytes:4*1024*1024,totalBytes:64*1024*1024};
export type BudgetSupplementObject={path:string;value:any};
export type BudgetSupplementDescriptor={path:string;kind:'card'|'replay';sha256:string;bytes:number;rows:number;idsSha256:string};
export type BudgetSourceDescriptor={version:1;generationId:string;market:string;calculationVersion:string;encyclopediaDigest:string|null;
 contextSha256:string;baselineSourceIds:string;baselineSourceRows:number;sourceIds:string;sourceRows:number;sourceCardsSha256:string;pricingChunksSha256:string;projectionIdsSha256:string;
 eligibleIdsSha256:string;missingIds:string[];objects:BudgetSupplementDescriptor[];checksum:string};
export type BudgetSpecificationSource={index:BudgetCountIndex;descriptor:BudgetSourceDescriptor;objects:BudgetSupplementObject[]};

/** Preparation-only, deterministic union. Existing selector rows, block maps,
 * replay paths and relative order are preserved. Every new ID has a real,
 * bounded content-addressed card object in this calculator's own namespace. */
export function buildBudgetSpecificationSource({index,projection,market,expectedRows,prepareRows,calculationVersion,encyclopediaDigest}:{
 index:BudgetCountIndex;projection:{generationId:string;items:CatalogSearchProjection[]};market:string;expectedRows:number;
 prepareRows:(rows:CatalogSearchProjection[])=>CatalogSearchProjection[];calculationVersion:string;encyclopediaDigest:string|null;
}):BudgetSpecificationSource {
 if(!markets.has(market)||index?.version!==3||!/^[A-Za-z0-9_-]{1,150}$/.test(calculationVersion)
  ||encyclopediaDigest!==null&&!/^[a-f0-9]{64}$/.test(encyclopediaDigest))throw Error('budget_supplement_context_invalid');
 if(projection?.generationId!==index.generationId||!Array.isArray(projection.items)||!Number.isSafeInteger(expectedRows)
  ||expectedRows<0||projection.items.length!==expectedRows)throw Error('budget_supplement_projection_incomplete');
 const rawIds=new Set<string>();
 for(const row of projection.items){
  if(row?.market!==market||!validId(row.id)||rawIds.has(row.id))throw Error('budget_supplement_projection_identity');
  rawIds.add(row.id);
 }
 const before=[...index.rows,...(index.otherRows||[])],sourceIds=new Set<string>();
 if(index.sourceRows!==before.length)throw Error('budget_supplement_source_count');
 for(const row of before){
  if(row[0]!==market||!rawIds.has(row[5]?.id)||sourceIds.has(row[5].id)||row[5].cardPath!==undefined)throw Error('budget_supplement_source_identity');
  sourceIds.add(row[5].id);
 }
 const eligible=prepareRows(projection.items),eligibleIds=new Set<string>();
 for(const row of eligible){
  if(!rawIds.has(row.id)||eligibleIds.has(row.id)||row.market!==market)throw Error('budget_supplement_eligible_identity');
  eligibleIds.add(row.id);
 }
 const missing=eligible.filter(row=>!sourceIds.has(row.id)).sort((a,b)=>a.id.localeCompare(b.id));
 if(missing.length>BUDGET_SUPPLEMENT_LIMITS.rows)throw Error('budget_supplement_capacity');
 const contextSha256=hash([encyclopediaDigest,calculationVersion]),prefix=`budget-source-supplements-v1/${contextSha256}`;
 const objects:BudgetSupplementObject[]=[],descriptors:BudgetSupplementDescriptor[]=[],blocks=new Map<string,number>(),cardPaths=new Map<string,string>();
 let totalBytes=0;
 const add=(kind:'card'|'replay',value:any,ids:string[])=>{
  const sha256=hash(value),bytes=Buffer.byteLength(JSON.stringify(value));totalBytes+=bytes;
  if(bytes>BUDGET_SUPPLEMENT_LIMITS.objectBytes||totalBytes>BUDGET_SUPPLEMENT_LIMITS.totalBytes
   ||objects.length>=BUDGET_SUPPLEMENT_LIMITS.objects)throw Error('budget_supplement_capacity');
  const path=`${prefix}/${kind==='card'?'cards':'replay'}/${market}/${sha256}.json`;
  objects.push({path,value});descriptors.push({path,kind,sha256,bytes,rows:ids.length,idsSha256:hash(ids)});return path;
 };
 // Byte bounds split before emission as well as bounding each individual row.
 let cardRows:CatalogSearchProjection[]=[],cardBytes=128,block=0;
 const emitCard=()=>{
  if(!cardRows.length)return;
  const path=add('card',{generationId:index.generationId,market,block,items:cardRows},cardRows.map(row=>row.id));
  for(const row of cardRows){blocks.set(row.id,block);cardPaths.set(row.id,path);}
  block++;cardRows=[];cardBytes=128;
 };
 for(const row of missing){
  const bytes=Buffer.byteLength(JSON.stringify(row))+1;
  if(cardRows.length&&(cardRows.length>=256||cardBytes+bytes>BUDGET_SUPPLEMENT_LIMITS.objectBytes))emitCard();
  cardRows.push(row);cardBytes+=bytes;
 }
 emitCard();
 const added=buildBudgetCountIndex(index.generationId,missing,blocks,3);
 for(const row of [...added.rows,...(added.otherRows||[])]){
  const cardPath=cardPaths.get(row[5].id);
  if(!cardPath||!blocks.has(row[5].id))throw Error('budget_supplement_card_missing');
  row[5]={...row[5],cardPath};
 }
 if(added.sourceRows!==missing.length||added.rows.length+(added.otherRows?.length||0)!==missing.length)throw Error('budget_supplement_eligible_dropped');
 // The existing per-market publisher canonically stores an empty object for
 // inline replay. Do not create an empty market array: that means chunk replay.
 let pricingChunks=index.pricingChunks||{};
 if(index.pricingChunks?.[market]&&added.rows.length){
  const paths=[...index.pricingChunks[market]],entries:Array<[string,Partial<CatalogSearchProjection>]> = [];
  for(const row of added.rows){if(!row[7])throw Error('budget_supplement_replay_missing');entries.push([row[5].id,row[7]]);}
  for(let offset=0;offset<entries.length;){
   const part:Array<[string,Partial<CatalogSearchProjection>]> = [];let bytes=128;
   while(offset<entries.length&&part.length<500){
    const next=entries[offset],size=Buffer.byteLength(JSON.stringify(next))+1;
    if(part.length&&bytes+size>BUDGET_SUPPLEMENT_LIMITS.objectBytes)break;
    part.push(next);bytes+=size;offset++;
   }
   paths.push(add('replay',{generationId:index.generationId,market,entries:part},part.map(row=>row[0])));
  }
  pricingChunks={...index.pricingChunks,[market]:paths};
  added.rows=added.rows.map(row=>row.slice(0,7) as BudgetCountRow);
 }
 const result={...index,sourceRows:index.sourceRows+missing.length,rows:[...index.rows,...added.rows],
  otherRows:[...(index.otherRows||[]),...(added.otherRows||[])],pricingChunks};
 const body={version:1 as const,generationId:index.generationId,market,calculationVersion,encyclopediaDigest,contextSha256,
  baselineSourceIds:hash(before.map(row=>row[5].id)),baselineSourceRows:before.length,
  sourceIds:hash([...result.rows,...result.otherRows].map(row=>row[5].id)),sourceRows:result.sourceRows,
  sourceCardsSha256:hash([...result.rows,...result.otherRows].map(row=>[row[5].id,row[5].block,row[5].cardPath??null])),
  pricingChunksSha256:hash(result.pricingChunks??null),
  projectionIdsSha256:hash([...rawIds].sort()),eligibleIdsSha256:hash([...eligibleIds].sort()),missingIds:missing.map(row=>row.id),objects:descriptors};
 return {index:result,descriptor:{...body,checksum:hash(body)},objects};
}

export function assertBudgetSupplementObject(expected:BudgetSupplementDescriptor,value:unknown){
 if(hash(value)!==expected.sha256||Buffer.byteLength(JSON.stringify(value))!==expected.bytes)throw Error('budget_supplement_object_changed');
 const row=value as any,ids=expected.kind==='card'?row.items?.map((item:any)=>item.id):row.entries?.map((entry:any)=>entry[0]);
 if(!Array.isArray(ids)||ids.length!==expected.rows||new Set(ids).size!==ids.length||hash(ids)!==expected.idsSha256)throw Error('budget_supplement_object_identity');
}
