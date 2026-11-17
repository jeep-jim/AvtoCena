import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile, execFileSync} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {PREPARED_MARKETS, budgetManifestMarkets, readLiveBudgetIdentity, assertBudgetReadinessReport,
  stagedBudgetDigest, stagedBudgetWriteAllowed, assertStagedBudgetSupplementWrite} from './lib/catalog-staged-budget.mjs';
import {restoreReleaseEncyclopedia} from './encyclopedia/restore-calculation-index.mjs';
import {collectPreparedBudgetReadiness, installStagedBudgetNetworkFence} from './catalog-staged-budget-child.mjs';

const SHA=/^[a-f0-9]{40}$/, DIGEST=/^[a-f0-9]{64}$/, GENERATION=/^gen_\d+_[a-z0-9]+$/;
const script=fileURLToPath(import.meta.url), run=promisify(execFile);

export function activeBudgetInputs(env=process.env) {
  const mode=env.CATALOG_ACTIVE_BUDGET_MODE;
  const expectedLiveRelease=env.CATALOG_EXPECTED_LIVE_RELEASE, expectedGeneration=env.CATALOG_EXPECTED_GENERATION;
  if(!['live','candidate-isolated'].includes(mode)||!SHA.test(expectedLiveRelease||'')||!GENERATION.test(expectedGeneration||'')) {
    throw Error('active_budget_inputs_invalid');
  }
  const candidateRelease=env.CATALOG_CANDIDATE_RELEASE||'', candidateCalculationVersion=env.CATALOG_CANDIDATE_CALCULATION_VERSION||'';
  const candidateEncyclopediaDigest=env.CATALOG_CANDIDATE_ENCYCLOPEDIA_DIGEST||'';
  if(mode==='live'&&(candidateRelease||candidateCalculationVersion||candidateEncyclopediaDigest))throw Error('active_budget_candidate_inputs_forbidden');
  if(mode==='candidate-isolated'&&(!SHA.test(candidateRelease)||candidateRelease===expectedLiveRelease
      ||!DIGEST.test(candidateCalculationVersion)||!DIGEST.test(candidateEncyclopediaDigest)))throw Error('active_budget_candidate_binding_required');
  return {mode,expectedLiveRelease,expectedGeneration,release:mode==='live'?expectedLiveRelease:candidateRelease,
    candidateCalculationVersion,candidateEncyclopediaDigest};
}

function assertFreeLease(meta, now=Date.now()) {
  if(meta?.found!==true)return;
  if(!meta.etag||!meta.value||typeof meta.value!=='object')throw Error('active_budget_lock_invalid');
  const until=meta.value.lockedUntil;
  if(until==='')return;
  if(!Number.isFinite(Date.parse(until)))throw Error('active_budget_lock_invalid');
  if(Date.parse(until)>now)throw Error('active_budget_writer_busy');
}

export function assertActiveBudgetState(context, manifest, lock, now=Date.now()) {
  if(!['live','candidate-isolated','candidate-prepare'].includes(context?.mode)||!SHA.test(context.release||'')||!DIGEST.test(context.calculationVersion||'')
      ||!SHA.test(context.liveIdentity?.release||'')||!DIGEST.test(context.liveIdentity?.calculationVersion||''))throw Error('active_budget_context_invalid');
  budgetManifestMarkets(context.manifest);
  if(!manifest.found||manifest.etag!==context.manifestEtag||manifest.value?.generationId!==context.manifest.generationId
      ||stagedBudgetDigest(manifest.value)!==stagedBudgetDigest(context.manifest))throw Error('active_budget_manifest_changed');
  assertFreeLease(lock,now);
  if(lock.found!==context.lockRevision.found||(lock.etag||null)!==context.lockRevision.etag)throw Error('active_budget_writer_revision_changed');
}

export async function verifyActiveBudgetAuthority(context, storage, readIdentity=readLiveBudgetIdentity) {
  const [manifest,lock,identity]=await Promise.all([storage.readJsonWithMeta('catalog/manifest.json',null),
    storage.readJsonWithMeta('catalog/import-lock.json',null),readIdentity()]);
  assertActiveBudgetState(context,manifest,lock);
  if(identity.release!==context.liveIdentity.release||identity.calculationVersion!==context.liveIdentity.calculationVersion) {
    throw Error('active_budget_live_identity_changed');
  }
  // A candidate has an independently pinned source/calculator. It is never
  // substituted into the installed calculator identity or called live-ready.
  if(context.mode==='live'&&(context.release!==identity.release||context.calculationVersion!==identity.calculationVersion)) {
    throw Error('active_budget_live_calculation_mismatch');
  }
}

