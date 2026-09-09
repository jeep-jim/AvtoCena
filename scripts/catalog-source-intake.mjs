import fs from 'node:fs/promises';
import path from 'node:path';
import { collectSourcePage, intakeState, intakeSummary } from './lib/catalog-source-intake.mjs';
const market=process.env.CATALOG_INTAKE_MARKET;
if (!['japan','china','korea','uae','europe','georgia'].includes(market)) throw Error('Invalid market');
process.env.CATALOG_REBUILD_MARKET=market;
process.env.CATALOG_IMAGE_STORAGE_MODE='source_urls_only';
const {catalogImportSources}=await import('../apps/web/lib/catalog/importer.ts');
const {REQUIRED_CATALOG_SOURCES}=await import('../apps/web/lib/catalog/required-catalog-sources.ts');
const {sourceListingSnapshot}=await import('../apps/web/lib/catalog/source-listing-snapshot.ts');
const {untranslatedSpecificationFields}=await import('../apps/web/lib/catalog/specification-display.ts');
const {classifySpecificationEvidence}=await import('../apps/web/lib/catalog/specification-evidence-audit.ts');
const directory=`catalog-intake-${market}`;
await fs.mkdir(directory,{recursive:true});
const states=REQUIRED_CATALOG_SOURCES[market].map(required=>intakeState(catalogImportSources.find(s=>s.sourceId===required.sourceId),required));
const startedAt=new Date().toISOString();
let observationWrite = Promise.resolve();
const deadline=Date.now()+Math.min(210*60000,Math.max(60000,Number(process.env.CATALOG_INTAKE_TIME_MS || 40*60000)));
const report={version:1,market,startedAt,productionWrites:false,mode:'source_observations',
  note:'JSONL contains listing and detail revisions. Count unique sourceId + offer.id, not lines. Auction history is not active inventory.'};
async function checkpoint() {
  const value={...report,updatedAt:new Date().toISOString(),sources:states.map(intakeSummary)};
  await fs.writeFile(path.join(directory,'report.tmp'),JSON.stringify(value,null,2));
  await fs.rename(path.join(directory,'report.tmp'),path.join(directory,'report.json'));
}
await checkpoint();
while(Date.now()<deadline && states.some(s=>!s.done)) {
  for(const state of states) {
    await collectSourcePage(state,{market,deadline,maxRows:100000,maxPages:2000,detailConcurrency:4,
      minYear:market==='japan'?2010:new Date().getUTCFullYear()-6,
      snapshot:sourceListingSnapshot,checkpoint,
      translationReport:groups=>untranslatedSpecificationFields(groups),
      specificationReport:offer=>Object.fromEntries(['year','engineCc','powerHp','fuelPowertrain','certifiedPower'].map(field=>[field,classifySpecificationEvidence(offer,field).state])),
      writeObservation:row=>(observationWrite=observationWrite.then(()=>fs.appendFile(path.join(directory,`${state.sourceId}.jsonl`),JSON.stringify(row)+'\n')))});
  }
}
for(const state of states) if(!state.done) {state.done=true;state.stopReason='time_budget';}
report.completedAt=new Date().toISOString();
report.partialSources=states.filter(s=>s.stopReason!=="source_finished").map(s=>({sourceId:s.sourceId,reason:s.stopReason}));
report.qualityStatus=report.partialSources.length?"partial":"configured_routes_finished";
await checkpoint();
console.log(JSON.stringify({...report,sources:states.map(intakeSummary)}));
