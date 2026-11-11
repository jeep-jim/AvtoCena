import fs from 'node:fs/promises';
import {readCalculationIndex,factFields,token} from '../../apps/web/lib/encyclopedia/calculation-index.ts';
import {assertResearchBatchMembership} from './release-batch-verification.mjs';
const marker=JSON.parse(await fs.readFile('.github/market-runs/regcloud-deploy.json','utf8'));
const paths=marker.requiredResearchBatches||[];
if(!Array.isArray(paths)||paths.length>64)throw Error('invalid_required_batches');
if(paths.length){
 const index=readCalculationIndex();if(!index)throw Error('release_index_missing');
 const batches=[];
 for(const path of paths){
  if(!/^docs\/encyclopedia\/batches\/[a-z0-9-]+\.json$/.test(path))throw Error('invalid_batch_path');
  batches.push(JSON.parse(await fs.readFile(path,'utf8')));
 }
 console.log(JSON.stringify({stage:'required_research_batches_verified',indexDigest:index.digest,...assertResearchBatchMembership(index,batches,factFields,token)}));
}
