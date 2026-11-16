import {createHash} from 'node:crypto';
import type {BudgetCountRow} from './budget-count-index';
import type {CatalogSearchProjection} from './storage';

const supplement = /^budget-source-supplements-v1\/([a-f0-9]{64})\/cards\/(china|korea|uae|europe|georgia)\/([a-f0-9]{64})\.json$/;
export type BudgetCardPart = {generationId:string;items:CatalogSearchProjection[];market?:string;block?:number};
export type BudgetCardGroup = {path:string;block:number;rows:BudgetCountRow[];supplement:boolean};
export function budgetCardPath(row:BudgetCountRow, version:1|2|3) {
 const metadata=row[5];
 if(!Number.isSafeInteger(metadata.block)||metadata.block<0)throw Error('budget_card_block_invalid');
 if(metadata.cardPath!==undefined){
  const match=supplement.exec(metadata.cardPath);
  if(version!==3||!match||match[2]!==row[0])throw Error('budget_card_supplement_scope');
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
export function assertBudgetSupplementCard(group:BudgetCardGroup, part:BudgetCardPart, generationId:string) {
 if(!group.supplement)return;
 const match=supplement.exec(group.path)!;
 const digest=createHash('sha256').update(JSON.stringify(part)).digest('hex');
 if(digest!==match[3]||part?.generationId!==generationId||part.market!==match[2]||part.block!==group.block
  ||!Array.isArray(part.items)||part.items.length<1||part.items.length>256)throw Error('budget_card_supplement_invalid');
 const ids=new Set(part.items.map(row=>row.id));
 if(ids.size!==part.items.length||part.items.some(row=>row.market!==part.market)
  ||group.rows.some(row=>!ids.has(row[5].id)))throw Error('budget_card_supplement_identity');
}
