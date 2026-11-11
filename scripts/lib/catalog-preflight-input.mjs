import fs from 'node:fs/promises';
import path from 'node:path';
import {createReadStream} from 'node:fs';
import {createInterface} from 'node:readline';

export function publicationInputRecord(record) {
 const compact=offer=>{if(!offer || typeof offer!== 'object')return offer;const operational={...offer.operational};delete operational.raw;return {...offer,operational};};
 if(Array.isArray(record?.offers))return {...record,offers:record.offers.map(compact)};
 if(record?.offer)return {...record,offer:compact(record.offer)};
 return record;
}


export async function catalogPreflightInputBytes(storage, env = process.env) {
  if (env.CATALOG_STORAGE_PREFLIGHT_MODE === 'budget-index') {
    const manifest = await storage.readJson('catalog/manifest.json', null);
    if (!/^gen_[a-zA-Z0-9_-]+$/.test(manifest?.generationId || '')) throw Error('Invalid active generation');
    if (!storage.listObjects) throw Error('Projection inventory unavailable');
    const prefix = `catalog/generations/${manifest.generationId}/indexes/projection/`;
    // The storage adapter normalizes away the trailing slash; exclude projection-brand siblings.
    const objects = (await storage.listObjects(prefix)).filter(object => object.key.startsWith(prefix));
    if (!objects.length) throw Error('Active generation projections unavailable');
    let bytes = 0;
    for (const object of objects) {
      if (!object.key.startsWith(prefix) || !Number.isSafeInteger(object.size) || object.size < 0) throw Error('Invalid projection inventory');
      bytes += object.size;
    }
    if (!Number.isSafeInteger(bytes) || bytes <= 0) throw Error('Empty projection inventory');
    return bytes;
  }
  if (env.CATALOG_STORAGE_PREFLIGHT_MODE) throw Error('Unknown storage preflight mode');
  const input = env.CATALOG_REBUILD_INPUT_DIR || 'catalog-intake-publish';
  let bytes = 0;
  for (const file of await fs.readdir(input, {recursive: true})) {
    if (!/\.jsonl?$/.test(file)) continue;
    const filename=path.join(input,file);
    if(file.endsWith('.jsonl')){
      for await(const line of createInterface({input:createReadStream(filename),crlfDelay:Infinity})){
        if(line.trim())bytes+=Buffer.byteLength(JSON.stringify(publicationInputRecord(JSON.parse(line))))+1;
      }
    }else{
      bytes+=Buffer.byteLength(JSON.stringify(publicationInputRecord(JSON.parse(await fs.readFile(filename,'utf8')))));
    }
  }
  return bytes;
}
