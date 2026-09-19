import fs from 'node:fs';
import {performance} from 'node:perf_hooks';
const network=[];
const originalFetch=globalThis.fetch;
globalThis.fetch=async(input,init)=>{
 const start=performance.now();const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);
 const kind=url.hostname.includes('cbr.ru')?'cbr':url.pathname.includes('search-projection')?'projection':url.pathname.includes('offer')?'offer-storage':url.hostname.includes('yandex')?'storage':'other';
 try{const response=await originalFetch(input,init);network.push({kind,status:response.status,ms:Math.round(performance.now()-start)});return response;}catch(e){network.push({kind,error:e.name,ms:Math.round(performance.now()-start)});throw e;}
};
const {searchOffers,getOffer}=await import('../apps/web/lib/catalog/storage.ts');
const {getEffectiveMarketsWithDefaults}=await import('../apps/web/lib/effective-market-settings.ts');
const {calculateOfferWithCustomerParametersDetailed}=await import('../apps/web/lib/catalog/customs-pricing.ts');
const {japanPreviewParameters}=await import('../apps/web/lib/catalog/japan-preview-parameters.ts');
const {applyEncyclopediaDisplayIdentityBatch}=await import('../apps/web/lib/catalog/display-identity.ts');
const report=[];
async function timed(label,fn){const start=performance.now();const value=await fn();report.push({label,ms:Math.round(performance.now()-start)});return value;}
for(const iteration of ['cold','warm']){
 const found=await timed(`${iteration}:search24`,()=>searchOffers({market:'japan',page:2,pageSize:24}));
 await timed(`${iteration}:settings+live-logistics-rate`,()=>getEffectiveMarketsWithDefaults());
 await timed(`${iteration}:display-identities`,()=>applyEncyclopediaDisplayIdentityBatch(found.items));
 let cursor=0;const details=[];
 await timed(`${iteration}:24-full-offers-concurrency4`,()=>Promise.all(Array.from({length:4},async()=>{while(cursor<found.items.length){const index=cursor++;details[index]=await getOffer(found.items[index].id);}})));
 cursor=0;let quoted=0;
 await timed(`${iteration}:24-calculations-concurrency4`,()=>Promise.all(Array.from({length:4},async()=>{while(cursor<details.length){const o=details[cursor++];try{const params=japanPreviewParameters(o);const r=await calculateOfferWithCustomerParametersDetailed(o,params);if(r.ok)quoted++;}catch{}}})));
 report.push({iteration,items:found.items.length,quoted});
}
fs.mkdirSync('artifacts/catalog-latency',{recursive:true});fs.writeFileSync('artifacts/catalog-latency/profile.json',JSON.stringify({report,network},null,2));console.log(JSON.stringify({report,network},null,2));
