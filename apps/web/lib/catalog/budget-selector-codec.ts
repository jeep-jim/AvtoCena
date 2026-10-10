import {gzipSync,gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import type {BudgetCountIndex,BudgetCountRow} from './budget-count-index';
import {splitBudgetMarketIndex} from './budget-market-index';
export type PackedBudgetSelector={encoding:1;columns:string[];index:Omit<BudgetCountIndex,'rows'|'otherRows'>;rows:unknown[][];otherRows:unknown[][]};
export type PackedBudgetDirectory={version:2;generationId:string;markets:Record<string,{rows:number;otherRows:number;checksum:string}>};
const digest=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
/** Only wire encoding changes. Values, row order, price inputs and missing/null
 * distinctions survive JSON round-trip; no business/calculation logic here. */
export function packBudgetSelector(input:BudgetCountIndex):PackedBudgetSelector {
 const {rows,otherRows=[],...index}=input;
 const columns=[...new Set([...rows,...otherRows].flatMap(row=>Object.keys(row[5]).filter(key=>(row[5] as any)[key]!==undefined)))];
 if(columns.length>50 || columns.some(key=>['__proto__','prototype','constructor'].includes(key)))throw Error('budget_selector_columns_invalid');
 const encode=(row:BudgetCountRow)=>{
  let mask=0;const values=columns.map((key,i)=>{const value=(row[5] as any)[key];if(value!==undefined)mask+=2**i;return value??null;});
  return [...row.slice(0,5),[mask,...values],...row.slice(6)];
 };
 return {encoding:1,columns,index,rows:rows.map(encode),otherRows:otherRows.map(encode)};
}
export function unpackBudgetSelector(packed:PackedBudgetSelector):BudgetCountIndex {
 if(packed?.encoding!==1 || !Array.isArray(packed.columns) || packed.columns.length>50 || new Set(packed.columns).size!==packed.columns.length || packed.columns.some(k=>typeof k!=='string'||['__proto__','prototype','constructor'].includes(k)) || packed.index?.version!==3 || !Array.isArray(packed.rows)||!Array.isArray(packed.otherRows))throw Error('budget_selector_invalid');
 const columns=packed.columns, width=columns.length, limit=2**width;
 const bits=columns.map((_,i)=>2**i);
 const decode=(row:unknown[]):BudgetCountRow=>{
  const data=row[5] as unknown[];
  if(!Array.isArray(data)||data.length!==width+1||!Number.isSafeInteger(data[0])||Number(data[0])<0||Number(data[0])>=limit)throw Error('budget_selector_row_invalid');
  const metadata:Record<string,unknown>={};
  const mask=Number(data[0]);
  for(let i=0;i<width;i++)if(Math.floor(mask/bits[i])%2===1)metadata[columns[i]]=data[i+1];
  if(typeof metadata.id!=='string'||!Number.isSafeInteger(metadata.block)||Number(metadata.block)<0)throw Error('budget_selector_identity_invalid');
  return [...row.slice(0,5),metadata,...row.slice(6)] as BudgetCountRow;
 };
 return {...packed.index,rows:packed.rows.map(decode),otherRows:packed.otherRows.map(decode)};
}
export function splitPackedBudgetSelectors(index:BudgetCountIndex){
 const {parts}=splitBudgetMarketIndex(index),packed=new Map<string,PackedBudgetSelector>();
 const directory:PackedBudgetDirectory={version:2,generationId:index.generationId,markets:{}};
 for(const [market,part] of parts){const value=packBudgetSelector(part);packed.set(market,value);directory.markets[market]={rows:part.rows.length,otherRows:part.otherRows!.length,checksum:digest(value)};}
 return {directory,parts:packed};
}
export function verifiedPackedBudgetSelector(directory:PackedBudgetDirectory,market:string,packed:PackedBudgetSelector|null):BudgetCountIndex|null {
 try{
  const expected=directory.markets?.[market];
  if(directory.version!==2||!expected||!packed||digest(packed)!==expected.checksum)return null;
  const index=unpackBudgetSelector(packed);
  return index.generationId===directory.generationId&&index.rows.length===expected.rows&&index.otherRows?.length===expected.otherRows&&[...index.rows,...index.otherRows].every(row=>row[0]===market)?index:null;
 }catch{return null;}
}


export const BUDGET_SELECTOR_STORAGE_VERSION = 3;
export type CompressedBudgetSelector = {encoding:'gzip-base64';payload:string};
export type CompressedBudgetDirectory = Omit<PackedBudgetDirectory,'version'> & {version:3};
// Derived, immutable selectors only. Bound inflation even if an object is corrupt.
const MAX_SELECTOR_BYTES = 128 * 1024 * 1024;
export function compressBudgetSelector(packed:PackedBudgetSelector):CompressedBudgetSelector {
 const json=Buffer.from(JSON.stringify(packed));
 if(json.length>MAX_SELECTOR_BYTES)throw Error('catalog_compressed_selector_too_large');
 return {encoding:'gzip-base64',payload:gzipSync(json,{level:6}).toString('base64')};
}
export function decompressBudgetSelector(value:CompressedBudgetSelector):PackedBudgetSelector {
 if(value?.encoding!=='gzip-base64'||typeof value.payload!=='string'||value.payload.length>MAX_SELECTOR_BYTES*2)throw Error('catalog_compressed_selector_invalid');
 const bytes=Buffer.from(value.payload,'base64');
 if(bytes.toString('base64')!==value.payload)throw Error('catalog_compressed_selector_invalid');
 return JSON.parse(gunzipSync(bytes,{maxOutputLength:MAX_SELECTOR_BYTES}).toString('utf8'));
}
export function compressedBudgetSelectors(packed:ReturnType<typeof splitPackedBudgetSelectors>){
 const parts=new Map<string,CompressedBudgetSelector>();
 const directory:CompressedBudgetDirectory={version:3,generationId:packed.directory.generationId,markets:{}};
 for(const [market,part] of packed.parts){
  let value:CompressedBudgetSelector;
  try{value=compressBudgetSelector(part);}catch(error){
   if((error as Error).message==='catalog_compressed_selector_too_large')continue;
   throw error;
  }
  parts.set(market,value);
  directory.markets[market]={...packed.directory.markets[market],checksum:digest(value)};
 }
 return {directory,parts};
}
export function verifiedCompressedBudgetSelector(directory:CompressedBudgetDirectory,market:string,value:CompressedBudgetSelector|null):BudgetCountIndex|null {
 try{
  const expected=directory.markets?.[market];
  if(directory.version!==3||!expected||!value||digest(value)!==expected.checksum)return null;
  const index=unpackBudgetSelector(decompressBudgetSelector(value));
  return index.generationId===directory.generationId&&index.rows.length===expected.rows&&index.otherRows?.length===expected.otherRows&&[...index.rows,...index.otherRows].every(row=>row[0]===market)?index:null;
 }catch{return null;}
}
