import {isOwnerStepwgnNonHybrid} from './japan-owner-specifications';
import {matchesCatalogColor} from './catalog-color-index';
import {filterSelections,matchesFilterSelection} from './filter-selections';
import {AjesInputError} from './ajes-query';
import {priceCardForCity} from './card-city-delivery';
import {catalogBodyType} from './pickup-body';
import {hasModificationSelection} from './modification-contract';
const scalar=(v:unknown)=>String(Array.isArray(v)?v[0]??'':v??'').trim();
export function ajesResultFilter(params:Record<string,unknown>){
 const amount=(v:unknown)=>{const s=scalar(v);if(!s)return undefined;const n=Number(s);if(!Number.isSafeInteger(n)||n<0)throw new AjesInputError();return n;};
 const from=amount(params.budgetFrom),to=amount(params.budgetTo||params.budget);
 if(from!==undefined&&to!==undefined&&from>to)throw new AjesInputError();
 const powerFrom=amount(params.powerFrom),powerTo=amount(params.powerTo);
 if(powerFrom!==undefined&&powerTo!==undefined&&powerFrom>powerTo)throw new AjesInputError();
 const powerFilter=powerFrom!==undefined||powerTo!==undefined;
 const drive=scalar(params.drive),japanDrive=params.market==='japan'&&Boolean(drive);
 const fuel=scalar(params.fuel),japanFuel=params.market==='japan'&&Boolean(fuel);
 const body=scalar(params.bodyType||params.body),hasPrice=scalar(params.hasPrice),city=scalar(params.city);
 if(filterSelections(body).some(value=>!['suv','offroad','sedan','hatchback','wagon','minivan','coupe','convertible','pickup','van'].includes(value)))throw new AjesInputError();
 if(hasPrice&&!['yes','no'].includes(hasPrice))throw new AjesInputError();
 const priceFilter=from!==undefined||to!==undefined||Boolean(hasPrice);
 const matchesPower=(offer:any)=>{
  if(!powerFilter)return true;
  const exact=isOwnerStepwgnNonHybrid(offer)?150:Number(offer.powerHp);
  // Supplier PW is not a vehicle specification. Only the locally enriched,
  // trusted encyclopedia value (or the explicit owner override) can qualify.
  return Number.isFinite(exact)&&exact>0&&(powerFrom===undefined||exact>=powerFrom)&&(powerTo===undefined||exact<=powerTo);
 };
 return {active:priceFilter||Boolean(body)||powerFilter||Boolean(params.color)||japanDrive||japanFuel,priceFilter,powerFilter,matchesPower,matches(offer:any){
  if(japanFuel&&!matchesFilterSelection(offer.fuel,fuel==='electrified'?'hybrid|electric':fuel.replaceAll('electrified','hybrid|electric')))return false;
  if(japanDrive&&!matchesFilterSelection(offer.drive,drive))return false;
  if(!matchesCatalogColor(offer,scalar(params.color)))return false;
  if(!matchesPower(offer))return false;
  if(!matchesFilterSelection(catalogBodyType(offer),body))return false;
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
