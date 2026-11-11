import assert from 'node:assert/strict';
import {applyActiveBusinessPriceBatch} from '../apps/web/lib/catalog/live-business-pricing.ts';
import {attachJapanSearchValues} from '../apps/web/lib/catalog/japan-delivered-preview.ts';
import {performance} from 'node:perf_hooks';
import {backfillCatalogBudgetCountIndex,countCatalogOffers,searchOffers,searchOffersWithoutBudgetIndexForTests,readCatalogFacets,resetCatalogReadCachesForTests} from '../apps/web/lib/catalog/storage.ts';
import {mutateDataJson} from '../apps/web/lib/data.ts';
import {withCatalogReadModelRepairLock} from './lib/catalog-read-model-repair-lock.mjs';
try {
await withCatalogReadModelRepairLock(mutateDataJson, async () => {
process.env.CATALOG_STORAGE_PREFLIGHT_MODE='budget-index';
await import('./catalog-storage-preflight.mjs');
console.log(JSON.stringify(await backfillCatalogBudgetCountIndex()));
for(const city of ['', 'Новокузнецк'])for(const budgetTo of [1500000,2000000]){
 resetCatalogReadCachesForTests();
 const params={city,budgetTo,pageSize:5},start=performance.now();
 const count=await countCatalogOffers(params);
 console.log(JSON.stringify({phase:'compact-count',city,budgetTo,ms:Math.round(performance.now()-start),...count}));
 const before=performance.now();
 const results=await Promise.all(['japan','korea','china','europe','uae','georgia'].map(async market=>({market,fast:await searchOffers({...params,market})})));
 await readCatalogFacets(params);
 console.log(JSON.stringify({phase:'budget-results-with-facets',city,budgetTo,ms:Math.round(performance.now()-before)}));
 const baseline=await searchOffersWithoutBudgetIndexForTests(params);assert.equal(count.total,baseline.total);
 for(const {market,fast} of results){const old=await searchOffersWithoutBudgetIndexForTests({...params,market});assert.equal(fast.total,old.total,market);assert.deepEqual(fast.items.map(row=>row.id),old.items.map(row=>row.id),market+' exact page parity');const current=await attachJapanSearchValues(await applyActiveBusinessPriceBatch(fast.items,{readOnly:true}),fast.generationId);assert.deepEqual(current.map(row=>row.totalRub),old.items.map(row=>row.totalRub),market+' exact current price parity');}
 console.log(JSON.stringify({phase:'exact-parity-passed',city,budgetTo}));
}

});
} catch(error) {
 if(error?.message !== 'catalog_read_model_repair_publication_locked')throw error;
 console.log(JSON.stringify({status:'deferred',reason:'catalog_writer_busy',indexPrepared:false}));
}
