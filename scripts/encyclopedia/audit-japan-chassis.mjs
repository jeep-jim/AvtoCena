import fs from 'node:fs/promises';
import {getJsonStorage} from '../../apps/web/lib/data.ts';
import {MANIFEST} from '../../apps/web/lib/encyclopedia/records.ts';
import {digest} from './research-batch.mjs';
const store=getJsonStorage();if(store.driver!=='object')throw Error('object_required');store.writeJson=async()=>{throw Error('read_only');};
const manifest=await store.readJson(MANIFEST,null);if(!manifest?.models?.length)throw Error('manifest_required');
const norm=x=>String(x||'').normalize('NFKC').trim().toUpperCase();
const code=x=>norm(x).replace(/^(?:E|GF|TA|ABA|CBA|DBA|DAA|DLA|3BA|4BA|5BA|5AA|6AA|6LA|7BA|ZAA)-/,'');
const groups=new Map();const targets=[];let cursor=0,read=0;
function add(make,model,chassis,year,source,drive){const c=code(chassis);if(!c)return;const key=JSON.stringify([norm(make),norm(model),c]);const g=groups.get(key)||{make,model,chassisCode:c,rawCodes:new Set(),years:new Set(),sources:new Set(),drives:new Set(),observations:0};g.rawCodes.add(norm(chassis));if(year)g.years.add(year);g.sources.add(source);if(drive)g.drives.add(drive);g.observations++;groups.set(key,g);}
await Promise.all(Array.from({length:6},async()=>{for(;;){const m=manifest.models[cursor++];if(!m)return;const r=await store.readJson(m.key,null);if(r?.id!==m.id||r.revision!==m.revision)throw Error('record_changed');for(const v of r.variants||[]){if(!v.chassisCode)continue;add(r.make,r.model,v.chassisCode,v.year,'encyclopedia',v.drive);targets.push({modelId:r.id,variantId:v.id,revision:r.revision,make:r.make,model:r.model,year:v.year,trim:v.trim,chassisCode:v.chassisCode,drive:v.drive,status:v.status,expectedDigest:digest(v),engineCode:v.engineCode,engineCc:v.engineCc,fuel:v.fuel});}if(++read%500===0)console.log('CHASSIS_MODELS_READ',read);}}));
for(let start=0;start<128;start+=8){const slots=await Promise.all(Array.from({length:8},(_,i)=>store.readJson(`catalog/partner-cache/ajes/queries/${start+i}.json`,null)));for(const s of slots)for(const lot of s?.value?.items||[])if(lot.table==='stats')add(lot.make,lot.model,lot.chassisCode,lot.year,'saved_japan_feed',lot.sourceDrive);}
const green=await store.readJson('catalog/green-corner/current.json',null);for(const row of green?.items||[])add(row.make,row.model,row.chassisCode||row.operational?.chassisCode,row.year,'green_corner',row.drive);
const after=await store.readJson(MANIFEST,null);if(digest(after.models)!==digest(manifest.models))throw Error('manifest_changed');
const out='reports/japan-chassis';await fs.mkdir(out,{recursive:true});
const rows=[...groups.values()].map(g=>({...g,rawCodes:[...g.rawCodes].sort(),years:[...g.years].sort(),sources:[...g.sources].sort(),drives:[...g.drives].sort()})).sort((a,b)=>JSON.stringify([a.make,a.model,a.chassisCode]).localeCompare(JSON.stringify([b.make,b.model,b.chassisCode])));
const parts={};for(const [name,values] of [['codes',rows],['targets',targets]]){parts[name]=[];for(let i=0;i<values.length;i+=500){const path=`${name}-${String(i/500).padStart(4,'0')}.json`;const chunk=values.slice(i,i+500);await fs.writeFile(`${out}/${path}`,JSON.stringify(chunk));parts[name].push({path,rows:chunk.length});}}
const summary={version:1,createdAt:new Date().toISOString(),modelsRead:read,groups:rows.length,uniqueCodes:new Set(rows.map(r=>r.chassisCode)).size,variantTargets:targets.length,missingDrive:targets.filter(r=>!r.drive).length,parts,storageWrites:0,supplierRequests:0};await fs.writeFile(`${out}/manifest.json`,JSON.stringify(summary,null,2));console.log('CHASSIS_INVENTORY',JSON.stringify({...summary,parts:undefined}));
