import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile,execFileSync} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {assertActiveBudgetState,verifyActiveBudgetAuthority,restoreCandidateEncyclopedia} from './catalog-active-budget-check.mjs';
import {collectPreparedBudgetReadiness,installStagedBudgetNetworkFence} from './catalog-staged-budget-child.mjs';
import {readLiveBudgetIdentity,stagedBudgetDigest as hash,PREPARED_MARKETS} from './lib/catalog-staged-budget.mjs';
import {candidateControlsKey,candidateControlsRevision,readCandidateBudgetContract,persistCandidateBudgetObject,
  candidateBudgetCore,assertCandidateBudgetReceipt,assertCandidateBudgetContract,candidateBudgetWriteKind} from './lib/catalog-candidate-budget.mjs';

const SHA=/^[a-f0-9]{40}$/,HEX=/^[a-f0-9]{64}$/,GENERATION=/^gen_\d+_[a-z0-9]+$/;
const script=fileURLToPath(import.meta.url),run=promisify(execFile);

export function candidateBudgetInputs(env=process.env) {
  const action=env.CATALOG_CANDIDATE_ACTION,healthPhase=env.CATALOG_CANDIDATE_HEALTH_PHASE;
  const baselineLiveIdentity={release:env.CATALOG_EXPECTED_LIVE_RELEASE,calculationVersion:env.CATALOG_EXPECTED_LIVE_CALCULATION_VERSION};
  const release=env.CATALOG_CANDIDATE_RELEASE,calculationVersion=env.CATALOG_CANDIDATE_CALCULATION_VERSION;
  const encyclopediaDigest=env.CATALOG_CANDIDATE_ENCYCLOPEDIA_DIGEST,generationId=env.CATALOG_EXPECTED_GENERATION;
  if(!['prepare','verify'].includes(action)||!['before-activation','after-activation'].includes(healthPhase)
      ||action==='prepare'&&healthPhase!=='before-activation'||!SHA.test(baselineLiveIdentity.release||'')
      ||!HEX.test(baselineLiveIdentity.calculationVersion||'')||!SHA.test(release||'')||!HEX.test(calculationVersion||'')
      ||!HEX.test(encyclopediaDigest||'')||!GENERATION.test(generationId||''))throw Error('candidate_budget_inputs_invalid');
  if(release===baselineLiveIdentity.release||calculationVersion===baselineLiveIdentity.calculationVersion)throw Error('candidate_budget_namespace_not_isolated');
  const reportPath=env.CATALOG_CANDIDATE_REPORT,preparedReport=env.CATALOG_CANDIDATE_PREPARED_REPORT;
  const preparedReceipt=env.CATALOG_CANDIDATE_PREPARED_RECEIPT;
  if(!reportPath||!path.isAbsolute(reportPath)||action==='verify'&&(!preparedReport||!path.isAbsolute(preparedReport)||!HEX.test(preparedReceipt||''))) {
    throw Error('candidate_budget_report_binding_required');
  }
  return {action,healthPhase,baselineLiveIdentity,release,calculationVersion,encyclopediaDigest,generationId,reportPath,preparedReport,preparedReceipt,
    liveIdentity:healthPhase==='before-activation'?baselineLiveIdentity:{release,calculationVersion}};
}

export async function verifyCandidateBudgetAuthority(context,storage,readIdentity=readLiveBudgetIdentity) {
  await verifyActiveBudgetAuthority(context,storage,readIdentity);
  const controls=candidateControlsRevision(await storage.readJsonWithMeta(candidateControlsKey,null));
  if(hash(controls)!==hash(context.controlsRevision))throw Error('candidate_budget_controls_changed');
}

/** Installed manifest is read directly. Only exact candidate-derived objects
 * may be written, using CAS; verify and initial contract discovery are read-only. */
export function installCandidateBudgetStorage(storage,context,phase,ConflictError) {
  if(context.mode!=='candidate-prepare'||!['prepare','verify'].includes(phase))throw Error('candidate_budget_mode_invalid');
  const read=storage.readJsonWithMeta.bind(storage),write=storage.writeJson.bind(storage);
  let contract=null,writes=0;
  const checkState=async()=>{
    const [manifest,lock,controls]=await Promise.all([read('catalog/manifest.json',null),read('catalog/import-lock.json',null),read(candidateControlsKey,null)]);
    assertActiveBudgetState(context,manifest,lock);
    if(hash(candidateControlsRevision(controls))!==hash(context.controlsRevision))throw Error('candidate_budget_controls_changed');
  };
  storage.readJsonWithMeta=async(key,fallback,previous)=>{
    if(['catalog/manifest.json','catalog/import-lock.json',candidateControlsKey].includes(key))await checkState();
    return read(key,fallback,previous);
  };
  storage.readJson=async(key,fallback)=>(await storage.readJsonWithMeta(key,fallback)).value;
  storage.writeJson=async(key,value,condition)=>{
    if(phase!=='prepare'||!contract)throw Error('candidate_budget_write_forbidden');
    await checkState();
    return persistCandidateBudgetObject({contract,key,value,condition,read,ConflictError,
      write:async(...args)=>{const result=await write(...args);writes++;return result;}});
  };
  for(const name of ['putBinary','deleteJson','deleteBinary','deleteObjects','deletePrefix','abortMultipartUpload']) {
    if(typeof storage[name]==='function')storage[name]=async()=>{throw Error('candidate_budget_write_forbidden');};
  }
  return {checkState,get writes(){return writes;},setContract(value){
    if(contract)throw Error('candidate_budget_contract_invalid');
    assertCandidateBudgetContract(value,context);
    contract=value;
  }};
}

