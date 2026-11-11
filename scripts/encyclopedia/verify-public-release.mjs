import fs from 'node:fs/promises';
import {assertPublicVariant} from './public-variant-verification.mjs';
const marker=JSON.parse(await fs.readFile('.github/market-runs/regcloud-deploy.json','utf8'));
const paths=marker.publicResearchBatches||[];
if(!Array.isArray(paths)||paths.length>64||paths.some(p=>!/^docs\/encyclopedia\/batches\/[a-z0-9-]+\.json$/.test(p)))throw Error('invalid_public_research_batches');
const checks=[];let astraReport;
for(const p of paths){const batch=JSON.parse(await fs.readFile(p,'utf8'));for(const e of batch.entries)checks.push({modelId:e.modelId,variantId:e.variantId,year:e.year,fields:e.patch});}
if(marker.requiredAstraPlanDigests?.length){
 const report=JSON.parse(await fs.readFile('reports/astra-release-verification.json','utf8'));
 astraReport=report;
 if(!report.verified)throw Error('astra_index_not_verified');
 for(const p of report.plans)checks.push(...p.annualChanges);
}
if(checks.length){
 const get=async path=>{const r=await fetch('https://avtocena.com'+path,{signal:AbortSignal.timeout(30000),headers:{'Cache-Control':'no-cache'}});if(!r.ok)throw Error('public_read_failed:'+r.status+':'+path);return r.json();};
 const release=process.env.EXPECTED_RELEASE||process.env.GITHUB_SHA;
 if(!/^[a-f0-9]{40}$/.test(release||''))throw Error('expected_release_required');
 const health=await get('/api/health');if(health.releaseSha!==release)throw Error('public_release_mismatch');
 const source=process.env.ENCYCLOPEDIA_PUBLIC_COMPACT_VERIFY==='1'
  ? await (await import('./public-release-source.mjs')).publicReleaseSource(release,astraReport):null;
 const groups=new Map();for(const c of checks){const key=c.modelId+':'+c.year;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(c);}
 const result={version:1,release,startedAt:new Date().toISOString(),groups:0,variants:0,fields:0,groupedVariants:0,privateDescriptions:0,verified:false};
 const jobs=[...groups.values()];let cursor=0;
 await Promise.all(Array.from({length:3},async()=>{for(;;){const group=jobs[cursor++];if(!group)return;const c=group[0],record=await get(`/api/encyclopedia/${c.modelId}?year=${c.year}`);if(record.id!==c.modelId)throw Error('public_model_mismatch');
  const original=source?await source.read(c.modelId):null;
  for(const c of group){const verified=assertPublicVariant(c,record,original);result.groupedVariants+=Number(verified.grouped);result.privateDescriptions+=verified.privateDescriptions;result.fields+=Object.keys(c.fields).length;result.variants++;}result.groups++;
 }}));
 if((await get('/api/health')).releaseSha!==release)throw Error('public_release_changed');
 if(source)await source.verifyUnchanged();
 result.verified=true;result.finishedAt=new Date().toISOString();await fs.mkdir('reports',{recursive:true});await fs.writeFile('reports/encyclopedia-public-release.json',JSON.stringify(result,null,2)+'\n');console.log('PUBLIC_ENCYCLOPEDIA_RELEASE_VERIFIED',JSON.stringify(result));
}
