import fs from 'node:fs/promises';
import {getJsonStorage} from '../apps/web/lib/data';
async function main(){
const storage=getJsonStorage();
if(storage.driver!=='object')throw Error('object_storage_required');
const allowed=new Set(['catalog/manifest.json','catalog/internal/manifest.json',...['china','uae','europe','georgia','korea'].map(m=>`catalog/intake-cursors/v1/${m}.json`)]);
const originalFetch=globalThis.fetch;let requests=0;
globalThis.fetch=async(input:any,options:any)=>{
 const u=new URL(String(input));
 if(u.origin!=='https://s3.regru.cloud'||options?.method!=='GET'||++requests>24)throw Error('read_only_scope_exceeded');
 return originalFetch(input,options);
};
const read=async(key:string)=>{if(!allowed.has(key))throw Error('read_not_allowlisted');return storage.readJson<any>(key,null);};
const manifest=await read('catalog/manifest.json'),internal=await read('catalog/internal/manifest.json');
const report:any={checkedAt:new Date().toISOString(),scope:'Stored manifests and committed cursors only; no supplier calls or writes; counts are stored records, not current supplier totals.',generationId:manifest?.generationId,markets:{},requests:0};
for(const market of ['china','uae','europe','georgia','korea']){
 const publicMarket=manifest?.markets?.[market],cursor=await read(`catalog/intake-cursors/v1/${market}.json`);
 report.markets[market]={publishedCount:publicMarket?.count??null,publishedChunks:publicMarket?.chunks?.length??null,updatedAt:publicMarket?.updatedAt??null,committedCursorFound:!!cursor,cursorGenerationId:cursor?.generationId??null,cursorUpdatedAt:cursor?.updatedAt??null,sources:(cursor?.sources||[]).map((s:any)=>({sourceId:s.sourceId,provider:s.provider,stopReason:s.stopReason,uniqueOffers:s.uniqueOffers??null,replicaSaved:!!s.replica,mode:s.mode??null}))};
}
report.internalSources=Object.entries(internal?.sources||{}).map(([id,s]:any)=>({sourceId:id,count:s.count??null,chunks:s.chunks?.length??null}));
report.requests=requests;
await fs.writeFile('local-market-readiness.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report));

}
main().catch(error=>{console.error(error instanceof Error?error.message:"readiness_failed");process.exitCode=1;});
