import type { CurrencyRateSnapshot } from './rates';
import type { VehicleOffer } from './types';
let cached: Promise<{sell:number;nominal:number;fetchedAt:string}|null> | undefined;
let expires = 0;
// Public quote used by Akebono itself; this is not a direct ATB API.
export async function greenCornerPaymentRate(offer:VehicleOffer):Promise<CurrencyRateSnapshot|null> {
 const now=Date.now();
 if (!process.env.CATALOG_LIVE_RATE_DISABLED && (!cached || now>=expires)) {
  expires=now+15*60_000;
  cached=fetch('https://akebono.world/graphql/directory/exchange-rate/open',{
   method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(5000),
   body:JSON.stringify({query:'query { exchangeRate(bank: ATB, currency: JPY) { sell nominal } }'})
  }).then(async response=>{
   if(!response.ok)return null;
   const value=await response.json(), quote=value.data?.exchangeRate;
   return !value.errors && Number(quote?.sell)>0 && Number(quote?.nominal)>0
    ? {sell:Number(quote.sell),nominal:Number(quote.nominal),fetchedAt:new Date().toISOString()} : null;
  }).catch(()=>null);
 }
 const quote=await cached || offer.greenCornerInvoice?.paymentQuote;
 if(!quote || !(quote.sell>0) || !(quote.nominal>0) || !Number.isFinite(Date.parse(quote.fetchedAt))
  || Math.abs(now-Date.parse(quote.fetchedAt))>4*86400000)return null;
 const effectiveRate=quote.sell/quote.nominal;
 return {currency:'JPY',cbrRate:quote.sell,nominal:quote.nominal,effectiveRate,rateDate:quote.fetchedAt,
  fetchedAt:quote.fetchedAt,rateSource:'atb_akebono',sourcePrice:offer.sourcePrice,sourcePriceRub:Math.round(offer.sourcePrice*effectiveRate*100)/100};
}
