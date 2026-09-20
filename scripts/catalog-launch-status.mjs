import fs from 'node:fs/promises';
import {getJsonStorage} from '../apps/web/lib/data.ts';
import {restoreKcarRecovery,kcarRecoveryPointer} from './lib/kcar-recovery-checkpoint.mjs';
const storage=getJsonStorage();
for(const name of ['writeJson','putBinary','deleteJson','deleteBinary','deleteObjects','deletePrefix'])storage[name]=async()=>{throw Error('status_read_only');};
const objects=await storage.listBucketObjects('');
const prefixes={};
for(const row of objects){const prefix=String(row.key).split('/').slice(0,3).join('/');const group=prefixes[prefix]||={objects:0,bytes:0};group.objects++;group.bytes+=Number(row.size)||0;}
const pointer=await storage.readJson(kcarRecoveryPointer,null);
const state=await restoreKcarRecovery(storage);
const report={checkedAt:new Date().toISOString(),storage:{objects:objects.length,bytes:objects.reduce((n,r)=>n+(Number(r.size)||0),0),prefixes:Object.entries(prefixes).sort((a,b)=>b[1].bytes-a[1].bytes).slice(0,35)},kcar:{pointer,checkpointRecords:state?.records.length||0,powerConfirmed:state?.records.filter(r=>r.offer?.powerDataSource==='kcar_bound_registry_and_detail_hp'&&r.offer.powerHp>0).length||0},publisherLock:await storage.readJson('catalog/import-lock.json',null)};
await fs.writeFile('catalog-launch-status.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
