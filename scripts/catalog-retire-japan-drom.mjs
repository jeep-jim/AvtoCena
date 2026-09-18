import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {planJapanDromRetirement,assertExactRetirementPreservation,hashRetirementRows,retiredJapanSource} from './lib/japan-drom-retirement.mjs';
const {readManifest,readMarketOffers,persistCatalogOffers}=await import('../apps/web/lib/catalog/storage.ts');
const {mutateDataJson}=await import('../apps/web/lib/data.ts');
const {PUBLIC_CATALOG_MARKETS}=await import('../apps/web/lib/catalog/runtime-config.ts');
const {assertNoDeliveredPriceRegression}=await import('../apps/web/lib/catalog/publication-price-preservation.ts');
const {japanAuctionSoldPriceVerified,japanAuctionSoldIdentityVerified}=await import('../apps/web/lib/catalog/public-priority.ts');
const {hasAllowedCatalogSourceProvenance}=await import('../apps/web/lib/catalog/offer-quality.ts');
const config=JSON.parse(await fs.readFile('.github/market-runs/japan-retire-drom.json','utf8'));
if(config.market!=='japan'||config.removeSource!==retiredJapanSource||config.publish!==true)throw Error('invalid_retirement_scope');
const lockPath='catalog/import-lock.json',operationId=`japan-retire-drom-${randomUUID()}`;
// Lease exceeds the workflow's 40-minute hard limit. Never steal a live writer.
await mutateDataJson(lockPath,{lockedUntil:''},current=>{
 if(Date.parse(current.lockedUntil||'')>Date.now())throw Error('catalog_retirement_publication_locked');
 return {operationId,operationType:'japan_retire_drom',startedAt:new Date().toISOString(),lockedUntil:new Date(Date.now()+45*60000).toISOString()};
});
try {
 const previous=await readManifest();
 if(previous.generationId!==config.expectedGeneration)throw Error(`retirement_generation_changed:${previous.generationId}`);
 const all=[];const preserved={};const beforeCounts={};
 for(const market of PUBLIC_CATALOG_MARKETS){
  const rows=await readMarketOffers(market); beforeCounts[market]=rows.length;
  if(rows.length!==previous.markets[market].count)throw Error(`incomplete_market_read:${market}`);
  all.push(...rows);if(market!=='japan')preserved[market]=rows;
 }
 const japan=all.filter(r=>r.market==='japan');const plan=planJapanDromRetirement(japan);
 if(plan.removed.length!==config.expectedRemoved || plan.kept.length!==config.expectedKept)throw Error('retirement_count_changed');
 const verified=plan.kept.filter(r=>r.sourceId==='proauctions_japan_stat');
 const invalid=verified.filter(r=>!hasAllowedCatalogSourceProvenance(r)||!japanAuctionSoldPriceVerified(r)||!japanAuctionSoldIdentityVerified(r)||new Set((r.images||[]).map(i=>i.url||i.objectKey)).size<2);
 if(invalid.length)throw Error(`replacement_audit_failed:${invalid.length}:${invalid.slice(0,5).map(r=>r.id)}`);
 const expected=all.filter(r=>!(r.market==='japan'&&r.sourceId===retiredJapanSource));
 const validate=rows=>{
  assertExactRetirementPreservation(expected,rows);
  assertNoDeliveredPriceRegression(all,rows,{auditedRemovals:plan.removals});
 };
 validate(expected);
 const report={operationId,previousGeneration:previous.generationId,published:false,removed:plan.removed.map(r=>({id:r.id,sourceId:r.sourceId,reason:plan.removals.get(r.id)})),keptJapan:plan.kept.length,verifiedProAuctions:verified.length,sampleProAuctions:verified.slice(0,5).map(r=>({id:r.id,title:r.title,images:r.images.slice(0,2).map(i=>i.url)})),sampleRemoved:plan.removed.slice(0,3).map(r=>r.id),beforeCounts,preservedHashes:Object.fromEntries(Object.entries(preserved).map(([m,r])=>[m,hashRetirementRows(r)]))};
 await fs.writeFile('japan-drom-retirement.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify({stage:'retirement_preflight_pass',removed:plan.removed.length,keptJapan:plan.kept.length,verifiedProAuctions:verified.length,beforeCounts}));
 const manifest=await persistCatalogOffers(expected,{productionRefreshMarket:'japan',appendPublicOffersByMarket:{japan:plan.kept},preservePublicOffersByMarket:preserved,replaceInternalSourceIds:new Set([retiredJapanSource]),beforePersistValidate:validate,beforePublishValidate:validate});
 const after=[];for(const market of PUBLIC_CATALOG_MARKETS)after.push(...await readMarketOffers(market));
 validate(after);
 Object.assign(report,{published:true,generationId:manifest.generationId,afterCounts:Object.fromEntries(PUBLIC_CATALOG_MARKETS.map(m=>[m,after.filter(r=>r.market===m).length])),verifiedAt:new Date().toISOString()});
 await fs.writeFile('japan-drom-retirement.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify({...report,removed:report.removed.length}));
} finally {
 await mutateDataJson(lockPath,{lockedUntil:''},current=>current.operationId===operationId?{...current,lockedUntil:'',finishedAt:new Date().toISOString()}:current);
}
