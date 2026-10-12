import {getJsonStorage} from '../apps/web/lib/data.ts';
const storage=getJsonStorage();
const manifest=await storage.readJson('catalog/manifest.json',null);
for(const prefix of ['catalog/china-cny-prices/','catalog/public/offers/','catalog/public/projection-brand/',`catalog/generations/${manifest.generationId}/indexes/budget-markets-v3/`,'catalog/runtime-budget-prices-v2/','catalog/runtime-sort-prices-v2/']){
 const start=performance.now();const objects=await storage.listObjects(prefix);
 console.log(JSON.stringify({prefix,ms:Math.round(performance.now()-start),count:objects.length,totalBytes:objects.reduce((sum,x)=>sum+Number(x.size||0),0),largest:objects.sort((a,b)=>Number(b.size)-Number(a.size)).slice(0,6).map(x=>({key:x.key,size:x.size}))}));
}
const {detailHash,detailShardPath}=await import('../apps/web/lib/catalog/detail-shards.ts');
const {japanPreviewInputPath}=await import('../apps/web/lib/catalog/japan-preview-inputs.ts');
const id='a877bac6f6ecedcd6101bca2',hash=detailHash(id);
const root=await storage.readJson(detailShardPath(manifest.generationId,hash.slice(0,2)),null);
const child=await storage.readJson(detailShardPath(manifest.generationId,hash.slice(0,3)),null);
console.log(JSON.stringify({detailProbe:{manifest:manifest.generationId,root:root?.generationId,activeChild:child?.generationId,rows:child?.items?.length,containsId:child?.items?.some(x=>x.id===id)}}));
const japan=await storage.readJson(japanPreviewInputPath(manifest.generationId),null);
console.log(JSON.stringify({japanInput:{generationId:japan?.generationId,bytes:Buffer.byteLength(JSON.stringify(japan)),entries:Object.keys(japan?.entries||{}).length,parameters:Object.values(japan?.entries||{}).filter(x=>x.parameters).length}}));
const {verifiedCompressedBudgetSelector}=await import('../apps/web/lib/catalog/budget-selector-codec.ts');
const directory=await storage.readJson(`catalog/generations/${manifest.generationId}/indexes/budget-markets-v3/ready.json`,null);
let combined=0;
for(const market of ['china','korea','europe','uae','georgia']){
 const wire=await storage.readJson(`catalog/generations/${manifest.generationId}/indexes/budget-markets-v3/${market}.json`,null);
 const index=verifiedCompressedBudgetSelector(directory,market,wire);
 if(!index)throw Error('invalid_selector');
 const budgetBytes=Buffer.byteLength(JSON.stringify(index.rows.map(row=>row.slice(0,7))));
 const sortBytes=Buffer.byteLength(JSON.stringify([...index.rows,...index.otherRows].map(row=>row.slice(0,7))));
 combined+=budgetBytes+sortBytes;
 console.log(JSON.stringify({cacheWorkingSet:{market,budgetBytes,sortBytes}}));
}
console.log(JSON.stringify({combinedPriceCacheSerializedBytes:combined,currentLimit:128*1024*1024}));
