import type {BudgetCountIndex} from './budget-count-index';
import {compressedBudgetSelectors,splitPackedBudgetSelectors,verifiedCompressedBudgetSelector,type CompressedBudgetDirectory} from './budget-selector-codec';

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
 if(directory?.version!==3||directory.generationId!==manifest.generationId||JSON.stringify(Object.keys(directory.markets||{}).sort())!==JSON.stringify(required))return report;
 for(const market of required){
  const value=await read(market),part=verifiedCompressedBudgetSelector(directory,market,value);
  report.markets[market]={valid:!!part,bytes:Buffer.byteLength(JSON.stringify(value)),rows:part?.rows.length,otherRows:part?.otherRows?.length};
  if(!part||part.rows.length+(part.otherRows?.length||0)===0)return report;
 }
 report.valid=true;report.directory=directory;return report;
}
/** Publish only the already-supported v3 encoding. Never rewrite legacy v1/v2.
 * All parts are bounded and read back before the readiness pointer is exposed. */
export async function publishCompressedSelectors(index:BudgetCountIndex,read:Read,write:(name:string,value:any)=>Promise<void>){
 const packed=splitPackedBudgetSelectors(index),compressed=compressedBudgetSelectors(packed);
 if(JSON.stringify([...packed.parts.keys()].sort())!==JSON.stringify([...compressed.parts.keys()].sort()))throw Error('budget_selector_compressed_market_missing');
 for(const value of compressed.parts.values())if(Buffer.byteLength(JSON.stringify(value))>MAX_PUBLISHED_SELECTOR_BYTES)throw Error('budget_selector_requires_bounded_parts');
 for(const [market,value] of compressed.parts){
  await write(market,value);
  if(!verifiedCompressedBudgetSelector(compressed.directory,market,await read(market)))throw Error('catalog_compressed_selector_verification_failed');
 }
 await write('ready',compressed.directory);
 return compressed.directory;
}
