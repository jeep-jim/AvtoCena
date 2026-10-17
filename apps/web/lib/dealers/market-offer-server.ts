import {DetailReadCache} from '../catalog/detail-read-cache';
import {autocalcScenario} from '../autocalc/scenario';
import {calculateCustomerParameterScenario,customerCalculationFailureMessage} from '../catalog/customs-pricing';
import {marketOfferKey,marketRequest,type MarketQuote} from './market-offer';
import type {DealerShowcase,SpecialOffer} from './showcase-model';
const cache=new DetailReadCache<MarketQuote>({maxEntries:400,maxBytes:4*1024*1024,ttlMs:60000,concurrency:4});
export function quoteMarketOffer(o:SpecialOffer,city=''):Promise<MarketQuote>{return cache.get(JSON.stringify([marketOfferKey(o),o.make,o.model,city,new Date().toISOString().slice(0,10)]),()=>calculate(o,city));}
async function calculate(o:SpecialOffer,city=''):Promise<MarketQuote>{
 const base={key:marketOfferKey(o),at:new Date().toISOString(),rate:0};
 try{
  if(!(Number(o.invoice)>0)||!(Number(o.purchaseTotal)>=Number(o.invoice)))throw Error('Сумма с расходами должна быть не меньше инвойса');
  const {offer,parameters}=autocalcScenario(marketRequest(o,city));
  const result=await calculateCustomerParameterScenario(offer,parameters),s=result.calculationSnapshot;
  if(!result.totalRub||s?.customs?.status!=='ready'||!s.priceIncludesAllCustoms)throw Error(customerCalculationFailureMessage(s?.missing||s?.customs?.missing||[]));
  return {...base,rate:Number(s.currencyRate?.effectiveRate||0),input:{marketId:o.market!,marketConfig:s.marketConfig,sourcePriceRub:s.sourcePriceRub,customsRub:s.customs.knownCustomsRub,utilizationFeeRub:s.customs.utilizationFeeRub}};
 }catch(e){return {...base,error:e instanceof Error?e.message:'Не удалось рассчитать автомобиль'};}
}
export async function withMarketQuotes(s:DealerShowcase){
 // quoteMarketOffer already bounds calculation concurrency to four.
 const offers=await Promise.all(s.offers.map(async o=>o.availability==='market'?{...o,marketQuote:await quoteMarketOffer(o,o.defaultCity||s.pricing.baseCity)}:o));
 return {...s,offers};
}
