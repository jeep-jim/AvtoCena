import {performance} from 'node:perf_hooks';
import {getJsonStorage} from '../apps/web/lib/data.ts';
import {readCurrentPublicCatalogProjection,countCatalogOffers} from '../apps/web/lib/catalog/storage.ts';
import {japanSearchQuotes} from '../apps/web/lib/catalog/japan-delivered-preview.ts';
const storage=getJsonStorage(),read=storage.readJsonWithMeta.bind(storage);
storage.readJsonWithMeta=async(key,fallback)=>{const start=performance.now();try{return await read(key,fallback);}finally{console.log(JSON.stringify({read:key,ms:Math.round(performance.now()-start)}));}};
let start=performance.now();const projection=await readCurrentPublicCatalogProjection();console.log(JSON.stringify({phase:'projection',ms:Math.round(performance.now()-start),rows:projection.rows.length,generation:projection.generationId}));
start=performance.now();const quotes=await japanSearchQuotes(projection.generationId);console.log(JSON.stringify({phase:'japan-quotes',ms:Math.round(performance.now()-start),rows:Object.keys(quotes).length}));
for(const city of ['', 'Новокузнецк']){start=performance.now();const count=await countCatalogOffers({budgetTo:2000000,city});console.log(JSON.stringify({phase:'count',city,ms:Math.round(performance.now()-start),...count}));}
