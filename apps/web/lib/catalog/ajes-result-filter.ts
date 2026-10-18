import {AjesInputError} from './ajes-query';
import {priceCardForCity} from './card-city-delivery';
import {catalogBodyType} from './pickup-body';
import {hasModificationSelection} from './modification-contract';
const scalar=(v:unknown)=>String(Array.isArray(v)?v[0]??'':v??'').trim();
export function ajesResultFilter(params:Record<string,unknown>){
 const amount=(v:unknown)=>{const s=scalar(v);if(!s)return undefined;const n=Number(s);if(!Number.isSafeInteger(n)||n<0)throw new AjesInputError();return n;};
 const from=amount(params.budgetFrom),to=amount(params.budgetTo||params.budget);
 if(from!==undefined&&to!==undefined&&from>to)throw new AjesInputError();
 const body=scalar(params.bodyType||params.body),hasPrice=scalar(params.hasPrice),city=scalar(params.city);
 if(body&&!['suv','offroad','sedan','hatchback','wagon','minivan','coupe','convertible','pickup','van'].includes(body))throw new AjesInputError();
 if(hasPrice&&!['yes','no'].includes(hasPrice))throw new AjesInputError();
 const priceFilter=from!==undefined||to!==undefined||Boolean(hasPrice);
 return {active:priceFilter||Boolean(body),priceFilter,matches(offer:any){
  if(body&&catalogBodyType(offer).toLowerCase()!==body.toLowerCase())return false;
  if(!priceFilter)return true;
  const cityPrice=city?priceCardForCity(offer,city):null;
  const priced=cityPrice?.offer||offer;
  const preview=priced.savedCalculationPreview?null:priced.japanDeliveredPreview||priced.deliveredCalculationPreview;
  const total=cityPrice?Number(priced.japanDeliveredPreview?.totalRub||priced.totalRub||0):Number(preview?.totalRub||priced.totalRub||0);
  const complete=!hasModificationSelection(offer)&&total>0&&(!cityPrice||cityPrice.included)&&Boolean(preview||priced.savedCalculationPreview||priced.catalogPricingMode!=='seller');
  if(hasPrice&&(complete?'yes':'no')!==hasPrice)return false;
  if(from!==undefined||to!==undefined){if(!complete)return false;if(from!==undefined&&total<from)return false;if(to!==undefined&&total>to)return false;}
  return true;
 }};
}
