import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
/** Off-server warmup must use the same private immutable index as the live image. */
export async function restoreReleaseEncyclopedia(storage,root,release){
 try{await fs.access(path.join(root,'apps/web/lib/encyclopedia/calculation-index.ts'));}catch{return null;}
 const binding=await storage.readJson(`knowledge/encyclopedia/calculation-releases/${release}.json`,null);
 if(binding?.release!==release||!/^knowledge\/encyclopedia\/calculation-indexes\/[a-f0-9]{64}\.json$/.test(binding?.key||''))throw Error('live_encyclopedia_binding_missing');
 const index=await storage.readJson(binding.key,null);
 if(index?.version!==1||index.digest!==binding.digest||createHash('sha256').update(JSON.stringify(index.models)).digest('hex')!==binding.digest)throw Error('live_encyclopedia_index_invalid');
 const target=path.join(root,'data/knowledge/encyclopedia/calculation-v1.json');
 await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,JSON.stringify(index));
 return index.digest;
}
