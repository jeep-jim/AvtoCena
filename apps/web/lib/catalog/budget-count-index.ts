import {deliveryPricingBasis,priceCardForCity,type DeliveryPricingBasis} from './card-city-delivery';
import {matchesJapanPreviewInput} from './japan-preview-inputs';
import {hasModificationSelection} from './modification-contract';
import type {CatalogSearchParams} from './types';
import type {CatalogSearchProjection} from './storage';
type JapanIdentity={id:string;updatedAt?:string;sourcePrice:number|null;sourceCurrency:string|null};
export type BudgetMetadata=Pick<CatalogSearchProjection,'id'|'make'|'model'|'year'|'bodyType'|'fuel'|'transmission'|'drive'|'sourceGroup'|'auctionDate'|'sourcePublishedAt'|'firstSeenAt'|'updatedAt'> & {block:number};
export type BudgetCountRow=[market:string,totalRub:number,basis:DeliveryPricingBasis|null,japan:JapanIdentity|null,seller:boolean,metadata:BudgetMetadata];
export type BudgetCountIndex={version:1;generationId:string;sourceRows:number;rows:BudgetCountRow[]};
/** Input must be the same admitted, prepared rows used by ordinary search. */
export function buildBudgetCountIndex(generationId:string,rows:CatalogSearchProjection[],blocks:Map<string,number>=new Map()):BudgetCountIndex {
 const compact:BudgetCountRow[]=[];
 for(const row of rows){
  if(hasModificationSelection(row))continue;
  const total=Number(row.totalRub||0);
  if(!(total>0)&&row.market!=='japan')continue;
  compact.push([row.market,total,deliveryPricingBasis(row.calculationSnapshot)||null,
   row.market==='japan'?{id:row.id,updatedAt:row.updatedAt,sourcePrice:row.sourcePrice??null,sourceCurrency:row.sourceCurrency??null}:null,row.catalogPricingMode==='seller', {id:row.id,make:row.make,model:row.model,year:row.year,bodyType:row.bodyType,fuel:row.fuel,transmission:row.transmission,drive:row.drive,sourceGroup:row.sourceGroup,auctionDate:row.auctionDate,sourcePublishedAt:row.sourcePublishedAt,firstSeenAt:row.firstSeenAt,updatedAt:row.updatedAt,block:blocks.get(row.id)??0}]);
 }
 return {version:1,generationId,sourceRows:rows.length,rows:compact};
}
export function matchingBudgetIndex(index:BudgetCountIndex,params:CatalogSearchParams,quotes:Record<string,any>={}) {
 const matching:BudgetCountRow[]=[];
 for(const row of index.rows){
  const [market,totalRub,basis,japan,seller]=row;
  if(params.market && params.market!=='any' && market!==params.market)continue;
  const candidate=japan?quotes[japan.id]:undefined;
  const preview=candidate&&japan&&matchesJapanPreviewInput(candidate,japan)?candidate:undefined;
  const offer={market,totalRub,catalogPricingMode:seller?'seller':undefined,calculationSnapshot:{deliveryPricingBasis:basis},japanDeliveredPreview:preview};
  const priced=params.city?priceCardForCity(offer,params.city).offer:offer;
  const price=Number(priced.japanDeliveredPreview?.totalRub||priced.totalRub||0);
  if(!(price>0)||(params.budgetFrom&&price<params.budgetFrom)||(params.budgetTo&&price>params.budgetTo))continue;
  matching.push(row);
 }
 return matching;
}
export function isBudgetCountQuery(params:CatalogSearchParams){
 return Boolean(params.budgetFrom||params.budgetTo)&&!Object.entries(params).some(([key,value])=>
  value!==undefined&&value!==''&&!['market','city','budgetFrom','budgetTo','sort','page','pageSize'].includes(key));
}

export function countBudgetIndex(index:BudgetCountIndex,params:CatalogSearchParams,quotes:Record<string,any>={}) {return matchingBudgetIndex(index,params,quotes).length;}
