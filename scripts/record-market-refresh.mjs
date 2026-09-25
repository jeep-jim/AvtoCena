import fs from 'node:fs/promises';
import path from 'node:path';
import {getJsonStorage} from '../apps/web/lib/data.ts';
import {refreshOutcome} from './lib/catalog-refresh-outcome.mjs';
const market=process.env.CATALOG_REBUILD_MARKETS;
if(!['china','korea','uae','georgia','europe','japan'].includes(market))throw Error('invalid_refresh_market');
async function optionalJson(file){try{return JSON.parse(await fs.readFile(file,'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}}
const publication=await optionalJson(process.env.CATALOG_REBUILD_PUBLISH_REPORT||`catalog-weekly-${market}-publish-report.json`);
const intake=market==='japan'?null:await optionalJson(path.join(process.env.CATALOG_INTAKE_INPUT_DIR||'catalog-intake-input',`catalog-intake-${market}`,'report.json'));
const storage=getJsonStorage(),key=`catalog/operations/markets/${market}.json`;
const previous=await storage.readJson(key,{});
const report=refreshOutcome({market,previous,intake,publication,now:new Date().toISOString(),runId:process.env.GITHUB_RUN_ID||null});
await storage.writeJson(key,report);
await fs.writeFile(`catalog-refresh-outcome-${market}.json`,JSON.stringify(report,null,2));
console.log(JSON.stringify({market,publicationStatus:report.publicationStatus,collectionComplete:report.collectionComplete,partialSources:report.partialSources}));
if(!report.collectionComplete || report.publicationStatus!=='published'){
 console.error(`catalog_refresh_incomplete:${market}:${report.publicationError||report.partialSources.map(s=>s.sourceId+':'+s.reason).join(',')||'collection_missing'}`);
 process.exitCode=1;
}
