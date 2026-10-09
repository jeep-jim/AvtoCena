import {Session} from 'node:inspector/promises';
import {getJsonStorage} from '../apps/web/lib/data.ts';
import {readHomeCatalogSnapshot,searchOffers,resetCatalogReadCachesForTests} from '../apps/web/lib/catalog/storage.ts';
const storage=getJsonStorage();
if(storage.driver!=='object')throw Error('object_storage_required');
for(const name of ['writeJson','putBinary','deleteJson','deleteObjects','deletePrefix'])storage[name]=async()=>{throw Error('read_only_diagnostic');};
const reads=new Map();let bytes=0;
const original=storage.readJsonWithMeta.bind(storage);
storage.readJsonWithMeta=async(key,fallback)=>{
 const t=performance.now();const value=await original(key,fallback);
 const size=Buffer.byteLength(JSON.stringify(value.value));bytes+=size;
 if(bytes>512*1024*1024)throw Error('diagnostic_read_budget');
 const group=key.replace(/catalog\/generations\/[^/]+/,'catalog/generations/[generation]').replace(/\/[a-f0-9]{16,}\.json$/,'/[shard].json');
 const prior=reads.get(group)||{calls:0,bytes:0,ms:0};prior.calls++;prior.bytes+=size;prior.ms+=performance.now()-t;reads.set(group,prior);return value;
};
const manifest=await storage.readJson('catalog/manifest.json',{});
const overview=await storage.readJson('catalog/generations/'+manifest.generationId+'/indexes/overview.json',null);
console.log(JSON.stringify({kind:'snapshot',generation:manifest.generationId,policyDate:overview?.policyDate,today:new Date(Date.now()+7*3600000).toISOString().slice(0,10),counts:Object.fromEntries(Object.entries(manifest.markets||{}).map(([k,v])=>[k,v.count]))}));
const session=new Session();session.connect();await session.post('Profiler.enable');
async function measure(label,load){
 const start=performance.now(),cpu=process.cpuUsage();await session.post('Profiler.start');
 try{const r=await load();console.log(JSON.stringify({kind:'timing',label,ms:performance.now()-start,cpu:process.cpuUsage(cpu),total:r.total,items:r.items?.length}));}
 catch(e){console.log(JSON.stringify({kind:'error',label,message:String(e.message).replace(/https?:\/\/\S+/g,'[url]').slice(0,160)}));}
 const {profile}=await session.post('Profiler.stop');const counts=new Map();for(const id of profile.samples||[])counts.set(id,(counts.get(id)||0)+1);
 console.log(JSON.stringify({kind:'cpu',label,top:profile.nodes.map(n=>({function:n.callFrame.functionName,file:n.callFrame.url.split('/').pop(),line:n.callFrame.lineNumber+1,samples:counts.get(n.id)||0})).sort((a,b)=>b.samples-a.samples).slice(0,18)}));
}
resetCatalogReadCachesForTests();
await measure('home-cold',()=>readHomeCatalogSnapshot(10));
await measure('home-warm',()=>readHomeCatalogSnapshot(10));
await measure('china-budget-cold',()=>searchOffers({market:'china',budgetTo:3000000,page:1,pageSize:12}));
await measure('china-budget-other-page',()=>searchOffers({market:'china',budgetTo:3000000,page:2,pageSize:12}));
console.log(JSON.stringify({kind:'reads',bytes,top:[...reads.entries()].sort((a,b)=>b[1].bytes-a[1].bytes).slice(0,30)}));
session.disconnect();
