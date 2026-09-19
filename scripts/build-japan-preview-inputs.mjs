// Derived read cache only. Never edits offers, prices, sources or the manifest.
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {readDataJson,getJsonStorage} from '../apps/web/lib/data.ts';
import {readMarketOffers} from '../apps/web/lib/catalog/storage.ts';
import {buildJapanPreviewInputIndex,japanPreviewInputPath} from '../apps/web/lib/catalog/japan-preview-inputs.ts';
import {japanPreviewParameters} from '../apps/web/lib/catalog/japan-preview-parameters.ts';
import {calculateOfferWithCustomerParametersDetailed} from '../apps/web/lib/catalog/customs-pricing.ts';
const start=performance.now();
const before=await readDataJson('catalog/manifest.json',null);
assert.ok(before?.generationId && before.markets?.japan?.count,'Japan public generation required');
const offers=await readMarketOffers('japan');
assert.equal(offers.length,before.markets.japan.count,'complete immutable Japanese market required');
const index=buildJapanPreviewInputIndex(before.generationId,offers);
let cursor=0,matched=0,unavailable=0,invalid=0;
await Promise.all(Array.from({length:4},async()=>{while(cursor<offers.length){
 const offer=offers[cursor++],entry=index.entries[offer.id];if(!entry)continue;
 if(!entry.parameters){assert.throws(()=>japanPreviewParameters(offer));invalid++;continue;}
 const full=await calculateOfferWithCustomerParametersDetailed(offer,japanPreviewParameters(offer));
 const compact=await calculateOfferWithCustomerParametersDetailed(entry.offer,entry.parameters);
 assert.deepEqual(compact,full,`preview parity: ${offer.id}`);
 if(full.ok)matched++;else unavailable++;
}}));
const after=await readDataJson('catalog/manifest.json',null);
assert.equal(after.generationId,before.generationId,'publication changed during cache preparation; rerun safely');
const bytes=Buffer.byteLength(JSON.stringify(index));assert.ok(bytes<16*1024*1024,'bounded runtime input index');
if(process.argv.includes('--publish'))await getJsonStorage().writeJson(japanPreviewInputPath(index.generationId),index);
console.log(JSON.stringify({generationId:index.generationId,offers:offers.length,inputs:Object.keys(index.entries).length,matched,unavailable,invalid,bytes,ms:Math.round(performance.now()-start),published:process.argv.includes('--publish')}));
