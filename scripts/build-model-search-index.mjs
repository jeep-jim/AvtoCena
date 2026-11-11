// Public names/aliases only, compiled at build time. No live inventory queries.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {readDirectoryModels} from '../apps/web/lib/catalog/model-directory.ts';
import {CATALOG_BRANDS} from '../apps/web/lib/catalog/brands.ts';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const models=(await readDirectoryModels()).filter(m=>m.active!==false&&m.make&&m.model);
const brands=[...new Set(models.map(m=>m.make))].sort();
const data={version:1,models:models.map(m=>[m.make,m.model,[...new Set(m.aliases||[])],m.id.startsWith('source-master/')?0:1]),brands:brands.map(make=>[make,CATALOG_BRANDS.find(b=>b.name===make)?.aliases||[]])};
if(models.length<1000)throw Error('model_search_directory_incomplete');
const json=JSON.stringify(data),hash=createHash('sha256').update(json).digest('hex').slice(0,16);
const asset=`/model-directory.${hash}.json`;
await fs.mkdir(path.join(root,'apps/web/public'),{recursive:true});
await fs.writeFile(path.join(root,'apps/web/public',asset),json);
await fs.writeFile(path.join(root,'apps/web/lib/catalog/model-search-asset.json'),JSON.stringify({asset,models:models.length,brands:brands.length})+'\n');
console.log(JSON.stringify({modelSearch:{asset,models:models.length,brands:brands.length,bytes:Buffer.byteLength(json),gzipBytes:gzipSync(json).length}}));
