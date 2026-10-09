import {createHash} from 'node:crypto';
import {mutateDataJson,readDataJson} from '../data';
import {convertToRub,type CurrencyRateSnapshot} from './rates';
import {DetailReadCache} from './detail-read-cache';
import type {VehicleOffer} from './types';

export type ChinaPriceConversion={sourceCurrency:'USD';sourcePrice:number;sourcePriceCny:number;usdRub:number;cnyRub:number;rateDate:string};
type Index={version:1;entries:Record<string,ChinaPriceConversion>};
const path='catalog/china-cny-prices/current.json';
const cache=new DetailReadCache<Index>({maxEntries:1,maxBytes:16*1024*1024,ttlMs:60000,concurrency:1});
const fresh=(rate:CurrencyRateSnapshot|null)=>rate && ['cbr','cbr_live'].includes(rate.rateSource) && rate.effectiveRate>0 && Math.abs(Date.now()-Date.parse(rate.rateDate))<=4*86400000;
export function chinaCnyConversion(price:number,usd:CurrencyRateSnapshot|null,cny:CurrencyRateSnapshot|null):ChinaPriceConversion|null {
 if(!Number.isFinite(price)||price<=0||!fresh(usd)||!fresh(cny)||usd!.rateDate!==cny!.rateDate)return null;
 return {sourceCurrency:'USD',sourcePrice:price,sourcePriceCny:price*usd!.effectiveRate/cny!.effectiveRate,usdRub:usd!.effectiveRate,cnyRub:cny!.effectiveRate,rateDate:usd!.rateDate};
}
function key(offer:Partial<VehicleOffer>){return createHash('sha256').update(JSON.stringify([offer.id,offer.sourcePrice])).digest('hex');}
function eligible(offer:Partial<VehicleOffer>){return offer.market==='china' && offer.sourceCurrency==='USD' && Number(offer.sourcePrice)>0 && Boolean(offer.id);}
/** Lock the CNY equivalent once per source price. Subsequent FX changes use CNY,
 * not a daily USD->CNY round trip. Original API amounts remain in raw evidence.
 * Batch storage avoids a separate object read/write for every catalog card.
 */
export async function withChinaCnyPrices<T extends Partial<VehicleOffer>>(offers:T[],options:{readOnly?:boolean}={}):Promise<T[]> {
 const candidates=offers.filter(eligible);if(!candidates.length)return offers;
 let index=await cache.get('current',()=>readDataJson<Index>(path,{version:1,entries:{}}));
 let transient:Index['entries']={};
 const missing=candidates.filter(offer=>!index.entries[key(offer)]);
 if(missing.length){
  const [usd,cny]=await Promise.all([convertToRub(1,'USD'),convertToRub(1,'CNY')]);
  const added:Index['entries']={};
  for(const offer of missing){const conversion=chinaCnyConversion(Number(offer.sourcePrice),usd,cny);if(conversion)added[key(offer)]=conversion;}
  if(Object.keys(added).length){
   // Search replays small batches against a large shared index. Keep only the
   // new batch entries rather than copying every saved price for every batch.
   // Persisted anchors still win; the shared snapshot is never mutated.
   if(options.readOnly)transient=added;
   else {index=await mutateDataJson<Index>(path,{version:1,entries:{}},current=>({version:1,entries:{...added,...current.entries}}));cache.clear();}
  }
 }
 return offers.map(offer=>{
  const priceKey=eligible(offer)?key(offer):undefined;
  const conversion=priceKey ? index.entries[priceKey] || transient[priceKey] : undefined;
  return conversion?{...offer,sourceCurrency:'CNY',sourcePrice:conversion.sourcePriceCny,chinaPriceConversion:conversion}:offer;
 });
}
export async function withChinaCnyPrice<T extends Partial<VehicleOffer>>(offer:T):Promise<T>{return (await withChinaCnyPrices([offer]))[0];}
