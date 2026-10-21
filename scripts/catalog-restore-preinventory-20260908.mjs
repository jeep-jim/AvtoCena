import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { getJsonStorage, mutateDataJson } from '../apps/web/lib/data.ts';
import { offerPath, publishCurrentCatalogReadModels, resetCatalogReadCachesForTests } from '../apps/web/lib/catalog/storage.ts';
import { catalogOfferVisibleRub } from '../apps/web/lib/catalog/public-priority.ts';

// Exact checkpoint recorded by successful parity run 34236258399 before the
// inventory republish. This operation never recalculates or deletes offers.
const source = 'gen_1788837138509_81964d51';
const broken = 'gen_1788878529625_fa906094';
const counts = {korea:1220, china:1070, japan:10190, uae:1694, europe:5259, georgia:23};
const storage = getJsonStorage();
const operationId = `restore_preinventory_${crypto.randomUUID()}`;
const lockPath = 'catalog/import-lock.json';
const report = {source, expectedCurrent:broken, restored:false, markets:{}};
await mutateDataJson(lockPath, {}, lock => {
  if (Date.parse(lock.lockedUntil || '') > Date.now()) throw Error('restore_catalog_writer_busy');
  return {operationId, operationType:'restore_preinventory', lockedUntil:new Date(Date.now()+30*60_000).toISOString()};
});
try {
  const current = await storage.readJsonWithMeta('catalog/manifest.json', null);
  if (!current.found || !current.etag || current.value.generationId !== broken) throw Error('restore_current_generation_changed');
  const index = await storage.readJson(`catalog/generations/${source}/indexes/offers-by-id.json`, null);
  if (index?.generationId !== source || !index.byId) throw Error('restore_index_missing');
  const markets = {};
  for (const [market, expected] of Object.entries(counts)) {
    const ids = Object.keys(index.byId).filter(id => index.byId[id].market === market);
    if (ids.length !== expected) throw Error(`restore_index_count:${market}:${ids.length}`);
    const chunks = [...new Set(ids.map(id=>index.byId[id].chunk))].sort();
    const rows = [];
    for (const chunk of chunks) {
      const key = chunk.startsWith('catalog/') ? chunk : offerPath(source,market,chunk);
      const part = await storage.readJson(key,null);
      if (!Array.isArray(part)) throw Error(`restore_chunk_missing:${market}:${chunk}`);
      rows.push(...part);
    }
    const seen = new Set();
    for (const row of rows) {
      if (!row.id || row.market !== market || !index.byId[row.id] || seen.has(row.id)
        || !row.make || !row.model || !row.images?.length) throw Error(`restore_bad_row:${market}`);
      seen.add(row.id);
    }
    if (rows.length !== expected || ids.some(id=>!seen.has(id))) throw Error(`restore_rows_count:${market}`);
    const projection = await storage.readJson(`catalog/generations/${source}/indexes/projection/${market}.json`,null);
    if (projection?.generationId !== source || projection.items?.length !== expected) throw Error(`restore_projection_missing:${market}`);
    report.markets[market] = {count:rows.length, delivered:rows.filter(o=>catalogOfferVisibleRub(o)>0).length,
      grades:rows.filter(o=>o.auctionGrade).length, hash:crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex')};
    markets[market] = {count:expected, chunks, updatedAt:new Date(1788837138509).toISOString()};
  }
  if (report.markets.japan.delivered < 9000 || report.markets.korea.delivered < 1000) throw Error('restore_checkpoint_not_priced');
  const backup = `catalog/recovery/preinventory-20260908-${broken}.json`;
  await storage.writeJson(backup,{manifest:current.value,report},{ifNoneMatch:'*'});
  // Immutable generation indexes are complete before CAS. Readers reject stale
  // current projections by generation ID and use these immutable indexes.
  await storage.writeJson('catalog/manifest.json',{...current.value,generationId:source,
    updatedAt:new Date().toISOString(),markets},{ifMatch:current.etag});
  report.restored = true;
  resetCatalogReadCachesForTests();
  await publishCurrentCatalogReadModels();
  report.readModelsRefreshed = true;
} finally {
  await fs.writeFile('catalog-preinventory-restore-report.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
  await mutateDataJson(lockPath,{},lock=>lock.operationId===operationId ? {...lock,lockedUntil:'',finishedAt:new Date().toISOString()} : lock);
}
