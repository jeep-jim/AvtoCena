import fs from 'node:fs/promises';
import path from 'node:path';
import {catalogStorageBudget} from './lib/catalog-storage-budget.mjs';
const {getJsonStorage}=await import('../apps/web/lib/data.ts');
const storage=getJsonStorage();
if(!storage.listBucketObjects)throw Error('Full bucket inventory unavailable; publication stopped');
const objects=await storage.listBucketObjects('');
const currentBytes=objects.reduce((sum,row)=>sum+Math.max(0,Number(row.size)||0),0);
const input=process.env.CATALOG_REBUILD_INPUT_DIR || 'catalog-intake-publish';
let inputBytes=0;
for(const file of await fs.readdir(input))if(file.endsWith('.json'))inputBytes+=(await fs.stat(path.join(input,file))).size;
// Reserve room for duplicated projections/indexes plus 5 GB free headroom.
// This is a conservative estimate, not a claim to measure future writes exactly.
const report={checkedAt:new Date().toISOString(),...catalogStorageBudget(currentBytes,inputBytes),objects:objects.length};
await fs.writeFile(process.env.CATALOG_STORAGE_PREFLIGHT_REPORT || 'catalog-storage-preflight.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
if(!report.ok)throw Error('Object Storage reserve insufficient; collected artifacts retained, publication stopped');
