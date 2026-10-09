import fs from 'node:fs/promises';
import path from 'node:path';
import {readCheckpointJsonl} from './lib/read-checkpoint-jsonl.mjs';
import {stableOfferId} from '../apps/web/lib/catalog/storage.ts';
const root='autohome-saved-intake',target='catalog-intake-china',sourceId='autohome_new_china_open';
const report=JSON.parse(await fs.readFile(path.join(root,'report.json'),'utf8'));
const source=report?.sources?.find(row=>row.sourceId===sourceId);
if(report.market!=='china'||!source||source.observations<=0||source.stopReason==='running')throw Error('autohome_saved_intake_invalid');
const files=(await fs.readdir(root)).filter(name=>/^autohome_new_china_open-\d+\.jsonl$/.test(name));
if(!files.length)throw Error('autohome_saved_intake_empty');
const ids=new Set();let latest=0,rows=0;
for(const file of files)for await(const row of readCheckpointJsonl(path.join(root,file))){
 const o=row.offer,at=Date.parse(row.observedAt);
 if(o?.sourceId!==sourceId||o.market!=='china'||o.id!==stableOfferId(sourceId,String(o.sourceOfferId))
   ||!Number.isFinite(at)||at>Date.now()+60000||Date.now()-at>48*3600000)throw Error('autohome_saved_intake_identity_or_age');
 ids.add(o.id);rows++;latest=Math.max(latest,at);
}
if(!rows||ids.size!==source.observations)throw Error('autohome_saved_intake_count');
await fs.mkdir(target,{recursive:true});
if((await fs.readdir(target)).length)throw Error('autohome_restore_target_not_empty');
for(const file of files)await fs.copyFile(path.join(root,file),path.join(target,file));
await fs.writeFile(path.join(target,'report.json'),JSON.stringify({version:1,market:'china',productionWrites:false,
 completedAt:new Date(latest).toISOString(),sources:[source],
 confirmedWithdrawals:(report.confirmedWithdrawals||[]).filter(row=>row.sourceId===sourceId)}));
console.log(JSON.stringify({sourceId,restored:true,uniqueOffers:ids.size,observations:rows,providerRequests:0}));
