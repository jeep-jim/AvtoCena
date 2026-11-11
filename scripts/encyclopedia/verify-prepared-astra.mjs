import fs from 'node:fs/promises';
import {getJsonStorage} from '../../apps/web/lib/data.ts';
import {checksum} from '../../apps/web/lib/encyclopedia/calculation-index.ts';
import {verifyRequiredAstraRelease} from './assert-release-astra.mjs';

/** Read-only check of an existing isolated index, without recompiling or applying data. */
export async function verifyPreparedAstraRelease(release){
 if(!/^[a-f0-9]{40}$/.test(release||''))throw Error('invalid_prepared_astra_release');
 const storage=getJsonStorage();
 const binding=await storage.readJson(`knowledge/encyclopedia/calculation-releases/${release}.json`,null);
 if(binding?.release!==release||!/^knowledge\/encyclopedia\/calculation-indexes\/[a-f0-9]{64}\.json$/.test(binding?.key||''))throw Error('prepared_astra_binding_invalid');
 const index=await storage.readJson(binding.key,null);
 if(!index||index.digest!==binding.digest||checksum(index.models)!==binding.digest)throw Error('prepared_astra_index_invalid');
 const marker=JSON.parse(await fs.readFile('.github/market-runs/regcloud-deploy.json','utf8'));
 const result=await verifyRequiredAstraRelease({storage,index,marker});
 const summary={checkedAt:new Date().toISOString(),release,indexDigest:result.indexDigest,manifestDigest:result.manifestDigest,
  verified:result.verified,plans:result.plans.map(({annualChanges,...plan})=>plan),storageWrites:0,sourceRequests:0,activationConfirmed:false};
 await fs.mkdir('reports',{recursive:true});
 await fs.writeFile('reports/astra-prepared-verification.json',JSON.stringify(summary,null,2)+'\n');
 console.log('PREPARED_ASTRA_VERIFIED',JSON.stringify(summary));
 return summary;
}
