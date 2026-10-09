import {createHash} from 'node:crypto';
import type {BudgetCountIndex} from './budget-count-index';
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export type BudgetMarketDirectory={version:1;generationId:string;markets:Record<string,{rows:number;otherRows:number;checksum:string}>};
export function splitBudgetMarketIndex(index:BudgetCountIndex){
 if(index.version!==3 || !Array.isArray(index.otherRows))throw Error('catalog_budget_market_source_invalid');
 const directory:BudgetMarketDirectory={version:1,generationId:index.generationId,markets:{}};
 const parts=new Map<string,BudgetCountIndex>();
 for(const market of new Set([...index.rows,...index.otherRows].map(row=>row[0]))){
  if(!/^(china|korea|japan|europe|uae|georgia)$/.test(market))throw Error('catalog_budget_market_invalid');
  const rows=index.rows.filter(row=>row[0]===market),otherRows=index.otherRows.filter(row=>row[0]===market);
  const part={...index,rows,otherRows,sourceRows:rows.length+otherRows.length,pricingChunks:{[market]:index.pricingChunks?.[market]||[]}};
  // Preserve absence: an inline v3 replay must not turn into an empty chunk list.
  if(!index.pricingChunks?.[market])delete part.pricingChunks[market];
  parts.set(market,part);
  directory.markets[market]={rows:rows.length,otherRows:otherRows.length,checksum:digest(part)};
 }
 return {directory,parts};
}
export function validBudgetMarketIndex(directory:BudgetMarketDirectory,market:string,part:BudgetCountIndex|null){
 const descriptor=directory.markets?.[market];
 return Boolean(descriptor && part && part.version===3 && part.generationId===directory.generationId
  && part.rows.length===descriptor.rows && part.otherRows?.length===descriptor.otherRows
  && [...part.rows,...part.otherRows].every(row=>row[0]===market)
  && digest(part)===descriptor.checksum);
}
