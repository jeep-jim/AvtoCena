import {catalogBodyType} from './pickup-body';
import type {BudgetCountIndex, BudgetMetadata} from './budget-count-index';
import type {CatalogSearchProjection} from './storage';
import {safePublicPricing} from './safe-public-pricing';

/** Same admitted public specifications as card matching; never fabricate power or displacement. */
export function budgetSpecifications(input:CatalogSearchProjection){
 const row=safePublicPricing(input);
 return {bodyType:catalogBodyType(row),engineCc:row.engineCc,utilizationPowerKw:row.utilizationPowerKw,powertrainKind:row.powertrainKind,powerHp:row.powerHp,fuel:row.fuel};
}
export async function enrichBudgetSpecifications(index:BudgetCountIndex,read:(block:number)=>Promise<{generationId:string;items:CatalogSearchProjection[]}>){
 const rows=[...index.rows,...(index.otherRows||[])];
 const metadata=new Map<string,BudgetMetadata>();
 const wanted=new Map(rows.map(row=>[row[5].id,row[5]]));
 if(wanted.size!==rows.length)throw Error('budget_specification_duplicate_identity');
 const blocks=[...new Set(rows.map(row=>row[5].block))];let cursor=0;
 await Promise.all(Array.from({length:Math.min(6,blocks.length)},async()=>{
  while(cursor<blocks.length){
   const block=blocks[cursor++],part=await read(block);
   if(part.generationId!==index.generationId)throw Error('budget_specification_generation');
   for(const row of part.items){
    const previous=wanted.get(row.id);if(!previous)continue;
    if(previous.block!==block || metadata.has(row.id))throw Error('budget_specification_identity');
    metadata.set(row.id,{...previous,...budgetSpecifications(row)});
   }
  }
 }));
 if(metadata.size!==wanted.size)throw Error('budget_specification_incomplete');
 const attach=(row:BudgetCountIndex['rows'][number])=>{const next:typeof row=[...row];next[5]=metadata.get(row[5].id)!;return next;};
 return {...index,specificationFilterVersion:1 as const,bodyFilterVersion:1 as const,rows:index.rows.map(attach),otherRows:index.otherRows?.map(attach)};
}
