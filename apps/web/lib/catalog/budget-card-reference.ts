import {createHash} from 'node:crypto';
import type {BudgetCountRow} from './budget-count-index';
import type {CatalogSearchProjection} from './storage';
import {readCalculationIndex} from '../encyclopedia/calculation-index';
import {calculationCacheVersion} from './shared-budget-prices';

const supplement = /^budget-source-supplements-v1\/([a-f0-9]{64})\/cards\/(china|korea|uae|europe|georgia)\/([a-f0-9]{64})\.json$/;
const replaySupplement = /^budget-source-supplements-v1\/([a-f0-9]{64})\/replay\/(china|korea|uae|europe|georgia)\/([a-f0-9]{64})\.json$/;
const activeContext=()=>createHash('sha256').update(JSON.stringify([readCalculationIndex()?.digest||null,calculationCacheVersion()])).digest('hex');
export type BudgetCardPart = {generationId:string;items:CatalogSearchProjection[];market?:string;block?:number};
export type BudgetCardGroup = {path:string;block:number;rows:BudgetCountRow[];supplement:boolean};
export function budgetCardPath(row:BudgetCountRow, version:1|2|3) {
 const metadata=row[5];
 if(!Number.isSafeInteger(metadata.block)||metadata.block<0)throw Error('budget_card_block_invalid');
 if(metadata.cardPath!==undefined){
  const match=typeof metadata.cardPath==='string'?supplement.exec(metadata.cardPath):null;
  if(version!==3||!match||match[2]!==row[0])throw Error('budget_card_supplement_scope');
  if(match[1]!==activeContext())throw Error('budget_card_supplement_context');
  return metadata.cardPath;
 }
 return `budget-cards-v${version}/${metadata.block}.json`;
}
/** A numeric block is local to its actual path. Supplemental block zero never
 * aliases generic block zero, including aggregate searches across markets. */
export function budgetCardGroups(rows:BudgetCountRow[], version:1|2|3):BudgetCardGroup[] {
 const groups=new Map<string,BudgetCardGroup>();
 for(const row of rows){
  const path=budgetCardPath(row,version),known=groups.get(path);
  if(known){
   if(known.block!==row[5].block)throw Error('budget_card_supplement_block_mismatch');
   known.rows.push(row);
  }else groups.set(path,{path,block:row[5].block,rows:[row],supplement:row[5].cardPath!==undefined});
 }
 return [...groups.values()];
}
/** Check before storage access as well as after an asynchronous/cache read. A
 * content hash proves integrity, not authority under the installed calculator. */
export function assertBudgetSupplementCardContext(group:BudgetCardGroup){
 if(!group.supplement)return;
 const match=supplement.exec(group.path);
 if(!match||match[1]!==activeContext())throw Error('budget_card_supplement_context');
}
export function assertBudgetSupplementCard(group:BudgetCardGroup, part:BudgetCardPart, generationId:string) {
 if(!group.supplement)return;
 assertBudgetSupplementCardContext(group);
 const match=supplement.exec(group.path)!;
 const digest=createHash('sha256').update(JSON.stringify(part)).digest('hex');
 if(digest!==match[3]||part?.generationId!==generationId||part.market!==match[2]||part.block!==group.block
  ||!Array.isArray(part.items)||part.items.length<1||part.items.length>256)throw Error('budget_card_supplement_invalid');
 const ids=new Set(part.items.map(row=>row.id));
 if(ids.size!==part.items.length||part.items.some(row=>row.market!==part.market)
  ||group.rows.some(row=>!ids.has(row[5].id)))throw Error('budget_card_supplement_identity');
}
export function budgetReplayPath(path:string,market:string){
 if(!path.startsWith('budget-source-supplements'))return path;
 const match=replaySupplement.exec(path);
 if(!match||match[2]!==market)throw Error('budget_replay_supplement_scope');
 if(match[1]!==activeContext())throw Error('budget_replay_supplement_context');
 return path;
}
export function assertBudgetSupplementReplay(path:string,part:unknown,generationId:string,market:string){
 budgetReplayPath(path,market);
 const match=replaySupplement.exec(path);if(!match)return;
 const value=part as {generationId?:string;market?:string;entries?:unknown[][]}|null;
 if(createHash('sha256').update(JSON.stringify(part)).digest('hex')!==match[3]||value?.generationId!==generationId||value.market!==market
  ||!Array.isArray(value.entries)||value.entries.length<1||value.entries.length>500)throw Error('budget_replay_supplement_invalid');
}
