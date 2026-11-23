import assert from 'node:assert/strict';
import {applyActiveBusinessPriceBatch} from '../apps/web/lib/catalog/live-business-pricing.ts';
import {attachJapanSearchValues} from '../apps/web/lib/catalog/japan-delivered-preview.ts';
import {performance} from 'node:perf_hooks';
import {backfillCatalogBudgetCountIndex,inspectBudgetMarketSelectors,countCatalogOffers,searchOffers,searchOffersWithoutBudgetIndexForTests,readCatalogFacets,resetCatalogReadCachesForTests} from '../apps/web/lib/catalog/storage.ts';
import fs from 'node:fs/promises';
import path from 'node:path';
import {canReusePublishedBudget} from './lib/published-budget-index.mjs';
import {readLiveBudgetIdentity} from './lib/catalog-staged-budget.mjs';
import {restoreReleaseEncyclopedia} from './encyclopedia/restore-calculation-index.mjs';
import {getJsonStorage, mutateDataJson} from '../apps/web/lib/data.ts';
import {withCatalogReadModelRepairLock} from './lib/catalog-read-model-repair-lock.mjs';
async function publishedReceipt() {
  const match = /^Catalog refresh (china|korea|uae|georgia|europe)$/.exec(process.env.BUDGET_PRODUCER_WORKFLOW || '');
  if (!match) return null;
  const market = match[1];
  const file = path.join(process.env.RUNNER_TEMP, 'producer-budget', 'catalog-quality-rebuild-reports-' + market,
    'catalog-staged-budget-report.json');
  let report;
  try { report = JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  const storage = getJsonStorage();
  const manifest = await storage.readJsonWithMeta('catalog/manifest.json', null);
  if (!manifest.found || !manifest.etag || !/^gen_[0-9]+_[a-z0-9]+$/.test(manifest.value?.generationId || '')
      || report.generationId !== manifest.value.generationId) return null;
  const identity = await readLiveBudgetIdentity();
  if (identity.release !== report.release || identity.calculationVersion !== report.calculationVersion) return null;
  const key = 'catalog/generations/' + report.generationId + '/indexes/budget-count-v3.json';
  const [encyclopediaDigest, selectors, rootPresent] = await Promise.all([
    restoreReleaseEncyclopedia(storage, process.cwd(), identity.release),
    inspectBudgetMarketSelectors(), storage.exists(key),
  ]);
  if (!canReusePublishedBudget({report, identity, encyclopediaDigest, selectors, manifest:manifest.value, rootPresent})) return null;
  return {generationId:report.generationId, etag:manifest.etag, identity};
}

async function verifyParity() {
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
}

const published = await publishedReceipt();
if (published) {
  console.log(JSON.stringify({phase:'reuse-published-index',generationId:published.generationId}));
  await verifyParity();
  const [current, identity] = await Promise.all([
    getJsonStorage().readJsonWithMeta('catalog/manifest.json', null), readLiveBudgetIdentity(),
  ]);
  if (current.etag !== published.etag || current.value?.generationId !== published.generationId
      || identity.release !== published.identity.release || identity.calculationVersion !== published.identity.calculationVersion) {
    throw Error('budget_parity_publication_changed');
  }
} else {
  try {
    await withCatalogReadModelRepairLock(mutateDataJson, async () => {
      process.env.CATALOG_STORAGE_PREFLIGHT_MODE = 'budget-index';
      await import('./catalog-storage-preflight.mjs');
      console.log(JSON.stringify(await backfillCatalogBudgetCountIndex()));
      await verifyParity();
    });
  } catch (error) {
    if (error?.message !== 'catalog_read_model_repair_publication_locked') throw error;
    console.log(JSON.stringify({status:'deferred',reason:'catalog_writer_busy',indexPrepared:false}));
  }
}
