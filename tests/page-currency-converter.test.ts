import test from 'node:test';
import assert from 'node:assert/strict';
import {pageCurrencyConverter} from '../apps/web/lib/catalog/page-currency-converter';
import type {CurrencyRateSnapshot} from '../apps/web/lib/catalog/rates';

test('24 simultaneous prices share one quote, preserving nominal, provenance and rounding',async()=>{
 let reads=0;
 const quote:CurrencyRateSnapshot={currency:'JPY',cbrRate:54.73,nominal:100,effectiveRate:.5473,rateDate:'2026-11-12',rateSource:'cbr',sourcePrice:1,sourcePriceRub:1};
 const convert=pageCurrencyConverter(async()=>{reads++;await Promise.resolve();return quote;});
 const prices=Array.from({length:24},(_,i)=>100001+i);
 const results=await Promise.all(prices.map(price=>convert(price,'jpy')));
 assert.equal(reads,1);
 results.forEach((result,i)=>assert.deepEqual(result,{...quote,sourcePrice:prices[i],sourcePriceRub:Math.round(prices[i]*.5473)}));
 results[0]!.sourcePrice=0;assert.equal(results[1]!.sourcePrice,prices[1]);assert.equal(quote.sourcePrice,1);
});
test('currency and page boundaries never reuse a different or old quote',async()=>{
 let reads=0,rate=2;
 const read=async(_:number|null,currency:string|null)=>{reads++;return {currency:currency!,cbrRate:rate,nominal:1,effectiveRate:rate,rateDate:'2026-11-12',rateSource:'cbr' as const,sourcePrice:1,sourcePriceRub:rate};};
 const page=pageCurrencyConverter(read);await page(3,'JPY');await page(3,'KRW');assert.equal(reads,2);
 rate=4;assert.equal((await pageCurrencyConverter(read)(3,'JPY'))!.sourcePriceRub,12);assert.equal(reads,3);
});
test('unknown and failed rates remain unknown or failed; zero prices do not read',async()=>{
 let reads=0;const missing=pageCurrencyConverter(async()=>{reads++;return null;});
 assert.equal(await missing(0,'JPY'),null);assert.equal(reads,0);
 assert.equal(await missing(1,'JPY'),null);assert.equal(await missing(2,'JPY'),null);assert.equal(reads,1);
 const failed=pageCurrencyConverter(async()=>{throw Error('rate_unavailable');});
 await assert.rejects(failed(2,'JPY'),/rate_unavailable/);
});
