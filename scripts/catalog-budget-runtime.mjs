import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';

export async function liveBudgetRelease(fetchImpl=fetch) {
  const response=await fetchImpl('https://avtocena.com/api/health',{
    headers:{accept:'application/json','cache-control':'no-cache'},redirect:'error',signal:AbortSignal.timeout(20000),
  });
  if(!response.ok)throw Error('budget_live_health_http_'+response.status);
  const value=await response.json();
  if(value.ok!==true || !/^[a-f0-9]{40}$/.test(value.releaseSha||''))throw Error('budget_live_release_invalid');
  return value.releaseSha;
}

export function budgetPreparationDecision(manifest,lock,now=Date.now()) {
  if(!/^gen_[a-zA-Z0-9_-]+$/.test(manifest?.generationId||''))throw Error('budget_generation_missing');
  if(lock && lock.lockedUntil!=='' && !Number.isFinite(Date.parse(lock.lockedUntil)))throw Error('budget_lock_invalid');
  return {generationId:manifest.generationId,skip:!!lock && Date.parse(lock.lockedUntil)>now};
}

export async function verifyBudgetContext({release,generationId,readState,readRelease}) {
  const [state,actualRelease]=await Promise.all([readState(),readRelease()]);
  if(actualRelease!==release)throw Error('budget_live_release_changed');
  const decision=budgetPreparationDecision(state.manifest,state.lock);
  if(decision.skip || decision.generationId!==generationId)throw Error('budget_publication_changed');
}

export function budgetReadyKey(release,generationId,fingerprints,selectorVersion){
  return createHash('sha256').update(JSON.stringify({release,generationId,fingerprints,selectorVersion})).digest('hex');
}
export function budgetAlreadyReady(saved,key,now=Date.now()){
  return saved?.version===1 && saved.verified===true && saved.key===key && Number.isFinite(saved.at) && saved.at<=now && now-saved.at<20*3600000;
}
async function main(){
  if(process.argv[2]==='--resolve'){
    const release=await liveBudgetRelease();
    if(!process.env.GITHUB_OUTPUT)throw Error('github_output_required');
    await fs.appendFile(process.env.GITHUB_OUTPUT,`release=${release}\n`);
    console.log(JSON.stringify({release,authority:'production_health'}));return;
  }
  const root=path.resolve(process.argv[2]||'.'),release=process.env.AVTOCENA_RELEASE_SHA;
  if(!/^[a-f0-9]{40}$/.test(release||''))throw Error('budget_expected_release_required');
  const {getJsonStorage}=await import(pathToFileURL(path.join(root,'apps/web/lib/data.ts')).href);
  const storage=getJsonStorage();
  if(storage.driver!=='object')throw Error('object_storage_required');
  const readState=async()=>{
    const [manifest,lock]=await Promise.all([storage.readJson('catalog/manifest.json',null),storage.readJson('catalog/import-lock.json',null)]);
    return {manifest,lock};
  };
  const {manifest,lock}=await readState(),decision=budgetPreparationDecision(manifest,lock);
  const report={at:new Date().toISOString(),release,generationId:decision.generationId,skipped:decision.skip,verified:false};
  try{
    if(decision.skip){report.reason='publication_in_progress';throw Error('budget_preparation_deferred_active_publisher');}
    const context={release,generationId:decision.generationId,readState,readRelease:liveBudgetRelease};
    await verifyBudgetContext(context);
    const {budgetPricingFingerprint}=await import(pathToFileURL(path.join(root,'apps/web/lib/catalog/shared-budget-prices.ts')).href);
    const selectorVersion=await fs.access(path.join(root,'apps/web/lib/catalog/budget-selector-codec.ts')).then(()=>2,()=>1);
    const fingerprint=async()=>Object.fromEntries(await Promise.all(['china','korea','uae','europe','georgia'].map(async market=>[market,await budgetPricingFingerprint(market)])));
    const expected=await fingerprint(),readyKey=budgetReadyKey(release,decision.generationId,expected,selectorVersion),readyPath='catalog/operations/budget-preparation-v1.json';
    if(budgetAlreadyReady(await storage.readJson(readyPath,null),readyKey)){
      report.skipped=true;report.verified=true;report.reason='already_prepared_for_current_context';return;
    }
    // Run the exact deployed calculator and its existing independent cold-process
    // parity probes. That script permits only disposable cache/selector writes.
    await new Promise((resolve,reject)=>{
      const child=spawn(process.execPath,['--import','tsx','scripts/catalog-budget-shared-warmup.mjs'],{cwd:root,stdio:'inherit',env:process.env});
      child.on('error',reject);child.on('exit',(code,signal)=>code===0?resolve():reject(Error('budget_warmup_failed_'+(code??signal))));
    });
    await verifyBudgetContext(context);
    const result=JSON.parse(await fs.readFile(path.join(root,'catalog-budget-shared-report.json'),'utf8'));
    if(result.release!==release || result.warmed?.generationId!==decision.generationId)throw Error('budget_warmup_report_mismatch');
    if(budgetReadyKey(release,decision.generationId,await fingerprint(),selectorVersion)!==readyKey)throw Error('budget_context_changed_after_warmup');
    await storage.writeJson(readyPath,{version:1,verified:true,key:readyKey,at:Date.now(),release,generationId:decision.generationId,selectorVersion});
    report.verified=true;
  }catch(error){report.error=String(error.message);throw error;}
  finally{
    await fs.writeFile(path.join(root,'catalog-budget-runtime-report.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify(report));
  }
}
if(path.basename(process.argv[1]||'')==='catalog-budget-runtime.mjs')main().catch(error=>{console.error(error.message);process.exitCode=1;});