export async function restoreCandidateEncyclopedia(storage, root, digest) {
  if(!DIGEST.test(digest||''))throw Error('active_budget_candidate_encyclopedia_required');
  const index=await storage.readJson(`knowledge/encyclopedia/calculation-indexes/${digest}.json`,null);
  if(index?.version!==1||index.digest!==digest||stagedBudgetDigest(index.models)!==digest)throw Error('active_budget_candidate_encyclopedia_invalid');
  const filename=path.join(root,'data/knowledge/encyclopedia/calculation-v1.json');
  await fs.mkdir(path.dirname(filename),{recursive:true});await fs.writeFile(filename,JSON.stringify(index));
  return digest;
}

/** Actual active manifest, no generation overlay. Candidate data is confined to
 * a local derived-object overlay shared by its prepare and fresh verify child. */
export function installActiveBudgetStorage(storage, context, phase, isolatedDirectory, ConflictError) {
  if(!['prepare','verify'].includes(phase)||!['live','candidate-isolated'].includes(context.mode))throw Error('active_budget_mode_invalid');
  if(context.mode==='candidate-isolated'&&!isolatedDirectory)throw Error('active_budget_isolation_required');
  const read=storage.readJsonWithMeta.bind(storage), write=storage.writeJson.bind(storage);
  const checkState=async()=>{
    const [manifest,lock]=await Promise.all([read('catalog/manifest.json',null),read('catalog/import-lock.json',null)]);
    assertActiveBudgetState(context,manifest,lock);
  };
  const localMeta=async key=>{
    try{
      const body=await fs.readFile(path.join(isolatedDirectory,key),'utf8');
      return {found:true,etag:'"'+stagedBudgetDigest(body)+'"',value:JSON.parse(body)};
    }catch(error){if(error.code==='ENOENT')return null;throw error;}
  };
  storage.readJsonWithMeta=async(key,fallback,previous)=>{
    if(key==='catalog/manifest.json'||key==='catalog/import-lock.json'){
      await checkState();return read(key,fallback);
    }
    if(context.mode==='candidate-isolated'&&stagedBudgetWriteAllowed(key,context)){
      const local=await localMeta(key);if(local)return local;
    }
    return read(key,fallback,previous);
  };
  storage.readJson=async(key,fallback)=>(await storage.readJsonWithMeta(key,fallback)).value;
  storage.writeJson=async(key,value,condition)=>{
    if(phase!=='prepare'||!stagedBudgetWriteAllowed(key,context))throw Error('active_budget_write_forbidden');
    assertStagedBudgetSupplementWrite(key,value,condition,context);
    await checkState();
    if(context.mode==='live')return write(key,value,condition);
    const previous=await localMeta(key);
    // Candidate paths use a fresh local namespace. Preserve CAS against a local
    // winner; an unchanged remote derivation may seed the first local replacement.
    const current=previous||await read(key,null);
    if(condition?.ifNoneMatch==='*'&&current.found||condition?.ifMatch&&condition.ifMatch!==current.etag)throw new ConflictError();
    const filename=path.join(isolatedDirectory,key);await fs.mkdir(path.dirname(filename),{recursive:true});
    const body=JSON.stringify(value),temporary=filename+'.'+process.pid+'.tmp';
    await fs.writeFile(temporary,body);
    if(condition?.ifNoneMatch==='*'){
      try{await fs.link(temporary,filename);}catch(error){if(error.code==='EEXIST')throw new ConflictError();throw error;}
      finally{await fs.rm(temporary,{force:true});}
    }else await fs.rename(temporary,filename);
  };
  for(const name of ['putBinary','deleteJson','deleteBinary','deleteObjects','deletePrefix','abortMultipartUpload']) {
    if(typeof storage[name]==='function')storage[name]=async()=>{throw Error('active_budget_write_forbidden');};
  }
  return checkState;
}

async function child(phase,root,contextPath,reportPath,isolatedDirectory) {
  const context=JSON.parse(await fs.readFile(contextPath,'utf8'));
  installStagedBudgetNetworkFence(process.env.YC_OBJECT_STORAGE_ENDPOINT,globalThis.fetch,context.mode==='live'&&phase==='prepare');
  const {getJsonStorage,StorageConflictError}=await import(pathToFileURL(path.join(root,'apps/web/lib/data.ts')).href);
  const storage=getJsonStorage();if(storage.driver!=='object')throw Error('object_storage_required');
  const check=installActiveBudgetStorage(storage,context,phase,isolatedDirectory,StorageConflictError);
  await check();
  await collectPreparedBudgetReadiness({mode:phase,root,context,reportPath,storage});
  await check();
}

