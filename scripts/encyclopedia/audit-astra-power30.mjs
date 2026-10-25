import fs from 'node:fs/promises';
import {getJsonStorage} from '../../apps/web/lib/data.ts';
import {MANIFEST} from '../../apps/web/lib/encyclopedia/records.ts';
import {isEncyclopediaCar} from '../../apps/web/lib/encyclopedia/scope.ts';
import {checksum} from '../../apps/web/lib/encyclopedia/calculation-index.ts';
const storage=getJsonStorage();if(storage.driver!=='object')throw Error('object_required');storage.writeJson=async()=>{throw Error('read_only');};
const manifest=await storage.readJson(MANIFEST,null),rows=manifest.models.filter(isEncyclopediaCar);
const report={version:1,checkedAt:new Date().toISOString(),manifestDigest:checksum(manifest.models.map(x=>[x.id,x.revision,x.key])),models:0,technical:0,power30:0,byMake:{},byDataset:{},anchors:{},examples:[],storageWrites:0};let cursor=0;
await Promise.all(Array.from({length:6},async()=>{for(;;){const summary=rows[cursor++];if(!summary)return;const r=await storage.readJson(summary.key,null);if(r?.revision!==summary.revision||r.id!==summary.id)throw Error('revision_changed');report.models++;
 for(const v of r.variants||[]){if(!v.astraEvidence)continue;report.technical++;if(!(Number(v.power30MinKw)>0))continue;report.power30++;
 const make=report.byMake[r.make]||={technicalPower30:0,models:[],examples:[]};make.technicalPower30++;if(!make.models.includes(r.model))make.models.push(r.model);
 const ds=v.astraEvidence.sourceDataset;report.byDataset[ds]=(report.byDataset[ds]||0)+1;
 for(const f of ['engineCode','chassisCode','powerKw','powerHp','icePowerKw','motorPeakKw','fuel','powertrainKind','engineCc','drive','transmission','bodyType','batteryKwh'])if(v[f]!=null&&v[f]!==''&&v[f]!==0)report.anchors[f]=(report.anchors[f]||0)+1;
 if(make.examples.length<2)make.examples.push({make:r.make,model:r.model,trim:v.trim,year:v.year,identity:v.astraIdentity,values:v.astraEvidence.values,sourceDataset:ds,sourceUrl:v.astraEvidence.sourceUrl,corpusDigest:v.astraEvidence.corpusDigest,manufactureYears:v.astraEvidence.manufactureYears});
 }
 if(report.models%500===0)console.log('ASTRA_POWER30_PROGRESS',JSON.stringify({models:report.models,power30:report.power30}));
}}));
if(checksum((await storage.readJson(MANIFEST,null)).models.map(x=>[x.id,x.revision,x.key]))!==report.manifestDigest)throw Error('manifest_changed');
await fs.mkdir('reports',{recursive:true});await fs.writeFile('reports/power30-blockers.json',JSON.stringify(report,null,2));console.log('ASTRA_POWER30_AUDIT',JSON.stringify(report));
