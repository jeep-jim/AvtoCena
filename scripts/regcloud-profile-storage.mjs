import {getJsonStorage} from '../apps/web/lib/data.ts';
const storage=getJsonStorage();
const manifest=await storage.readJson('catalog/manifest.json',null);
for(const prefix of ['catalog/china-cny-prices/','catalog/public/offers/','catalog/public/projection-brand/',`catalog/generations/${manifest.generationId}/indexes/budget-markets-v3/`,'catalog/runtime-budget-prices-v2/','catalog/runtime-sort-prices-v2/']){
 const start=performance.now();const objects=await storage.listObjects(prefix);
 console.log(JSON.stringify({prefix,ms:Math.round(performance.now()-start),count:objects.length,totalBytes:objects.reduce((sum,x)=>sum+Number(x.size||0),0),largest:objects.sort((a,b)=>Number(b.size)-Number(a.size)).slice(0,6).map(x=>({key:x.key,size:x.size}))}));
}
