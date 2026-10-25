import type {BudgetCountIndex} from './budget-count-index';
import {createHash} from 'node:crypto';
import {splitBudgetMarketIndex} from './budget-market-index';
import {compressBudgetSelector,packBudgetSelector,decompressBudgetSelector,unpackBudgetSelector,verifiedCompressedBudgetSelector,type CompressedBudgetDirectory,type SelectorChunk} from './budget-selector-codec';

export const MAX_PUBLISHED_SELECTOR_BYTES=4*1024*1024;
const allowed=new Set(['china','korea','japan','europe','uae','georgia']);
type Manifest={generationId:string;markets:Record<string,{count:number}>};
type Read=(name:string)=>Promise<any>;
/** Immutable local ownership, not a statement about the separate live AJES source. */
export function retainedSelectorMarkets(manifest:Manifest){
 const entries=Object.entries(manifest.markets||{});
 if(!manifest.generationId||!entries.length||entries.some(([market,value])=>!allowed.has(market)||!Number.isSafeInteger(value.count)||value.count<0))throw Error('budget_selector_manifest_invalid');
 const markets=entries.filter(([,value])=>value.count>0).map(([market])=>market).sort();
 if(!markets.length)throw Error('budget_selector_manifest_empty');
 return markets;
}
export async function inspectCompressedSelectors(manifest:Manifest,read:Read){
 const required=retainedSelectorMarkets(manifest),directory=await read('ready');
 const report:{generationId:string;requiredMarkets:string[];valid:boolean;markets:Record<string,any>;directory:CompressedBudgetDirectory|null}={generationId:manifest.generationId,requiredMarkets:required,valid:false,markets:{},directory:null};
 if(![3,4].includes(directory?.version)||directory.generationId!==manifest.generationId||JSON.stringify(Object.keys(directory.markets||{}).sort())!==JSON.stringify(required))return report;
 for(const market of required){
  const part=await readCompressedSelector(directory,market,read);
  report.markets[market]={valid:!!part,rows:part?.rows.length,otherRows:part?.otherRows?.length,chunks:directory.markets[market]?.chunks?.length};
  if(!part||part.rows.length+(part.otherRows?.length||0)===0)return report;
 }
 report.valid=true;report.directory=directory;return report;
}
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const MAX_SELECTOR_CHUNK_ROWS=1000;
/** Read old v3 or all independently verified v4 chunks. No partial result. */
export async function readCompressedSelector(directory:CompressedBudgetDirectory,market:string,read:Read):Promise<BudgetCountIndex|null>{
 try {
  if(directory?.version===3)return verifiedCompressedBudgetSelector(directory,market,await read(market));
  const entry=directory?.markets?.[market];
  if(directory?.version!==4||!allowed.has(market)||!entry||!Array.isArray(entry.chunks)||!entry.chunks.length||entry.chunks.length>100000||digest(entry.chunks)!==entry.checksum)return null;
  if(!Number.isSafeInteger(entry.rows)||entry.rows<0||!Number.isSafeInteger(entry.otherRows)||entry.otherRows<0)return null;
  const names=new Set<string>();let result:BudgetCountIndex|null=null,header='';
  for(const chunk of entry.chunks){
   if(!/^[a-f0-9]{64}$/.test(chunk.checksum)||chunk.name!==`parts/${market}/${chunk.checksum}`||names.has(chunk.name)||!Number.isSafeInteger(chunk.bytes)||chunk.bytes<=0||chunk.bytes>MAX_PUBLISHED_SELECTOR_BYTES)return null;
   if(!Number.isSafeInteger(chunk.rows)||chunk.rows<0||!Number.isSafeInteger(chunk.otherRows)||chunk.otherRows<0||chunk.rows+chunk.otherRows<1||chunk.rows+chunk.otherRows>MAX_SELECTOR_CHUNK_ROWS)return null;
   names.add(chunk.name);
  }
  for(let offset=0;offset<entry.chunks.length;offset+=4){
   const group=entry.chunks.slice(offset,offset+4),wires=await Promise.all(group.map(chunk=>read(chunk.name)));
   for(let i=0;i<group.length;i++){
   const chunk=group[i],wire=wires[i];
   if(!wire||Buffer.byteLength(JSON.stringify(wire))!==chunk.bytes||digest(wire)!==chunk.checksum)return null;
   const packed=decompressBudgetSelector(wire),part=unpackBudgetSelector(packed);
   if(part.generationId!==directory.generationId||part.rows.length!==chunk.rows||part.otherRows?.length!==chunk.otherRows||[...part.rows,...part.otherRows].some(row=>row[0]!==market))return null;
   const nextHeader=JSON.stringify(packed.index);
   if(header&&header!==nextHeader)return null;header=nextHeader;
   if(!result)result={...part,rows:[],otherRows:[]};
   result.rows.push(...part.rows);result.otherRows!.push(...part.otherRows);
   }
  }
  if(!result||result.rows.length!==entry.rows||result.otherRows!.length!==entry.otherRows||result.sourceRows!==entry.rows+entry.otherRows)return null;
  return result;
 }catch{return null;}
}
/** Chunks are content addressed. A failed upload/readback cannot replace readiness. */
export async function publishSelectorMarket(index:BudgetCountIndex,market:string,read:Read,write:(name:string,value:any)=>Promise<void>){
 if(!allowed.has(market)||!index.generationId||index.sourceRows!==index.rows.length+(index.otherRows?.length||0)||[...index.rows,...(index.otherRows||[])].some(row=>row[0]!==market))throw Error('budget_selector_market_invalid');
 const chunks:SelectorChunk[]=[];
 const emit=async(rows:BudgetCountIndex['rows'],otherRows:BudgetCountIndex['rows']):Promise<void>=>{
  const value=compressBudgetSelector(packBudgetSelector({...index,rows,otherRows})),bytes=Buffer.byteLength(JSON.stringify(value));
  if(bytes>MAX_PUBLISHED_SELECTOR_BYTES){
   const total=rows.length+otherRows.length;if(total<=1)throw Error('budget_selector_requires_bounded_parts');
   const mid=Math.floor(total/2),r=rows.length;
   await emit(rows.slice(0,mid),otherRows.slice(0,Math.max(0,mid-r)));
   await emit(rows.slice(mid),otherRows.slice(Math.max(0,mid-r)));return;
  }
  const checksum=digest(value),name=`parts/${market}/${checksum}`;
  await write(name,value);
  const saved=await read(name);
  if(!saved||Buffer.byteLength(JSON.stringify(saved))!==bytes||digest(saved)!==checksum)throw Error('catalog_compressed_selector_verification_failed');
  chunks.push({name,rows:rows.length,otherRows:otherRows.length,checksum,bytes});
 };
 // Slice each sequence independently to preserve both original row orders.
 for(const [rows,other] of [[index.rows,false],[index.otherRows||[],true]] as const){
  for(let offset=0;offset<rows.length;offset+=MAX_SELECTOR_CHUNK_ROWS){const slice=rows.slice(offset,offset+MAX_SELECTOR_CHUNK_ROWS);await emit(other?[]:slice,other?slice:[]);}
 }
 if(!chunks.length)throw Error('budget_selector_market_empty');
 const entry={rows:index.rows.length,otherRows:index.otherRows?.length||0,checksum:digest(chunks),chunks};
 const directory:CompressedBudgetDirectory={version:4,generationId:index.generationId,markets:{[market]:entry}};
 if(!await readCompressedSelector(directory,market,read))throw Error('catalog_compressed_selector_verification_failed');
 return entry;
}
export async function publishCompressedSelectors(index:BudgetCountIndex,read:Read,write:(name:string,value:any)=>Promise<void>){
 const {parts}=splitBudgetMarketIndex(index);
 const directory:CompressedBudgetDirectory={version:4,generationId:index.generationId,markets:{}};
 for(const [market,part] of parts)directory.markets[market]=await publishSelectorMarket(part,market,read,write);
 if(Buffer.byteLength(JSON.stringify(directory))>MAX_PUBLISHED_SELECTOR_BYTES)throw Error('budget_selector_directory_too_large');
 await write('ready',directory);return directory;
}
