import fs from 'node:fs/promises';
import {catalogPreflightInputBytes} from './lib/catalog-preflight-input.mjs';
import {catalogStorageBudget} from './lib/catalog-storage-budget.mjs';
const {getJsonStorage}=await import('../apps/web/lib/data.ts');
const storage=getJsonStorage();
if(!storage.listBucketObjects)throw Error('Full bucket inventory unavailable; publication stopped');
const objects=await storage.listBucketObjects('');
const currentBytes=objects.reduce((sum,row)=>sum+Math.max(0,Number(row.size)||0),0);
const inputBytes=await catalogPreflightInputBytes(storage, process.env);
// Record the forecast for storage monitoring.
// This is a conservative estimate, not a claim to measure future writes exactly.
const report={checkedAt:new Date().toISOString(),...catalogStorageBudget(currentBytes,inputBytes),objects:objects.length};
await fs.writeFile(process.env.CATALOG_STORAGE_PREFLIGHT_REPORT || 'catalog-storage-preflight.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
// Estimates are telemetry. Failed provider writes still fail publication.
