import {applyEncyclopediaCalculation} from '../encyclopedia/calculation-index';
import {applyUaeManualSpecifications} from './uae-manual-specifications';
import {catalogBodyType} from './pickup-body';
import type {BudgetCountIndex, BudgetMetadata} from './budget-count-index';
import type {CatalogSearchProjection} from './storage';
import {catalogDisplayPrice} from './display-order';
import {calculatedCatalogPrice} from './calculated-price';
import {safePublicPricing} from './safe-public-pricing';
import {budgetCardGroups,assertBudgetSupplementCardContext,assertBudgetSupplementCard,type BudgetCardPart} from './budget-card-reference';

/** Same admitted public specifications as card matching; never fabricate power or displacement. */
export function budgetSpecifications(input:CatalogSearchProjection){
 const row:CatalogSearchProjection & {engineCode?:string;chassisCode?:string}=safePublicPricing(applyEncyclopediaCalculation(applyUaeManualSpecifications(input)));
 return {displayOrderPriceRub:catalogDisplayPrice(row),displayOrderCalculated:calculatedCatalogPrice(row)>0,trim:row.trim,engineCode:row.engineCode,chassisCode:row.chassisCode,drive:row.drive,transmission:row.transmission,bodyType:catalogBodyType(row),engineCc:row.engineCc,utilizationPowerKw:row.utilizationPowerKw,powertrainKind:row.powertrainKind,powerHp:row.powerHp,fuel:row.fuel};
}
export async function enrichBudgetSpecifications(index:BudgetCountIndex,read:(block:number,path?:string)=>Promise<BudgetCardPart>){
 const rows=[...index.rows,...(index.otherRows||[])];
 const metadata=new Map<string,BudgetMetadata>();
 const wanted=new Map(rows.map(row=>[row[5].id,row[5]]));
 if(wanted.size!==rows.length)throw Error('budget_specification_duplicate_identity');
 const groups=budgetCardGroups(rows,index.version);let cursor=0;
 await Promise.all(Array.from({length:Math.min(6,groups.length)},async()=>{
  while(cursor<groups.length){
   const group=groups[cursor++],block=group.block;
   assertBudgetSupplementCardContext(group);
   const part=await read(block,group.path);
   if(part.generationId!==index.generationId)throw Error('budget_specification_generation');
   assertBudgetSupplementCard(group,part,index.generationId);
   const ids=new Set(group.rows.map(row=>row[5].id));
   for(const row of part.items){
    const previous=wanted.get(row.id);if(!previous||!ids.has(row.id))continue;
    if(previous.block!==block || metadata.has(row.id))throw Error('budget_specification_identity');
    metadata.set(row.id,{...previous,...budgetSpecifications(row)});
   }
  }
 }));
 if(metadata.size!==wanted.size)throw Error('budget_specification_incomplete');
 const attach=(row:BudgetCountIndex['rows'][number])=>{const next:typeof row=[...row];next[5]=metadata.get(row[5].id)!;return next;};
 return {...index,displayOrderVersion:1 as const,specificationFilterVersion:1 as const,bodyFilterVersion:1 as const,rows:index.rows.map(attach),otherRows:index.otherRows?.map(attach)};
}
