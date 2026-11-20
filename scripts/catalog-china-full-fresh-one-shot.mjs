#!/usr/bin/env node
/** Candidate-only owner job. No public/active or provider cursor writes. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const SHA=/^[a-f0-9]{64}$/,GEN=/^gen_\d{13}_[a-z0-9]{1,64}$/;
const host='https://s3.regru.cloud',storageScope={endpoint:host,bucket:'avtocena-staging-8120751',prefix:'migration-staging/full-20261011',region:'us-east-1'};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const digest=value=>sha(JSON.stringify(value));
const fail=reason=>{throw Error('china_full_fresh_one_job:'+reason);};
const requireValue=(ok,reason)=>{if(!ok)fail(reason);};
const names=['guarded-capsule-runner.mjs','prepare-native-archive.mjs','bounded-archive-restore.mjs','bind-converted-continuity.mjs',
 'read-current-china-proof.mjs','clean-snapshot-admission.mjs','authenticate-fresh-fx-owner.mjs','fresh-fx-run-authority.mjs','prepare-fresh-replacement-proof.mjs'];
const workflow='.github/workflows/china-full-fresh-prepare-v1.yml';
const safePart=x=>x!=='.'&&x!=='..'&&/^[a-zA-Z0-9_.-]+$/.test(x);
const root=path.resolve(fileURLToPath(new URL('../',import.meta.url)));

async function directory(input){
 requireValue(typeof input==='string'&&path.isAbsolute(input)&&path.normalize(input)===input&&await fs.realpath(input)===input,'directory_scope');
 return input;
}
async function local(file,limit,expected,privateOnly=false){
 requireValue(path.isAbsolute(file)&&await fs.realpath(file)===file,'file_scope');
 const h=await fs.open(file,'r');try{
  const st=await h.stat();
  requireValue(st.isFile()&&st.nlink===1&&st.size>0&&st.size<=limit&&(!privateOnly||(st.mode&0o077)===0),'file_size_or_mode');
  const body=await h.readFile();
  requireValue(body.length===st.size&&(!expected||sha(body)===expected),'file_pin');
  return body;
 }finally{await h.close();}
}
const json=bytes=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
async function verifyFiles(base,pins,required=[],prefix=''){
 requireValue(Array.isArray(pins)&&pins.length>0&&pins.length<=2000,'closure_inventory');
 const actual=new Set();
 for(const item of pins){
  const {file,sha256,bytes}=item??{};
  requireValue(typeof file==='string'&&file.startsWith(prefix)&&file.split('/').every(safePart)&&!actual.has(file)&&SHA.test(sha256??'')&&
   Number.isSafeInteger(bytes)&&bytes>0&&bytes<=(file==='data/knowledge/encyclopedia/calculation-v1.json'?256:64)*1024*1024,'closure_item');
  actual.add(file);
  const b=await local(path.join(base,file),bytes,sha256);
  requireValue(b.length===bytes,'closure_size');
 }
 requireValue(required.every(x=>actual.has(x)),'closure_missing');
}
function flags(argv){
 const {values}=parseArgs({args:argv,options:{
  launch:{type:'string'},'expect-launch-sha':{type:'string'},'guard-bundle':{type:'string'},'native-root':{type:'string'},
  receipt:{type:'string'},'source-secrets':{type:'string'},'stage-secrets':{type:'string'},scratch:{type:'string'},'runtime-context':{type:'string'},
  'runtime-context-plan':{type:'string'},'runtime-context-release-root':{type:'string'},
 }});
 for(const k of ['launch','expect-launch-sha','guard-bundle','native-root','receipt','source-secrets','stage-secrets','scratch','runtime-context'])
  requireValue(typeof values[k]==='string'&&values[k].length>0,'argument_'+k);
 requireValue(SHA.test(values['expect-launch-sha']),'launch_pin');
 return values;
}
async function secrets(file){
 const v=json(await local(path.resolve(file),4096,undefined,true));
 requireValue(typeof v.access==='string'&&/^[a-zA-Z0-9_+=./-]{1,256}$/.test(v.access)&&typeof v.secret==='string'&&
  v.secret.length>0&&v.secret.length<=1024&&!/[\r\n\x00]/.test(v.secret),'credential_shape');
 return v;
}
const configure=map=>{for(const[k,v]of Object.entries(map))if(v===undefined)delete process.env[k];else process.env[k]=v;};
const progress=(stage,fields={})=>console.log(JSON.stringify({stage,...fields,publicationAuthorized:false,cursorAdvanceAuthorized:false}));
export async function runChinaFullFreshOneShot(argv=process.argv.slice(2),env=process.env){
 const options=flags(argv),launchBytes=await local(path.resolve(options.launch),128*1024,options['expect-launch-sha'],true),plan=json(launchBytes);
 const planSha=options['expect-launch-sha'],launcherBytes=await local(fileURLToPath(import.meta.url),128*1024,plan?.launcherSha256);
 const cfg=plan?.privateStage;
 requireValue(plan?.version===1&&plan.repository==='jeep-jim/AvtoCena'&&plan.workflow===workflow&&plan.job==='prepare'&&
  plan.jobDisplayName==='Prepare full fresh China with one frozen quote'&&plan.authorizesPublication===false&&plan.sourceMode==='complete-fresh-replacement'&&
  plan.canonicalPolicy==='native-public-identity-and-renderable-single-source-v1'&&/^[a-f0-9]{40}$/.test(env.GITHUB_SHA??'')&&
  (plan.authorizedHeadSha===env.GITHUB_SHA||plan.authorizedHeadSha===undefined&&/^[a-f0-9]{40}$/.test(plan.runtimeAuthorityBaseSha??''))&&
  env.GITHUB_REPOSITORY===plan.repository&&env.GITHUB_REF==='refs/heads/main'&&env.GITHUB_JOB==='prepare'&&env.GITHUB_RUN_ATTEMPT==='1'&&
  env.GITHUB_WORKFLOW_REF===plan.repository+'/'+workflow+'@refs/heads/main'&&/^[1-9][0-9]{0,19}$/.test(env.GITHUB_RUN_ID??'')&&
  [plan.archiveReportSha256,plan.archiveManifestSha256,plan.ownerApprovalSha256,plan.collectorClosureSha256,plan.calculationVersion,
   plan?.privateStage?.expectedChinaPublicBaseSha256].every(x=>SHA.test(x??''))&&GEN.test(plan.generationId??'')&&
  Number.isSafeInteger(plan.blockRows)&&plan.blockRows>0&&plan.blockRows<=128&&
  typeof plan.modelScope?.make==='string'&&typeof plan.modelScope?.model==='string','launch_contract');
 requireValue(cfg?.authorized===true&&Object.entries(storageScope).every(([k,v])=>cfg.storage?.[k]===v)&&
  Number.isSafeInteger(cfg.minAdmittedRows)&&cfg.minAdmittedRows>0&&Number.isSafeInteger(cfg.maxArtifactBytes)&&cfg.maxArtifactBytes>0&&
  cfg.maxArtifactBytes<=96*1024**3,'separate_regcloud_private_stage_authority_required');
 // No PUT is attempted just to test a grant. A separately approved private
 // stage scope is required even when the same credential can read the source.
 const stageSecrets=await secrets(options['stage-secrets']),sourceSecrets=await secrets(options['source-secrets']);
 const scratch=await directory(options.scratch),bundle=await directory(options['guard-bundle']),
  nativeRoot=await directory(options['native-root']);
 const exec=promisify(execFile);
 if(plan.expectedAppHeadSha!==undefined){
  // Main owns the GitHub job, not the prepared app checkout. The split
  // composer authenticates both real roots; never impersonate the main SHA.
  const appParent='40e86a1bd28ca5759ac00cd09f665a45f66afb0a';
  requireValue(/^[a-f0-9]{40}$/.test(plan.expectedAppHeadSha)&&plan.expectedAppHeadSha!==env.GITHUB_SHA&&
   plan.authorizedHeadSha===env.GITHUB_SHA&&SHA.test(plan.composedFromPolicySha256??''),'split_app_authority');
  const git=async ref=>(await exec('git',['rev-parse',ref],{cwd:root,maxBuffer:4096})).stdout.trim();
  requireValue(await git('HEAD')===plan.expectedAppHeadSha,'checked_out_app_head');
  requireValue(await git('HEAD^')===appParent,'checked_out_app_parent');
 }else if(plan.authorizedHeadSha===undefined){
  const head=(await exec('git',['rev-parse','HEAD'],{cwd:root,maxBuffer:4096})).stdout.trim();
  requireValue(head===env.GITHUB_SHA,'checked_out_head');
  await exec('git',['merge-base','--is-ancestor',plan.runtimeAuthorityBaseSha,head],{cwd:root,maxBuffer:4096});
 }
 const runtimeContext=path.resolve(options['runtime-context']);
 let runtimeDataFiles=plan.runtimeDataFiles,contextReceiptSha256;
 const recovery=plan.guardEntryPrefix;
 requireValue(typeof recovery==='string'&&recovery.endsWith('/')&&recovery.slice(0,-1).split('/').every(safePart),'guard_entry_scope');
 await verifyFiles(bundle,plan.guardFiles,[...names.map(file=>recovery+file),
  path.posix.normalize(recovery+'../candidate-final/producer/operational/upstream/flow/input/SOURCE_PINS.json'),
  path.posix.normalize(recovery+'../../../budget-fallback/china-heavy-policy.mjs')]);
 await verifyFiles(root,plan.runtimeCodeFiles,[
  'apps/web/lib/catalog/prepared-china-fresh-price-replay.ts','apps/web/lib/catalog/china-durable-object-stage.ts','scripts/lib/china-shadow-disk.mjs',
  'apps/web/lib/catalog/independent-china-prepared-fixture.ts','apps/web/lib/catalog/prepared-price-card-block.ts',
  'apps/web/lib/data.ts','apps/web/lib/catalog/china-private-stage-privacy.ts','apps/web/lib/catalog/china-prepared-editorial.mjs',
 ]);
 // The workflow's authenticated launch composer already verified the active
 // run/job with the GitHub API. Probe only the exact approved stage bucket
 // under its existing stage signer before restoring/downloading any source.
 const app=file=>import(pathToFileURL(path.join(root,file)));
 const {ObjectJsonStorage}=await app('apps/web/lib/data.ts');
 const stageConfig={YC_OBJECT_STORAGE_ENDPOINT:cfg.storage.endpoint,YC_OBJECT_STORAGE_BUCKET:cfg.storage.bucket,
  YC_OBJECT_STORAGE_PREFIX:cfg.storage.prefix,YC_OBJECT_STORAGE_REGION:cfg.storage.region,
  YC_OBJECT_STORAGE_ACCESS_KEY_ID:stageSecrets.access,YC_OBJECT_STORAGE_SECRET_ACCESS_KEY:stageSecrets.secret};
 const probePrior=Object.fromEntries(Object.keys(stageConfig).map(k=>[k,process.env[k]]));
 let expectedBucketPrivacy;
 try{
  configure(stageConfig);
  expectedBucketPrivacy=await new ObjectJsonStorage().readChinaPrivateStageBucketPrivacy();
 }finally{configure(probePrior);}
 progress('private_stage_bucket_readonly',{verified:true,storageWrites:0});
 const freshHooks=await fs.readFile(path.join(root,'apps/web/lib/catalog/independent-china-prepared-fixture.ts'),'utf8');
 requireValue(freshHooks.includes('freshSnapshot?:true')&&freshHooks.includes('priceReplay'),'fresh_runtime_hooks_missing');
 if(plan.runtimeContextPlanSha256!==undefined){
  requireValue(SHA.test(plan.runtimeContextPlanSha256)&&typeof options['runtime-context-plan']==='string'&&
   typeof options['runtime-context-release-root']==='string'&&!plan.runtimeDataFiles,'runtime_context_pin_scope');
  const raw=await local(path.resolve(options['runtime-context-plan']),64*1024,plan.runtimeContextPlanSha256,true),contextPlan=json(raw);
  requireValue(contextPlan.releaseSha===plan.runtimeContextReleaseSha&&contextPlan.calculationVersion===plan.runtimeContextCalculationVersion,'runtime_context_release');
  const {materializeChinaRuntimeContext}=await import('./catalog-china-materialize-runtime.mjs');
  const {receipt,receiptSha256}=await materializeChinaRuntimeContext({plan:contextPlan,expectedPlanSha256:plan.runtimeContextPlanSha256,
   releaseRoot:await directory(options['runtime-context-release-root']),out:runtimeContext,credentials:sourceSecrets});
  runtimeDataFiles=receipt.runtimeDataFiles;contextReceiptSha256=receiptSha256;
  progress('runtime_context_readonly',{receiptSha256,files:runtimeDataFiles.length,storageWrites:0});
 }else{
  requireValue(!options['runtime-context-plan']&&!options['runtime-context-release-root'],'unexpected_runtime_context_plan');
 }
 await directory(runtimeContext);
 await verifyFiles(runtimeContext,runtimeDataFiles,[],'data/');
 const indexedData=new Set(runtimeDataFiles.map(x=>x.file));
 async function checkRuntimeData(dir){
  for(const e of await fs.readdir(dir,{withFileTypes:true})){
   const file=path.join(dir,e.name);
   if(e.isDirectory())await checkRuntimeData(file);
   else requireValue(e.isFile()&&indexedData.delete(path.relative(runtimeContext,file)),'unsealed_runtime_file');
  }
 }
 await checkRuntimeData(path.join(runtimeContext,'data'));requireValue(indexedData.size===0,'runtime_file_missing');
 // This child is the authored guarded restore. No different collector,
 // remote provider or duplicate extraction. Parent keeps its local files.
 const guarded=path.join(bundle,recovery,'guarded-capsule-runner.mjs');
 const {stdout}=await promisify(execFile)(process.execPath,['--import','tsx',guarded,nativeRoot,path.resolve(options.receipt),
  path.resolve(options['source-secrets']),scratch],{cwd:root,maxBuffer:2*1024*1024});
 const lines=stdout.trim().split('\n').map(x=>JSON.parse(x));
 const restored=lines.findLast(x=>x.stage==='native_sqlite_conversion_admitted');
 requireValue(restored?.sourceRows===290044&&restored.shards===581&&SHA.test(restored.admissionSha256??'')&&
  restored.archiveManifestSha256===plan.archiveManifestSha256&&restored.rawUploaded===false&&restored.storageWrites===0,'native_archive_receipt');
 progress('native_archive_verified',{sourceRows:restored.sourceRows,shards:restored.shards});
 const guard=file=>import(pathToFileURL(path.join(bundle,recovery,file)));
 const [reader,continuity,admission,fxOwner,fxGuard,replacement,rates,pricing,replay,diskModule,pubModule,fsRuntime,durable,heavy,identity]=await Promise.all([
  guard('read-current-china-proof.mjs'),guard('bind-converted-continuity.mjs'),guard('clean-snapshot-admission.mjs'),
  guard('authenticate-fresh-fx-owner.mjs'),guard('fresh-fx-run-authority.mjs'),guard('prepare-fresh-replacement-proof.mjs'),
  app('apps/web/lib/catalog/rates.ts'),app('apps/web/lib/catalog/shared-budget-prices.ts'),app('apps/web/lib/catalog/prepared-china-fresh-price-replay.ts'),
  app('scripts/lib/china-shadow-disk.mjs'),app('apps/web/lib/catalog/independent-market-activation-fixture.ts'),
  app('apps/web/lib/catalog/china-stage-runtime-files.ts'),app('apps/web/lib/catalog/china-durable-object-stage.ts'),
  app('apps/web/lib/catalog/heavy-vehicle-families.ts'),app('apps/web/lib/catalog/public-identity-policy.ts'),
 ]);
 requireValue(typeof replay.openFreshChinaPriceReplay==='function'&&typeof diskModule.finalizeChinaShadowStage==='function'&&
  typeof durable.transferChinaPrivateStage==='function'&&typeof identity.isSupportedPublicCatalogIdentity==='function','runtime_closure');
 const fetchImpl=globalThis.fetch;
 const read=reader.createChinaContinuitySnapshotReader({...sourceSecrets,fetchImpl});
 const bound=await continuity.bindConvertedContinuity({convertedRoot:path.join(scratch,'input-converted'),admissionSha256:restored.admissionSha256,
  archiveReportPath:path.join(scratch,'capsule','restored','report.json'),readAuthenticatedSnapshot:read});
 await read.verifyCandidateReplica(bound);
 const dispositionDir=path.join(scratch,'china-source-decisions');await fs.mkdir(dispositionDir,{mode:0o700});
 const decisions=[];
 const clean=await admission.admitCleanChinaSnapshot({continuity:bound,knownHeavyFamily:heavy.knownHeavyVehicleFamily,async onVerifiedBatch(batch){
  const item={dispositions:batch.dispositions,inputFileSha256:batch.inputFileSha256},bytes=Buffer.from(JSON.stringify(item));
  requireValue(batch.index===decisions.length&&bytes.length<=512*1024,'clean_disposition_bound');
  const filename=path.join(dispositionDir,String(batch.index)+'.json');
  await fs.writeFile(filename,bytes,{flag:'wx',mode:0o600});decisions.push({filename,sha256:sha(bytes)});
 }});
 requireValue(clean.proof.sourceRows===restored.sourceRows&&decisions.length===restored.shards&&clean.proof.oldRowsMerged===false&&
  clean.proof.sourceReportSha256===plan.archiveReportSha256,'clean_proof');
 // Phone-home checks belong to the approved prep actor. Serving never calls
 // them. Reuse the same actor auth for this one job, not once per price row.
 const assertSourceCurrent=async()=>{
  requireValue(Date.now()<clean.proof.sourceExpiresAt,'source_expired');
  const converted=path.join(scratch,'input-converted');
  await local(path.join(converted,'LOCAL_ADMISSION.json'),2*1024*1024,restored.admissionSha256);
  await local(path.join(converted,'LOCAL_CONTINUITY.json'),32*1024,bound.continuitySha256);
  // The exact provider candidate and all its restored bytes were verified
  // above. Once qualified the market no longer waits on global old aliases.
 };
 const owner=await fxOwner.authenticateFreshFxOwner({env,launchContract:launchBytes,expectedLaunchSha256:planSha,launcherBytes,
  proof:clean.proof,assertSourceCurrent,fetchImpl});
 const checkRemote=()=>owner.assertRunAuthority(owner.owner);
 const created=await replacement.writeFreshReplacementProof({continuity:bound,proof:clean.proof,authorityDir:path.join(scratch,'china-source-fresh-proof'),
  collectorClosureSha256:plan.collectorClosureSha256,ownerApprovalSha256:plan.ownerApprovalSha256,assertRunAuthority:checkRemote});
 let last=0,refreshing;
 const fence=async(force=false)=>{
  requireValue(Date.now()<clean.proof.sourceExpiresAt,'source_expired');
  if(force||Date.now()-last>=60_000){
   if(!refreshing)refreshing=checkRemote().then(()=>{last=Date.now();}).finally(()=>{refreshing=null;});
   await refreshing;
  }
  requireValue(Date.now()<clean.proof.sourceExpiresAt,'source_expired');
 };
 const fxDir=path.join(scratch,'china-fx');await fs.mkdir(fxDir,{mode:0o700});
 process.chdir(runtimeContext);process.env.JSON_STORAGE_DRIVER='local';
 process.env.AVTOCENA_CALCULATION_VERSION=plan.calculationVersion;
 const observed=await fxGuard.captureChinaPriceObservation({native:rates,owner:owner.owner,plan:{china:['CNY']},directory:fxDir,assertRunAuthority:owner.assertRunAuthority});
 const wire=fxGuard.createChinaPriceHandoff(observed.authority).stagedInput().wire.china;
 const fx=rates.importCatalogFxBatch(wire,wire.receiptSha256);
 const priceFingerprint=await rates.withCatalogFxBatch(fx,()=>pricing.budgetPricingFingerprint('china'));
 requireValue(pricing.calculationCacheVersion()===plan.calculationVersion&&SHA.test(priceFingerprint),'pricing_context');
 const disk=await diskModule.openChinaShadowDisk(path.join(scratch,'avtocena-china-shadow-own-run'),true);
 const prior={...Object.fromEntries(Object.keys(disk.env).map(k=>[k,process.env[k]]))};
 try{
  configure(disk.env);globalThis.fetch=disk.fetchMock;
  const storage=new ObjectJsonStorage(),publication=pubModule.openIndependentMarketFixture(storage,'china',{
   origin:disk.endpoint,bucket:disk.bucket,prefix:disk.prefix,fixtureFetch:disk.fetchMock,
   async assertAuthorized(market){requireValue(market==='china','private_stage_market');await fence();}
  });
  const priceJob=await replay.openFreshChinaPriceReplay({directory:path.join(scratch,'avtocena-china-fresh-prices-own-run'),fx,pricingFingerprint:priceFingerprint,
   calculationVersion:plan.calculationVersion,expectedInputRows:clean.proof.sourceRows,
   source:Object.fromEntries(['continuitySha256','sourceReportSha256','nativeAdmissionSha256','sourceReplicaSha256','sourceCursor','sourceExpiresAt','sourceBinding'].map(k=>[k,clean.proof[k]])),
   assertSourceAuthority:fence});
  let staged;
  try{
   const picksFiles=[],order=createHash('sha256').update('prepared-ordered-admitted-ids-v1\n');let count=0,excludedIdentity=0;
   for(const [i,item]of decisions.entries()){
    await fence();
    const c=json(await local(item.filename,512*1024,item.sha256)),raw=await bound.readShard(i);
    requireValue(sha(raw)===c.inputFileSha256,'admission_shard_moved');
    const rows=json(raw).offers,priced=await priceJob.consume({rows,dispositions:c.dispositions});
    const picks=[];
    for(const[j,d]of priced.entries())if(d.state==='admitted'){
     if(!identity.isSupportedPublicCatalogIdentity(rows[j])){excludedIdentity++;continue;}
     order.update(JSON.stringify(d.id)+'\n');count++;picks.push({id:d.id,canonicalSha256:d.canonicalSha256});
    }
    const bytes=Buffer.from(JSON.stringify(picks)),file=path.join(dispositionDir,'priced-'+i+'.json');
    await fs.writeFile(file,bytes,{flag:'wx',mode:0o600});picksFiles.push({file,sha256:sha(bytes)});
    if((i+1)%25===0)progress('frozen_fx_pricing',{shards:i+1,selected:count});
   }
   const sealed=await priceJob.seal(clean);
   requireValue(sealed.counts.admitted===count+excludedIdentity&&count>=cfg.minAdmittedRows,'fresh_selection_census');
   const source={observedAt:Date.parse(clean.proof.sourceCompletedAt),validUntil:clean.proof.sourceExpiresAt,receiptSha256:bound.sourceReceiptSha256,
    cursor:{stream:'che168',sequence:clean.proof.sourceCursor,anchorSha256:clean.proof.sourceReplicaSha256}};
   const selection={admittedRows:count,orderedAdmittedIdsSha256:order.digest('hex'),assertCurrent:fence,async *picks(){
    for(const p of picksFiles)yield* json(await local(p.file,512*1024,p.sha256));
   }};
   await fence(true);const state=await publication.observe();
   const lease=await publication.acquire({action:'publish',generationId:plan.generationId,expectedBaseSha256:state.baseSha256},
    Math.min(8*3600000,source.validUntil-Date.now()));
   const ready=await priceJob.stageCanonical({publication,lease,source,withdrawn:[],blockRows:plan.blockRows,modelScope:plan.modelScope,
    withStreamingSearch:true,freshSnapshot:true,selection,backend:{kind:'mock-s3',origin:disk.endpoint,bucket:disk.bucket,prefix:disk.prefix,fixtureFetch:disk.fetchMock}});
   await fence(true);
   staged=await diskModule.finalizeChinaShadowStage({disk,storage,publication,lease,staged:ready,archiveSha256:plan.archiveManifestSha256,
    source,fxReceiptSha256:fx.receiptSha256,count,streaming:true});
   progress('private_stage_ready',{count,excludedIdentity,priceCounts:sealed.counts,runtimeReadySha256:staged.runtimeReadySha256});
  }finally{priceJob.close();}
  // Private file mock ends here. Only the separately approved existing
  // writes to this run namespace now use the real configured object client.
  globalThis.fetch=fetchImpl;configure(prior);
  configure(stageConfig);
  const files=await fsRuntime.openStageChinaFiles({allowedParent:scratch,root:disk.root,readySha256:staged.runtimeReadySha256,
   archiveSha256:plan.archiveManifestSha256,expectedGenerationId:plan.generationId,expectedFxSha256:fx.receiptSha256,
   expectedAdmittedRows:staged.rows,sourceValidUntil:clean.proof.sourceExpiresAt});
  const permit={version:1,kind:'china-own-regcloud-private-stage-v1',market:'china',runId:'full-fresh-'+env.GITHUB_RUN_ID+'-1',
   storage:cfg.storage,generationId:plan.generationId,archiveSha256:plan.archiveManifestSha256,runtimeReadySha256:files.readySha256,
   expectedChinaPublicBaseSha256:cfg.expectedChinaPublicBaseSha256,minAdmittedRows:cfg.minAdmittedRows,maxArtifactBytes:cfg.maxArtifactBytes,
   validUntil:files.ready.validUntil,expectedOwnerApprovalSha256:plan.ownerApprovalSha256,publicationAuthorized:false,cursorAdvanceAuthorized:false};
  const permitSha=digest(permit);
  await fence(true);await read.verifyCandidateReplica(bound);
  const durableReady=await durable.transferChinaPrivateStage({storage:new ObjectJsonStorage(),files,permit,expectedPermitSha256:permitSha,expectedBucketPrivacy,
   async assertApprovedRunner(p,actual){
    requireValue(actual===permitSha&&digest(p)===permitSha&&sha(launchBytes)===planSha&&
     p.expectedOwnerApprovalSha256===plan.ownerApprovalSha256&&p.runId==='full-fresh-'+env.GITHUB_RUN_ID+'-1','durable_actor_scope');
    await fence();
   }});
  await fence(true);
  progress('durable_candidate_only',{generationId:plan.generationId,sourceRows:clean.proof.sourceRows,admitted:staged.rows,
   replacementProofSha256:created.sha256,runtimeContextReceiptSha256:contextReceiptSha256,pricingReceiptSha256:fx.receiptSha256,readySha256:durableReady.readySha256,runId:permit.runId});
  return durableReady;
 }finally{globalThis.fetch=fetchImpl;configure(prior);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 try{await runChinaFullFreshOneShot();}
 catch(error){console.error(JSON.stringify({status:'not_ready',reason:/^(?:china_full_fresh_one_job|china_private_stage_privacy|china_runtime_context):[a-zA-Z0-9_-]+(?::[0-9]{3})?$/.test(error?.message)?error.message:
  'guard_or_native_refused',publicationAuthorized:false,cursorAdvanceAuthorized:false}));process.exitCode=1;}
}
