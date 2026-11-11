import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

test('dealer manual quotes overlap, remain bounded to four, and retain offer order',async()=>{
 const dir=path.resolve('artifacts/selection-performance');fs.mkdirSync(dir,{recursive:true});
 const mocks:Record<string,string>={
  '../autocalc/scenario':'export function autocalcScenario(o){return {offer:o,parameters:{}}}',
  './market-offer':'export function marketOfferKey(o){return o.id};export function marketRequest(o){return o}',
  '../catalog/customs-pricing':`export function customerCalculationFailureMessage(){return 'error'};export async function calculateCustomerParameterScenario(o){const g=globalThis.__quoteProbe;g.active++;g.peak=Math.max(g.peak,g.active);await new Promise(r=>setTimeout(r,30));g.active--;return {totalRub:100,calculationSnapshot:{customs:{status:'ready',knownCustomsRub:1,utilizationFeeRub:2},priceIncludesAllCustoms:true,sourcePriceRub:Number(o.id),currencyRate:{effectiveRate:1}}}}`,
 };
 await build({entryPoints:['apps/web/lib/dealers/market-offer-server.ts'],outfile:dir+'/quotes.cjs',bundle:true,platform:'node',format:'cjs',packages:'external',plugins:[{name:'probe',setup(b){b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'probe'}:undefined);b.onLoad({filter:/.*/,namespace:'probe'},a=>({contents:mocks[a.path]}));}}]});
 const g=globalThis as any;g.__quoteProbe={active:0,peak:0};
 try{
  const {withMarketQuotes}=createRequire(import.meta.url)(dir+'/quotes.cjs');
  const offers=Array.from({length:9},(_,i)=>({id:String(i+1),availability:'market',invoice:100,purchaseTotal:100,market:'china'}));
  const result=await withMarketQuotes({offers,pricing:{baseCity:'Москва'}});
  assert.equal(g.__quoteProbe.peak,4);assert.equal(g.__quoteProbe.active,0);
  assert.deepEqual(result.offers.map((o:any)=>o.id),offers.map(o=>o.id));
  assert.deepEqual(result.offers.map((o:any)=>o.marketQuote.input.sourcePriceRub),offers.map(o=>Number(o.id)));
 }finally{delete g.__quoteProbe;}
});
