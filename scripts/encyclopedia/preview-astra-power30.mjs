import fs from 'node:fs/promises';
import {getJsonStorage} from '../../apps/web/lib/data.ts';
import {MANIFEST} from '../../apps/web/lib/encyclopedia/records.ts';
import {isEncyclopediaCar} from '../../apps/web/lib/encyclopedia/scope.ts';
import {modelKey,checksum} from '../../apps/web/lib/encyclopedia/calculation-index.ts';
import {compileAstraPower30Facts,matchAstraPower30,applyAstraPower30} from '../../apps/web/lib/encyclopedia/astra-power30.ts';
import {safePublicPricing} from '../../apps/web/lib/catalog/safe-public-pricing.ts';
import {readCurrentPublicCatalogProjection} from '../../apps/web/lib/catalog/storage.ts';
const storage=getJsonStorage();if(storage.driver!=='object')throw Error('object_required');storage.writeJson=async()=>{throw Error('read_only');};
const manifest=await storage.readJson(MANIFEST,null),rows=manifest.models.filter(isEncyclopediaCar),references={},annual=[];
const manifestDigest=checksum(manifest.models.map(x=>[x.id,x.revision,x.key]));
const report={version:1,checkedAt:new Date().toISOString(),manifestDigest,modelsRead:0,referenceModels:0,referenceRows:0,certifiedValues:0,annual:{checked:0,existing:0,matched:0,reasons:{},examples:[]},catalog:{checked:0,existing:0,matched:0,retainedAfterSafety:0,byMarket:{},reasons:{},examples:[]},japanSaved:{checked:0,matched:0,reasons:{}},storageWrites:0};
const inc=(o,k)=>o[k]=(o[k]||0)+1;let cursor=0;
await Promise.all(Array.from({length:6},async()=>{for(;;){const summary=rows[cursor++];if(!summary)return;const r=await storage.readJson(summary.key,null);if(r?.revision!==summary.revision||r.id!==summary.id)throw Error('revision_changed');
 const facts=compileAstraPower30Facts(r),key=modelKey(r.make,r.model);if(facts.length)references[key]=[...(references[key]||[]),...facts];
 for(const v of r.variants||[])if(Number.isInteger(v.year)&&['electric','hybrid'].includes(v.fuel))annual.push({id:v.id,make:r.make,model:r.model,...v});
 report.modelsRead++;if(report.modelsRead%500===0)console.log('ASTRA30_PREVIEW_PROGRESS',JSON.stringify({models:report.modelsRead}));
}}));
report.referenceModels=Object.keys(references).length;report.referenceRows=Object.values(references).reduce((n,a)=>n+a.length,0);report.certifiedValues=Object.values(references).flat().filter(f=>f.values.power30MinKw>0).length;
const digest=checksum(references);
for(const v of annual){report.annual.checked++;if(v.power30MinKw>0){report.annual.existing++;continue;}const result=matchAstraPower30(v,references[modelKey(v.make,v.model)]||[]);inc(report.annual.reasons,result.reason);if(result.value){report.annual.matched++;if(report.annual.examples.length<30)report.annual.examples.push({make:v.make,model:v.model,year:v.year,variantId:v.id,value:result.value,method:result.method});}}
console.log('ASTRA30_ANNUAL_PREVIEW',JSON.stringify({...report.annual,examples:undefined}));
const projection=await readCurrentPublicCatalogProjection();report.generationId=projection.generationId;
for(const o of projection.rows){if(!['electric','hybrid'].includes(o.fuel))continue;report.catalog.checked++;if(o.power30MinKw>0){report.catalog.existing++;continue;}const facts=references[modelKey(o.make,o.model)]||[],result=matchAstraPower30(o,facts);inc(report.catalog.reasons,result.reason);if(result.value){report.catalog.matched++;inc(report.catalog.byMarket,o.market);const applied=applyAstraPower30(o,facts,digest),safe=safePublicPricing(applied);if(safe.power30MinKw===result.value)report.catalog.retainedAfterSafety++;if(report.catalog.examples.length<40)report.catalog.examples.push({make:o.make,model:o.model,year:o.year,market:o.market,value:result.value,method:result.method,safetyRetained:safe.power30MinKw===result.value});}}
const ids=new Set();
for(let start=0;start<128;start+=8){const slots=await Promise.all(Array.from({length:8},(_,i)=>storage.readJson(`catalog/partner-cache/ajes/queries/${start+i}.json`,null)));for(const slot of slots)for(const lot of slot?.value?.items||[]){if(lot.table!=='stats'||ids.has(lot.id))continue;ids.add(lot.id);report.japanSaved.checked++;
 const fuel=({H:'hybrid',HE:'hybrid',E:'electric'})[lot.sourceFuel?.toUpperCase()];if(!fuel)continue;
 const o={id:'ajes-stats-'+lot.id,market:'japan',make:lot.make,model:lot.model,year:lot.year,trim:lot.trim,chassisCode:lot.chassisCode,fuel,engineCc:lot.engineCc,powerHp:/^\d+(\.\d+)?$/.test(lot.sourcePower)?Number(lot.sourcePower):undefined,drive:({FF:'fwd',FR:'rwd','4WD':'awd',AWD:'awd'})[lot.sourceDrive]};
 const result=matchAstraPower30(o,references[modelKey(o.make,o.model)]||[]);inc(report.japanSaved.reasons,result.reason);if(result.value)report.japanSaved.matched++;
}}
if(checksum((await storage.readJson(MANIFEST,null)).models.map(x=>[x.id,x.revision,x.key]))!==manifestDigest)throw Error('manifest_changed');
await fs.mkdir('reports',{recursive:true});await fs.writeFile('reports/power30-blockers.json',JSON.stringify(report,null,2));console.log('ASTRA_POWER30_MATCH_PREVIEW',JSON.stringify(report));
