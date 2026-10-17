import fs from 'node:fs/promises';
import {getJsonStorage} from '../apps/web/lib/data.ts';
import {requiredCatalogSourceIds} from '../apps/web/lib/catalog/required-catalog-sources.ts';
import {verifyChe168Publication} from './lib/che168-publication-verification.mjs';
import {refreshOutcome} from './lib/catalog-refresh-outcome.mjs';
const runId=process.env.CHE168_VERIFY_RUN_ID;
if(!/^\d+$/.test(runId||''))throw Error('che168_verification_run_invalid');
const publication=JSON.parse(await fs.readFile('che168-verification-input/catalog-weekly-china-publish-report.json','utf8'));
const outcome=JSON.parse(await fs.readFile('che168-verification-input/catalog-refresh-outcome-china.json','utf8'));
const storage=getJsonStorage();
const manifest=await storage.readJson('catalog/manifest.json',null);
const checkpoint=await storage.readJson('catalog/intake-cursors/v1/china.json',null);
const result=verifyChe168Publication({publication,outcome,manifest,checkpoint,runId});
if(process.env.CHE168_RECONCILE_OUTCOME==='1') {
 const key='catalog/operations/markets/china.json',current=await storage.readJsonWithMeta(key,null);
 if(!current.found || !current.etag || String(current.value?.runId)!==runId)throw Error('che168_verification_newer_operation');
 const report=refreshOutcome({market:'china',previous:current.value,intake:result.intake,publication,now:new Date().toISOString(),runId,requiredSourceIds:requiredCatalogSourceIds('china')});
 if(!report.collectionComplete || report.publicationStatus!=='published')throw Error('che168_verification_incomplete');
 await storage.writeJson(key,{...report,verifiedAt:new Date().toISOString(),verificationRunId:process.env.GITHUB_RUN_ID||null},{ifMatch:current.etag});
}
await fs.writeFile('che168-publication-verification.json',JSON.stringify(result.summary,null,2));
console.log(JSON.stringify(result.summary));
