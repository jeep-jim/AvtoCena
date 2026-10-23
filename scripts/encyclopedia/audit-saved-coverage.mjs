import fs from 'node:fs/promises';
import {getJsonStorage} from '../../apps/web/lib/data.ts';
import {MANIFEST} from '../../apps/web/lib/encyclopedia/records.ts';
import {isEncyclopediaCar} from '../../apps/web/lib/encyclopedia/scope.ts';
import {checksum} from '../../apps/web/lib/encyclopedia/calculation-index.ts';
import {modelCoverage,summarizeCoverage} from './coverage.mjs';

// Read only: reuse a verified immutable index, never compile or publish again.
const marker=JSON.parse(await fs.readFile('.github/market-runs/regcloud-publication-status.json','utf8'));
const {release,indexDigest}=marker.auditSavedCoverage||{};
if(!/^[a-f0-9]{40}$/.test(release||'')||!/^[a-f0-9]{64}$/.test(indexDigest||''))throw Error('invalid_coverage_target');
const storage=getJsonStorage();
storage.writeJson=async()=>{throw Error('coverage_audit_is_read_only');};
const binding=await storage.readJson(`knowledge/encyclopedia/calculation-releases/${release}.json`,null);
const key=`knowledge/encyclopedia/calculation-indexes/${indexDigest}.json`;
if(binding?.release!==release||binding.digest!==indexDigest||binding.key!==key)throw Error('coverage_binding_mismatch');
const index=await storage.readJson(key,null);
if(index?.digest!==indexDigest||checksum(index.models)!==indexDigest)throw Error('coverage_index_checksum');
const manifest=await storage.readJson(MANIFEST,null);
if(!manifest?.models?.length||checksum(manifest.models.map(x=>[x.id,x.revision,x.key]))!==index.manifestDigest)throw Error('coverage_snapshot_changed');
const factsByModel=new Map();
for(const fact of Object.values(index.models).flat()){
 const rows=factsByModel.get(fact.modelId)||[];rows.push(fact);factsByModel.set(fact.modelId,rows);
}
const models=manifest.models.filter(isEncyclopediaCar),coverage=[];let cursor=0;
await Promise.all(Array.from({length:6},async()=>{
 for(;;){
  const summary=models[cursor++];if(!summary)return;
  const record=await storage.readJson(summary.key,null),facts=factsByModel.get(summary.id)||[];
  if(record?.id!==summary.id||record.revision!==summary.revision||facts.some(f=>f.revision!==record.revision))throw Error('coverage_record_revision');
  coverage.push(modelCoverage(record,facts));
 }
}));
const report=summarizeCoverage(coverage,{createdAt:new Date().toISOString(),indexCreatedAt:index.createdAt,indexDigest,manifestDigest:index.manifestDigest,release,activationConfirmed:false,snapshotOnly:true});
await fs.mkdir('reports',{recursive:true});
await fs.writeFile('reports/encyclopedia-coverage.json',JSON.stringify(report,null,2));
console.log('SAVED_ENCYCLOPEDIA_COVERAGE',JSON.stringify({indexDigest,...report.total,storageWrites:0}));
