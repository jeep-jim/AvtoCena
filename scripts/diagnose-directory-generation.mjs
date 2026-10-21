import {getJsonStorage} from '../apps/web/lib/data.ts';
const storage=getJsonStorage();
for(const file of ['catalog/manifest.json','catalog/public/brand-summary.json','catalog/public/facets.json']){
 const result=await storage.readJsonWithMeta(file,{});
 console.log(JSON.stringify({file,found:result.found,generationId:result.value.generationId,bytes:Buffer.byteLength(JSON.stringify(result.value))}));
}
