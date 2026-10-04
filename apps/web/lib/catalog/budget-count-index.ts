import {includedDepositCost} from "./deposit-cost-projection";
import {isReviewedSourceDuplicate} from './reviewed-source-duplicates';
import {deliveryPricingBasis,priceCardForCity,type DeliveryPricingBasis} from './card-city-delivery';
import {matchesJapanPreviewInput} from './japan-preview-inputs';
import {hasModificationSelection} from './modification-contract';
import type {CatalogSearchParams} from './types';
import type {CatalogSearchProjection} from './storage';
type JapanIdentity={id:string;updatedAt?:string;sourcePrice:number|null;sourceCurrency:string|null};
export type BudgetMetadata=Pick<CatalogSearchProjection,'id'|'make'|'model'|'year'|'mileageKm'|'bodyType'|'fuel'|'transmission'|'drive'|'sourceGroup'|'auctionDate'|'sourcePublishedAt'|'firstSeenAt'|'updatedAt'> & {block:number};
export type BudgetCountRow=[market:string,totalRub:number,basis:DeliveryPricingBasis|null,japan:JapanIdentity|null,seller:boolean,metadata:BudgetMetadata,depositCostRub?:number,replay?:Partial<CatalogSearchProjection>];
export type BudgetCountIndex={version:1|2|3;filterVersion?:1;generationId:string;sourceRows:number;rows:BudgetCountRow[];otherRows?:BudgetCountRow[]};
/** Price-only inputs: no photographs, full ledger, descriptions or raw source data. */
export function budgetPriceReplay(row:CatalogSearchProjection):Partial<CatalogSearchProjection>|undefined {
 if(row.market==='japan' || hasModificationSelection(row) || !(Number(row.totalRub)>0))return undefined;
 const keys=['sourcePrice','sourceCurrency','chinaPriceConversion','priceMode','calculationStatus','engineCc','powerHp','powerKw','icePowerKw','power30MinKw','power30MinKwByMotor','utilizationPowerKw','powertrainKind','powerDataSource','transportToBorderRub','productionDate','productionMonth','productionYear','vehicleCategory','tnVedCode','grossVehicleWeightKg','n1IceFuel','personalUseEligible','cardProjectionVersion','publicSpecificationVerified'];
 const replay:any=Object.fromEntries(keys.filter(key=>(row as any)[key]!==undefined).map(key=>[key,(row as any)[key]]));
 const snapshot=row.calculationSnapshot;
 // The shared engine consumes inputs and the attested customs gate. Historical
 // FX metadata, explanations and delivered-price ledgers are not replay inputs.
 replay.calculationSnapshot=snapshot?.customsInput ? {
  customsInput:snapshot.customsInput,
  customs:snapshot.customs ? Object.fromEntries(['status','totalCustomsRub','knownCustomsRub','utilizationFeeRub','ageEstimated','productionReferenceDate'].filter(key=>(snapshot.customs as any)[key]!==undefined).map(key=>[key,(snapshot.customs as any)[key]])) : undefined,
  sourcePriceRub:snapshot.sourcePriceRub,
  missing:snapshot.missing?.length?snapshot.missing:undefined,
  priceIncludesAllCustoms:snapshot.priceIncludesAllCustoms,
  priceIncludesUtilizationFee:snapshot.priceIncludesUtilizationFee,
  depositCostRub:snapshot.depositCostRub,
  sourcePriceAdjustment:snapshot.sourcePriceAdjustment ? {policy:snapshot.sourcePriceAdjustment.policy}:undefined,
 } : snapshot;
 return replay;
}
export function budgetReplayOffer(row:BudgetCountRow):CatalogSearchProjection {
 return {...row[5],...row[7],market:row[0],totalRub:row[1],publicVisibleRub:row[1],catalogPricingMode:row[4]?'seller':undefined} as CatalogSearchProjection;
}
/** Input must be the same admitted, prepared rows used by ordinary search. */
export function buildBudgetCountIndex(generationId:string,rows:CatalogSearchProjection[],blocks:Map<string,number>=new Map(),version:2|3=2):BudgetCountIndex {
 const compact:BudgetCountRow[]=[],otherRows:BudgetCountRow[]=[];
 for(const row of rows){
  if(isReviewedSourceDuplicate(row))continue;
  const total=Number(row.totalRub||0);
  const target=hasModificationSelection(row)||(!(total>0)&&row.market!=='japan')?otherRows:compact;
  target.push([row.market,total,deliveryPricingBasis(row.calculationSnapshot)||null,
   row.market==='japan'?{id:row.id,updatedAt:row.updatedAt,sourcePrice:row.sourcePrice??null,sourceCurrency:row.sourceCurrency??null}:null,row.catalogPricingMode==='seller', {id:row.id,make:row.make,model:row.model,year:row.year,mileageKm:row.mileageKm,bodyType:row.bodyType,fuel:row.fuel,transmission:row.transmission,drive:row.drive,sourceGroup:row.sourceGroup,auctionDate:row.auctionDate,sourcePublishedAt:row.sourcePublishedAt,firstSeenAt:row.firstSeenAt,updatedAt:row.updatedAt,block:blocks.get(row.id)??0},includedDepositCost(row.calculationSnapshot),version===3 ? budgetPriceReplay(row) : undefined]);
 }
 return {version,filterVersion:1,generationId,sourceRows:rows.length,rows:compact,otherRows};
}
export function matchingBudgetIndex(index:BudgetCountIndex,params:CatalogSearchParams,quotes:Record<string,any>={}) {
 const matching:BudgetCountRow[]=[];
 for(const row of index.rows){
  const [market,totalRub,basis,japan,seller]=row;
  if(isReviewedSourceDuplicate({market,id:row[5].id}))continue;
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
