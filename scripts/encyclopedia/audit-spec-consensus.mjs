import fs from 'node:fs/promises';
import {getJsonStorage} from '../../apps/web/lib/data.ts';
import {MANIFEST} from '../../apps/web/lib/encyclopedia/records.ts';
import {checksum} from '../../apps/web/lib/encyclopedia/calculation-index.ts';
import {isEncyclopediaCar} from '../../apps/web/lib/encyclopedia/scope.ts';
const store=getJsonStorage();if(store.driver!=='object')throw Error('object_required');store.writeJson=async()=>{throw Error('read_only');};
const manifest=await store.readJson(MANIFEST,null),identity=m=>checksum(m.models.map(x=>[x.id,x.revision,x.key]));
const norm=x=>String(x??'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
const canonical=(field,x)=>{const t=norm(x);return (field==='powertrainKind'?{hev:'otherhybrid',phev:'otherhybrid',erev:'serieshybrid',bev:'electric'}:field==='drive'?{'4wd':'awd','4x4':'awd'}:field==='transmission'?{at:'automatic',mt:'manual'}:{})[t]||t;};
const power=x=>Number(x.powerKw)||Number(x.powerHp)*.73549875;
function compatible(v,d){return ['fuel','powertrainKind','drive','bodyType','transmission','engineCode'].every(f=>!v[f]||!d[f]||canonical(f,v[f])===canonical(f,d[f]))&&(!v.engineCc||!d.engineCc||Number(v.engineCc)===Number(d.engineCc))&&(!power(v)||!power(d)||Math.abs(power(v)-power(d))<=.75);}
function strong(v,d){return ['fuel','powertrainKind','drive','bodyType'].every(f=>v[f]&&d[f]&&canonical(f,v[f])===canonical(f,d[f]))&&power(v)>0&&power(d)>0&&Math.abs(power(v)-power(d))<=.75&&(canonical('powertrainKind',v.powertrainKind)==='electric'||Number(v.engineCc)>0&&Number(v.engineCc)===Number(d.engineCc));}
const report={checkedAt:new Date().toISOString(),models:0,annualElectrified:0,missingPower30:0,matchingTechnicalCandidates:0,unanimousPower30Candidates:0,conflictingOrIncomplete:0,noStrongCandidate:0,candidates:[],scope:'Shadow proposals from retained specifications only; no certified transfer or calculated-price claim.',storageWrites:0};
let cursor=0;const models=manifest.models.filter(isEncyclopediaCar);
await Promise.all(Array.from({length:6},async()=>{for(;;){const m=models[cursor++];if(!m)return;const r=await store.readJson(m.key,null);if(r?.revision!==m.revision)throw Error('revision_changed');report.models++;const donors=r.variants.filter(v=>v.astraEvidence);
for(const v of r.variants){if(!Number.isInteger(v.year)||!['electric','serieshybrid','otherhybrid'].includes(canonical('powertrainKind',v.powertrainKind)))continue;report.annualElectrified++;if(Number(v.power30MinKw)>0)continue;report.missingPower30++;const pool=donors.filter(d=>compatible(v,d));if(!pool.some(d=>strong(v,d))){report.noStrongCandidate++;continue;}report.matchingTechnicalCandidates++;const vals=pool.map(d=>Number(d.power30MinKw));if(vals.some(x=>!x)||!vals.every(x=>x===vals[0])){report.conflictingOrIncomplete++;continue;}report.unanimousPower30Candidates++;
report.candidates.push({modelId:r.id,revision:r.revision,variantId:v.id,make:r.make,model:r.model,year:v.year,trim:v.trim,power30MinKw:vals[0],candidateCount:pool.length,engineCodeMatched:Boolean(v.engineCode&&pool.every(d=>canonical('engineCode',v.engineCode)===canonical('engineCode',d.engineCode))),donorIds:pool.map(d=>d.id),parameters:Object.fromEntries(['fuel','powertrainKind','drive','bodyType','engineCc','powerKw','powerHp','transmission'].map(f=>[f,v[f]]))});}
}}));
report.manifestUnchanged=identity(manifest)===identity(await store.readJson(MANIFEST,null));if(!report.manifestUnchanged)throw Error('manifest_changed');
await fs.mkdir('reports',{recursive:true});await fs.writeFile('reports/spec-consensus.json',JSON.stringify(report,null,2));console.log('SPEC_CONSENSUS',JSON.stringify({...report,candidates:report.candidates.slice(0,12)}));
