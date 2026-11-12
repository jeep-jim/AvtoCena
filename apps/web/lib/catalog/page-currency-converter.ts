import type {CurrencyRateSnapshot} from './rates';

type Convert = (price:number|null,currency:string|null)=>Promise<CurrencyRateSnapshot|null>;

/** One official quote per currency in one source page, never a cross-request cache.
 * Preserve the quote's provenance and round each seller amount independently.
 */
export function pageCurrencyConverter(convert:Convert):Convert {
 const quotes=new Map<string,Promise<CurrencyRateSnapshot|null>>();
 return async(price,currency)=>{
  if(!price||!currency)return null;
  const code=currency.toUpperCase().trim();
  let pending=quotes.get(code);
  if(!pending){pending=convert(1,code);quotes.set(code,pending);}
  const quote=await pending;
  return quote?{...quote,sourcePrice:price,sourcePriceRub:Math.round(price*quote.effectiveRate)}:null;
 };
}
