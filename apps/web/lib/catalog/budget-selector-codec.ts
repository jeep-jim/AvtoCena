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
 const decode=(row:unknown[]):BudgetCountRow=>{
  const data=row[5] as unknown[];
  if(!Array.isArray(data)||data.length!==packed.columns.length+1||!Number.isSafeInteger(data[0])||Number(data[0])<0||Number(data[0])>=2**packed.columns.length)throw Error('budget_selector_row_invalid');
  const metadata:Record<string,unknown>={};
  for(let i=0;i<packed.columns.length;i++)if(Math.floor(Number(data[0])/2**i)%2===1)metadata[packed.columns[i]]=data[i+1];
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