/** Also constrain raw S3 PUTs, including any future writer that constructs its
 * own storage client rather than using the guarded singleton. */
export function installCandidateBudgetNetworkFence(env,fetchImpl,contract,writable) {
  const endpoint=String(env.YC_OBJECT_STORAGE_ENDPOINT||'').replace(/\/+$/,''),bucket=env.YC_OBJECT_STORAGE_BUCKET;
  const prefix=String(env.YC_OBJECT_STORAGE_PREFIX||'').replace(/^\/+|\/+$/g,'');
  if(!bucket)throw Error('candidate_budget_storage_bucket_required');
  const base=decodeURIComponent(new URL([endpoint,bucket,prefix].filter(Boolean).join('/')+'/').pathname);
  const guarded=async(input,options)=>{
    const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);
    const method=String(options?.method||input?.method||'GET').toUpperCase();
    if(method==='PUT'){
      const pathname=decodeURIComponent(url.pathname),headers=new Headers(options?.headers);
      if(!writable||!contract||url.search||!pathname.startsWith(base)
          ||headers.get('if-none-match')!=='*'&&!headers.get('if-match'))throw Error('candidate_budget_raw_write_forbidden');
      const body=options?.body;
      if(typeof body!=='string'&&!Buffer.isBuffer(body))throw Error('candidate_budget_raw_write_forbidden');
      candidateBudgetWriteKind(contract,pathname.slice(base.length),JSON.parse(String(body)));
    }
    return fetchImpl(input,options);
  };
  installStagedBudgetNetworkFence(endpoint,guarded,writable);
}

export async function runCandidateBudgetChild({phase,root,context,reportPath}) {
  const fetch=globalThis.fetch;
  installCandidateBudgetNetworkFence(process.env,fetch,null,false);
  const {getJsonStorage,StorageConflictError}=await import(pathToFileURL(path.join(root,'apps/web/lib/data.ts')).href);
  const storage=getJsonStorage();if(storage.driver!=='object')throw Error('object_storage_required');
  const guard=installCandidateBudgetStorage(storage,context,phase,StorageConflictError);
  await guard.checkState();
  const contract=await readCandidateBudgetContract(root,storage,context);
  guard.setContract(contract);
  installCandidateBudgetNetworkFence(process.env,fetch,contract,phase==='prepare');
  const report=await collectPreparedBudgetReadiness({mode:phase,root,context,reportPath,storage});
  await guard.checkState();
  const core=candidateBudgetCore(report,context,contract);
  const result={core,receiptSha256:hash(core),derivedWrites:guard.writes};
  await fs.writeFile(reportPath,JSON.stringify(result));
  return result;
}

