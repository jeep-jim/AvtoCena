import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {backfillCatalogBudgetCountIndex,countCatalogOffers,searchOffers,searchOffersWithoutBudgetIndexForTests,readCatalogFacets,resetCatalogReadCachesForTests} from '../apps/web/lib/catalog/storage.ts';
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
 for(const {market,fast} of results){const old=await searchOffersWithoutBudgetIndexForTests({...params,market});assert.equal(fast.total,old.total,market);assert.deepEqual(fast.items,old.items,market+' exact card parity');}
 console.log(JSON.stringify({phase:'exact-parity-passed',city,budgetTo}));
}