export async function runActiveBudgetCheck(root, env=process.env) {
  const inputs=activeBudgetInputs(env);
  const assertSource=()=>{
    if(execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim()!==inputs.release
        ||execFileSync('git',['status','--porcelain','--untracked-files=no'],{cwd:root,encoding:'utf8'}).trim())throw Error('active_budget_source_changed');
  };
  assertSource();
  const {getJsonStorage}=await import(pathToFileURL(path.join(root,'apps/web/lib/data.ts')).href);
  const storage=getJsonStorage();if(storage.driver!=='object')throw Error('object_storage_required');
  const [identity,manifest,lock]=await Promise.all([readLiveBudgetIdentity(),storage.readJsonWithMeta('catalog/manifest.json',null),
    storage.readJsonWithMeta('catalog/import-lock.json',null)]);
  if(identity.release!==inputs.expectedLiveRelease||manifest.value?.generationId!==inputs.expectedGeneration||!manifest.etag)throw Error('active_budget_initial_binding_changed');
  assertFreeLease(lock);
  const {calculationVersion}=await import(pathToFileURL(path.join(root,'scripts/catalog-calculation-version.mjs')).href);
  const calculator=calculationVersion(root);
  if(inputs.mode==='live'&&calculator!==identity.calculationVersion)throw Error('active_budget_live_calculation_mismatch');
  if(inputs.mode==='candidate-isolated'&&calculator!==inputs.candidateCalculationVersion)throw Error('active_budget_candidate_calculation_mismatch');
  const context={version:1,mode:inputs.mode,release:inputs.release,calculationVersion:calculator,liveIdentity:identity,
    manifest:manifest.value,manifestEtag:manifest.etag,lockRevision:{found:lock.found,etag:lock.etag||null}};
  await verifyActiveBudgetAuthority(context,storage);
  context.encyclopediaDigest=inputs.mode==='live'?await restoreReleaseEncyclopedia(storage,root,inputs.release)
    :await restoreCandidateEncyclopedia(storage,root,inputs.candidateEncyclopediaDigest);
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'catalog-active-budget-'));
  const contextPath=path.join(directory,'context.json'),reportPath=path.join(directory,'readiness.json'),isolated=path.join(directory,'derived');
  await fs.writeFile(contextPath,JSON.stringify(context));
  const invoke=async phase=>{
    assertSource();
    await verifyActiveBudgetAuthority(context,storage);
    const {stdout}=await run(process.execPath,['--import','tsx',script,'--child',phase,root,contextPath,reportPath,isolated],{
      cwd:root,env:{...env,AVTOCENA_RELEASE_SHA:context.release,AVTOCENA_CALCULATION_VERSION:calculator},timeout:120*60_000,maxBuffer:1024*1024});
    if(stdout.trim())console.log(stdout.trim());
    assertSource();
    await verifyActiveBudgetAuthority(context,storage);
    return JSON.parse(await fs.readFile(reportPath,'utf8'));
  };
  try{
    const prepared=await invoke('prepare');assertBudgetReadinessReport(prepared,context);
    const verified=await invoke('verify');assertBudgetReadinessReport(verified,context,prepared);
    const report={...verified,scope:inputs.mode==='live'?'installed_runtime_on_active_generation':'candidate_runtime_isolated_on_active_generation',
      published:false,installedRuntime:inputs.mode==='live',liveReady:false,productionDerivedWrites:inputs.mode==='live',
      candidateIsolated:inputs.mode==='candidate-isolated',liveIdentity:identity,manifestEtag:context.manifestEtag,
      checkedAt:new Date().toISOString(),
      marketCoverage:Object.fromEntries(PREPARED_MARKETS.map(market=>[market,verified.markets[market]?
        {status:'verified_saved_prices',sourceRows:verified.markets[market].sourceRows}:
        {status:'empty_in_active_manifest',sourceRows:0}])),
      rateAuthority:'exact_runtime_on_worker_with_shared_stored_inputs_and_CBR_access',
      productionProcessFingerprintVerified:false};
    await fs.writeFile(path.join(root,'catalog-active-budget-report.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify({scope:report.scope,generationId:report.generationId,release:report.release,verified:true,
      productionDerivedWrites:report.productionDerivedWrites,productionProcessFingerprintVerified:false}));
    return report;
  }finally{await fs.rm(directory,{recursive:true,force:true});}
}

if(process.argv[1]&&path.resolve(process.argv[1])===script){
  const task=process.argv[2]==='--child'?child(...process.argv.slice(3)):runActiveBudgetCheck(path.resolve(process.argv[2]||'.'));
  task.catch(error=>{console.error(error?.message||'active_budget_check_failed');process.exitCode=1;});
}