export async function runCandidateBudgetPrepare(root,env=process.env) {
  const inputs=candidateBudgetInputs(env);
  const within=(base,file)=>{const relative=path.relative(base,file);return relative===''||relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative);};
  if(within(root,inputs.reportPath))throw Error('candidate_budget_report_must_be_outside_source');
  const assertSource=()=>{
    if(execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim()!==inputs.release
        ||execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim())throw Error('candidate_budget_source_changed');
  };
  assertSource();
  const expected=inputs.action==='verify'?JSON.parse(await fs.readFile(inputs.preparedReport,'utf8')):null;
  if(expected)assertCandidateBudgetReceipt(expected,expected.core,inputs.preparedReceipt);
  const runtime=relative=>import(pathToFileURL(path.join(root,relative)).href);
  const {getJsonStorage}=await runtime('apps/web/lib/data.ts'),storage=getJsonStorage();
  if(storage.driver!=='object')throw Error('object_storage_required');
  const [identity,manifest,lock,controls]=await Promise.all([readLiveBudgetIdentity(),storage.readJsonWithMeta('catalog/manifest.json',null),
    storage.readJsonWithMeta('catalog/import-lock.json',null),storage.readJsonWithMeta(candidateControlsKey,null)]);
  if(identity.release!==inputs.liveIdentity.release||identity.calculationVersion!==inputs.liveIdentity.calculationVersion
      ||manifest.value?.generationId!==inputs.generationId||!manifest.etag)throw Error('candidate_budget_initial_binding_changed');
  const {calculationVersion}=await runtime('scripts/catalog-calculation-version.mjs');
  if(calculationVersion(root)!==inputs.calculationVersion)throw Error('candidate_budget_calculation_mismatch');
  const context={version:1,mode:'candidate-prepare',release:inputs.release,calculationVersion:inputs.calculationVersion,
    liveIdentity:inputs.liveIdentity,baselineLiveIdentity:inputs.baselineLiveIdentity,encyclopediaDigest:inputs.encyclopediaDigest,
    manifest:manifest.value,manifestEtag:manifest.etag,lockRevision:{found:lock.found,etag:lock.etag||null},
    controlsRevision:candidateControlsRevision(controls)};
  await verifyCandidateBudgetAuthority(context,storage);
  if(expected){
    for(const field of ['release','calculationVersion','encyclopediaDigest','baselineLiveIdentity','manifestEtag','controlsRevision']) {
      if(hash(expected.core[field])!==hash(context[field]))throw Error('candidate_budget_prepared_binding_changed');
    }
    if(expected.core.generationId!==inputs.generationId||expected.core.manifestDigest!==hash(context.manifest))throw Error('candidate_budget_prepared_binding_changed');
  }
  await restoreCandidateEncyclopedia(storage,root,inputs.encyclopediaDigest);
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'catalog-candidate-budget-'));
  const contextPath=path.join(directory,'context.json'),reportPath=path.join(directory,'readiness.json');
  await fs.writeFile(contextPath,JSON.stringify(context));
  const invoke=async phase=>{
    assertSource();await verifyCandidateBudgetAuthority(context,storage);
    const {stdout}=await run(process.execPath,['--import','tsx',script,'--child',phase,root,contextPath,reportPath],{
      cwd:root,env:{...env,AVTOCENA_RELEASE_SHA:context.release,AVTOCENA_CALCULATION_VERSION:context.calculationVersion,
        NODE_OPTIONS:env.CATALOG_BUDGET_PREPARATION_NODE_OPTIONS||env.NODE_OPTIONS||'--max-old-space-size=6144'},timeout:120*60_000,maxBuffer:1024*1024});
    if(stdout.trim())console.log(stdout.trim());
    assertSource();await verifyCandidateBudgetAuthority(context,storage);
    return JSON.parse(await fs.readFile(reportPath,'utf8'));
  };
  try{
    const prepared=inputs.action==='prepare'?await invoke('prepare'):expected;
    const verified=await invoke('verify');
    if(verified.derivedWrites!==0)throw Error('candidate_budget_verify_wrote_objects');
    assertCandidateBudgetReceipt(prepared,verified.core,inputs.action==='prepare'?prepared.receiptSha256:inputs.preparedReceipt);
    const report={version:1,core:verified.core,receiptSha256:verified.receiptSha256,action:inputs.action,healthPhase:inputs.healthPhase,
      verified:true,candidatePrepared:true,installed:false,liveReady:false,published:false,
      derivedWrites:inputs.action==='prepare'?prepared.derivedWrites:0,observedLiveIdentity:inputs.liveIdentity,
      checkedAt:new Date().toISOString(),marketCoverage:Object.fromEntries(PREPARED_MARKETS.map(market=>[market,verified.core.markets[market]?
        {status:'verified_saved_prices',sourceRows:verified.core.markets[market].sourceRows}:{status:'empty_in_active_manifest',sourceRows:0}])),
      rateAuthority:'exact_runtime_on_worker_with_shared_stored_inputs_and_CBR_access',productionProcessFingerprintVerified:false};
    await fs.writeFile(inputs.reportPath,JSON.stringify(report,null,2));
    console.log(JSON.stringify({stage:'candidate_budget_'+inputs.action,release:inputs.release,generationId:inputs.generationId,
      receiptSha256:report.receiptSha256,derivedWrites:report.derivedWrites,candidatePrepared:true,installed:false,liveReady:false}));
    return report;
  }finally{await fs.rm(directory,{recursive:true,force:true});}
}

if(process.argv[1]&&path.resolve(process.argv[1])===script){
  const task=process.argv[2]==='--child'?(async()=>{
    const [phase,root,contextPath,reportPath]=process.argv.slice(3);
    return runCandidateBudgetChild({phase,root:path.resolve(root),context:JSON.parse(await fs.readFile(contextPath,'utf8')),reportPath});
  })():runCandidateBudgetPrepare(path.resolve(process.argv[2]||'.'));
  task.catch(error=>{console.error(error?.message||'candidate_budget_failed');process.exitCode=1;});
}
