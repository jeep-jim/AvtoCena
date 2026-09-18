import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {readMarketOffers,persistCatalogOffers} from '../apps/web/lib/catalog/storage.ts';
import {mutateDataJson,readDataJson} from '../apps/web/lib/data.ts';
import {PUBLIC_CATALOG_MARKETS} from '../apps/web/lib/catalog/runtime-config.ts';
import {assertNoDeliveredPriceRegression} from '../apps/web/lib/catalog/publication-price-preservation.ts';
import {restoreProAuctionsPower} from '../apps/web/lib/catalog/proauctions-source-parameters.ts';
import {hashCatalogRows} from './lib/catalog-preservation-hash.mjs';
const patchRoot='proauctions-detail-patches';
const summary=JSON.parse(await fs.readFile(`${patchRoot}/summary.json`,'utf8'));
if(!summary.scanned)throw Error('empty_sheet_recovery');
// Failed archival lots which were never published must not block existing cards.
// Every published lot still requires its complete identity-checked patch below.
const patches=new Map();for(const file of await fs.readdir(patchRoot))if(/^\d+\.json$/.test(file)){
 const patch=JSON.parse(await fs.readFile(`${patchRoot}/${file}`,'utf8'));if(patches.has(patch.id))throw Error('duplicate_patch');patches.set(patch.id,patch);
}
const failedIds=new Set(summary.failed.map(row=>String(row.id)));
if(summary.scanned!==patches.size+failedIds.size)throw Error('incomplete_archive_coverage');
const lockPath='catalog/import-lock.json',operationId=`japan-detail-recovery-${randomUUID()}`;
await mutateDataJson(lockPath,{lockedUntil:''},current=>{
 if(Date.parse(current.lockedUntil||'')>Date.now())throw Error('publication_locked');
 return {operationId,operationType:'japan_detail_recovery',startedAt:new Date().toISOString(),lockedUntil:new Date(Date.now()+45*60000).toISOString()};
});
try{
 const previous=await readDataJson('catalog/manifest.json',null);if(!previous?.generationId)throw Error('manifest_missing');
 const all=[],preserved={};for(const market of PUBLIC_CATALOG_MARKETS){const rows=await readMarketOffers(market);if(rows.length!==previous.markets[market].count)throw Error(`incomplete_read:${market}`);all.push(...rows);if(market!=='japan')preserved[market]=rows;}
 let patched=0,sheetsAdded=0,powerRestored=0,newerLotsPreserved=0;
 const expected=all.map(row=>{
  if(row.market!=='japan' || row.sourceId!=='proauctions_japan_stat')return row;
  const patch=patches.get(row.id);
  if(!patch){
   if(failedIds.has(String(row.sourceOfferId)))throw Error(`published_sheet_recovery_failed:${row.id}`);
   // A concurrent resumed collection can add lots outside this older archive.
   // Preserve those complete new records exactly, including their own sheets.
   newerLotsPreserved++;return row;
  }
  if(['sourceOfferId','sourcePrice','year','lotNumber','auctionDate'].some(k=>String(patch[k])!==String(row[k])) || patch.sourceUrl!==row.operational.sourceUrl)throw Error(`patch_identity_conflict:${row.id}`);
  const groups=row.images.map(i=>i.url?.match(/^https:\/\/jp\d+\.pa-server\.ru(\/auc_auto\/\d{4}_\d{2}_\d{2}\/\d+\/)/)?.[1]).filter(Boolean);
  if(patch.sheets.some(s=>!groups.length || !groups.every(g=>s.url.startsWith(new URL(s.url).origin+g)) || !/^https:\/\/jp\d+\.pa-server\.ru\//.test(s.url) || !/^[a-f0-9]{64}$/.test(s.checksum) || s.width<100 || s.height<100))throw Error(`invalid_sheet:${row.id}`);
  const next=restoreProAuctionsPower(row);if(next!==row)powerRestored++;
  const fresh=patch.sheets.filter(s=>!row.images.some(i=>i.url===s.url));sheetsAdded+=fresh.length;patched++;
  return {...next,images:[...row.images,...fresh]};
 });
 if(!patched)throw Error('no_published_japan_patches');
 const expectedHash=hashCatalogRows(expected);
 const validate=rows=>{if(rows.length!==expected.length || hashCatalogRows(rows)!==expectedHash)throw Error('detail_patch_preservation_failed');assertNoDeliveredPriceRegression(all,rows);};
 validate(expected);
 const report={published:false,operationId,previousGeneration:previous.generationId,patched,sheetsAdded,powerRestored,newerLotsPreserved,otherMarketHashes:Object.fromEntries(Object.entries(preserved).map(([m,r])=>[m,hashCatalogRows(r)]))};
 await fs.writeFile('japan-detail-recovery-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 const japan=expected.filter(r=>r.market==='japan');
 const manifest=await persistCatalogOffers(expected,{productionRefreshMarket:'japan',appendPublicOffersByMarket:{japan},preservePublicOffersByMarket:preserved,beforePersistValidate:validate,beforePublishValidate:validate});
 const after=[];for(const market of PUBLIC_CATALOG_MARKETS)after.push(...await readMarketOffers(market));validate(after);
 Object.assign(report,{published:true,generationId:manifest.generationId,verifiedAt:new Date().toISOString()});await fs.writeFile('japan-detail-recovery-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await mutateDataJson(lockPath,{lockedUntil:''},current=>current.operationId===operationId?{...current,lockedUntil:new Date().toISOString(),releasedAt:new Date().toISOString()}:current);}
