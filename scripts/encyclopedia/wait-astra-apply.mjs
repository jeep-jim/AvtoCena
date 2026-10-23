import fs from 'node:fs/promises';
import {getJsonStorage} from '../../apps/web/lib/data.ts';
import {ASTRA_ROOT,sha,stable} from './astra-bridge.mjs';
const marker=JSON.parse(await fs.readFile('.github/market-runs/regcloud-deploy.json','utf8'));
const digests=marker.requiredAstraPlanDigests||[];
if(!Array.isArray(digests)||digests.length>8||digests.some(d=>!/^[a-f0-9]{64}$/.test(d)))throw Error('invalid_required_astra_plans');
if(digests.length){
 const storage=getJsonStorage();if(storage.driver!=='object')throw Error('durable_object_storage_required');
 const deadline=Date.now()+50*60*1000;
 for(const digest of digests){
  const prefix=`${ASTRA_ROOT}/plans/${digest}`,plan=await storage.readJson(`${prefix}/manifest.json`,null);
  if(!plan||plan.planDigest!==digest||sha({version:1,corpusDigest:plan.corpusDigest,plans:plan.models.map(({planKey,...m})=>m)})!==digest)throw Error('astra_plan_missing_or_changed');
  const expected=plan.models.map(m=>({id:m.id,revision:m.afterRevision,checksum:m.recordChecksum}));
  for(;;){
   const applied=await storage.readJson(`${prefix}/applied.json`,null);
   if(applied){
    if(applied.version!==1||applied.planDigest!==digest||applied.corpusDigest!==plan.corpusDigest||stable(applied.models)!==stable(expected))throw Error('astra_apply_receipt_mismatch');
    console.log('ASTRA_APPLY_CONFIRMED',JSON.stringify({planDigest:digest,models:expected.length}));break;
   }
   if(Date.now()>=deadline)throw Error('astra_apply_wait_deadline');
   console.log('WAIT_FOR_ASTRA_APPLY',JSON.stringify({planDigest:digest,remainingSeconds:Math.floor((deadline-Date.now())/1000)}));
   await new Promise(resolve=>setTimeout(resolve,30000));
  }
 }
}
