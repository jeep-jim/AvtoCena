import fs from 'node:fs/promises';
import {getJsonStorage} from '../apps/web/lib/data';
async function main(){
const storage=getJsonStorage();
if(storage.driver!=='object')throw Error('object_storage_required');
const allowed=new Set(['integrations/ajes/catalog-failure-pages/korea-list-1.json','integrations/ajes/catalog-failure-pages/stats-list-1.json','catalog/manifest.json','catalog/internal/manifest.json','catalog/operations/collection-controls-v1.json',...['china','uae','europe','georgia','korea'].map(m=>`catalog/intake-cursors/v1/${m}.json`)]);
const originalFetch=globalThis.fetch;let requests=0;
globalThis.fetch=async(input:any,options:any)=>{
 const u=new URL(String(input));
 if(u.origin!=='https://s3.regru.cloud'||options?.method!=='GET'||++requests>24)throw Error('read_only_scope_exceeded');
 return originalFetch(input,options);
};
const read=async(key:string)=>{if(!allowed.has(key))throw Error('read_not_allowlisted');return storage.readJson<any>(key,null);};
for(const market of ['korea','stats']){
 const value=await read('integrations/ajes/catalog-failure-pages/'+market+'-list-1.json');
 console.log('SUPPLIER_FAILURE_METADATA',JSON.stringify(value?{market,startedAt:value.startedAt,finishedAt:value.finishedAt,httpStatus:value.httpStatus,providerCode:value.providerCode,outcome:value.outcome,page:value.page,pageSize:value.pageSize}: {market,found:false}));
}
const manifest=await read('catalog/manifest.json'),internal=await read('catalog/internal/manifest.json');
const report:any={checkedAt:new Date().toISOString(),scope:'Stored manifests and committed cursors only; no supplier calls or writes; counts are stored records, not current supplier totals.',generationId:manifest?.generationId,markets:{},requests:0};
for(const market of ['china','uae','europe','georgia','korea']){
 const publicMarket=manifest?.markets?.[market],cursor=await read(`catalog/intake-cursors/v1/${market}.json`);
 report.markets[market]={publishedCount:publicMarket?.count??null,publishedChunks:publicMarket?.chunks?.length??null,updatedAt:publicMarket?.updatedAt??null,committedCursorFound:!!cursor,cursorGenerationId:cursor?.generationId??null,cursorUpdatedAt:cursor?.updatedAt??null,sources:(cursor?.sources||[]).map((s:any)=>({sourceId:s.sourceId,provider:s.provider,stopReason:s.stopReason,uniqueOffers:s.uniqueOffers??null,replicaSaved:!!s.replica,mode:s.mode??null}))};
}
const controls=await read('catalog/operations/collection-controls-v1.json');
report.collectionControls=controls?{revision:controls.revision,markets:Object.fromEntries(Object.entries(controls.markets||{}).map(([k,v]:any)=>[k,v.enabled])),sources:Object.fromEntries(Object.entries(controls.sources||{}).map(([k,v]:any)=>[k,v.enabled]))}:null;
report.internalSources=Object.entries(internal?.sources||{}).map(([id,s]:any)=>({sourceId:id,count:s.count??null,chunks:s.chunks?.length??null}));
report.requests=requests;
await fs.writeFile('local-market-readiness.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report));

}
main().catch(error=>{console.error(error instanceof Error?error.message:"readiness_failed");process.exitCode=1;});
