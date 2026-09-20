// Read-only diagnostics; never changes source inventory or catalog manifests.
import { readDataJson } from '../apps/web/lib/data.ts';
import { readHomeCatalogSnapshot } from '../apps/web/lib/catalog/storage.ts';
const manifest = await readDataJson('catalog/manifest.json', null);
const overview = await readDataJson('catalog/public/overview.json', null);
const maintenance = await readDataJson('catalog/storage-maintenance.json', null);
console.log('STORAGE', JSON.stringify(maintenance));
console.log('OVERVIEW', JSON.stringify({generationId:manifest?.generationId,overviewGeneration:overview?.generationId,
  bytes:Buffer.byteLength(JSON.stringify(overview)),markets:Object.fromEntries(Object.entries(manifest?.markets || {}).map(([market,row])=>[market,{source:row.count,total:overview?.markets?.[market]?.total,sourceTotal:overview?.markets?.[market]?.sourceTotal,samples:overview?.markets?.[market]?.items?.length}]))}));
for (let attempt=1;attempt<=3;attempt++) {
  const start=performance.now();
  const home=await readHomeCatalogSnapshot(6);
  const readAt=performance.now();
  console.log('TIMING',JSON.stringify({attempt,readMs:Math.round(readAt-start),cards:home.items.length,generationId:home.generationId}));
}
