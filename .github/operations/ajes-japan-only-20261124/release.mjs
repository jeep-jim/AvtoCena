import fs from 'node:fs/promises';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {PROFILE,ROOT,need,sha256,checkInvocation,verifySource,verifyGates,assertServerReceipt,assertBrowserReceipt} from './release-contract.mjs';
import {buildImage,fileDigest,RESOURCE_FILES} from './release-image.mjs';
import {acquireAuthority} from './release-authority.mjs';
import {isAjHostPhase,openAjSshSession} from './release-ssh.mjs';
import {runBrowserGate} from './release-browser.mjs';
import {retireAjesNonJapanControls} from './retire-controls.mjs';
import {githubReader,verifyControllerCi,assertPublicationQuiescence} from '../home-ui-activation-20261123/github-evidence.mjs';

const writeJson=(file,value)=>fs.writeFile(file,JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});
const CONTROLLER_PHASES=new Set(['controller','authority-acquire','private-index-read','plan','publication-guard',
  'controls-retire','ssh-connect','resources-read','activation','authority-release','result-write']);
const safePhase=value=>isAjHostPhase(value)||CONTROLLER_PHASES.has(value)?value:null;
export function failureDetails(error,{phase='controller',lastCompletedPhase=null}={}){
  return {failureCode:/^(?:aj_release_|home_evidence_|home_host_|aj_ssh_)[a-zA-Z0-9_:-]+$/.test(error?.message||'')
      ?error.message:'aj_release_failed',
    failedPhase:safePhase(error?.failedPhase)??safePhase(phase)??'controller',
    lastCompletedPhase:safePhase(error?.lastCompletedPhase)??safePhase(lastCompletedPhase)};
}
async function liveIdentity(){
  const response=await fetch('https://avtocena.com/api/health',{method:'GET',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(30000)});
  need(response.status===200,'live_health');const value=await response.json();
  return {release:value.releaseSha,calculationVersion:value.calculationVersion};
}

/** The only normal acceptance path. Any failed functional, speed, browser or
 * final ownership check restores exact ingress before an owned candidate stops. */
export async function activateTransaction(io,{nonce,profile=PROFILE,routes=verifyGates()}){
  let started=false,switchAttempted=false,accepted=false,ingressState='retained';
  let phase='start',lastCompletedPhase=null;
  const step=async(name,run)=>{phase=name;const value=await run();lastCompletedPhase=name;return value;};
  try{
    await step('start',()=>io.start());started=true;
    await step('identity',()=>io.identity());
    await step('aj-private',async()=>need((await io.aj('private'))?.passed===true,'aj_private_contract'));
    await step('server-private',async()=>assertServerReceipt(await io.server('private'),nonce,'private',profile,routes));
    await step('publication-guard',()=>io.guard());await step('fresh',()=>io.fresh());
    switchAttempted=true;ingressState='unknown';
    await step('switch',()=>io.switch());ingressState='candidate';
    await step('public-identity',()=>io.publicIdentity());
    await step('aj-public',async()=>need((await io.aj('public'))?.passed===true,'aj_public_contract'));
    await step('server-public',async()=>assertServerReceipt(await io.server('public'),nonce,'public',profile,routes));
    await step('browser',async()=>assertBrowserReceipt(await io.browser(),nonce,profile));
    await step('publication-guard',()=>io.guard());await step('identity',()=>io.identity());
    await step('accept',()=>io.accept());accepted=true;
    return {version:1,release:profile.source,accepted,ingressState,nonce,lastCompletedPhase};
  }catch(error){
    // Freeze the original failure before rollback/cleanup commands complete.
    const details=failureDetails(error,{phase,lastCompletedPhase});
    error.failedPhase=details.failedPhase;error.lastCompletedPhase=details.lastCompletedPhase;
    try{
      if(switchAttempted){await io.rollback();ingressState='retained';}
      if(started)await io.cleanup();
    }catch{ingressState='unknown';}
    error.ajOutcome={version:1,release:profile.source,accepted,ingressState,nonce,...details};
    throw error;
  }
}

async function activate(sourceRoot,directory){
  const invocation=checkInvocation(),routes=verifyGates(),sourceProof=verifySource(sourceRoot);
  const reader=githubReader();
  const ci=await verifyControllerCi(reader,ROOT,invocation);
  await assertPublicationQuiescence(reader,process.env.GITHUB_RUN_ID);
  const imageBuild=JSON.parse(await fs.readFile(path.join(directory,'image-receipt.json'),'utf8'));
  need(imageBuild.controllerSha===invocation.sourceSha&&imageBuild.source===PROFILE.source&&imageBuild.tree===PROFILE.tree
    &&imageBuild.sourceProof.codeDiffSha256===sourceProof.codeDiffSha256
    &&imageBuild.imageArchiveSha256===await fileDigest(path.join(directory,'image.tar')),'prepared_image_changed');
  need(process.env.JSON_STORAGE_DRIVER==='object'&&process.env.YC_OBJECT_STORAGE_ENDPOINT==='https://s3.regru.cloud'
    &&process.env.YC_OBJECT_STORAGE_BUCKET==='avtocena-staging-8120751'
    &&process.env.YC_OBJECT_STORAGE_PREFIX==='migration-staging/full-20261011/','storage_scope');
  const {getJsonStorage}=await import(pathToFileURL(path.join(ROOT,'apps/web/lib/data.ts')));
  const storage=getJsonStorage(),nonce=randomBytes(16).toString('hex');
  const authority=await acquireAuthority({storage,nonce,readLiveIdentity:liveIdentity});
  let session,closed=false,hostContacted=false,outcome={version:1,release:PROFILE.source,accepted:false,ingressState:'retained',nonce};
  let phase='private-index-read',lastCompletedPhase='authority-acquire';
  const step=async(name,run)=>{phase=name;const value=await run();lastCompletedPhase=name;return value;};
  try{
    // Reuse the already compiled immutable encyclopedia bytes. No recompile,
    // publication or new release binding is performed.
    const indexKey='knowledge/encyclopedia/calculation-indexes/'+PROFILE.privateIndexDigest+'.json';
    let binding=await storage.readJson('knowledge/encyclopedia/calculation-releases/'+PROFILE.retainedSource+'.json',null);
    if(binding===null)binding=await storage.readJson('knowledge/encyclopedia/calculation-releases/'+PROFILE.privateIndexParent+'.json',null);
    need(binding?.version===1&&[PROFILE.retainedSource,PROFILE.privateIndexParent].includes(binding.release)
      &&binding.digest===PROFILE.privateIndexDigest&&binding.key===indexKey,'private_binding');
    const binary=await storage.getBinary(indexKey);need(Buffer.isBuffer(binary?.data),'private_index_bytes');
    const index=JSON.parse(binary.data);
    need(index?.version===1&&index.digest===PROFILE.privateIndexDigest&&index.models
      &&sha256(JSON.stringify(index.models))===PROFILE.privateIndexDigest,'private_index');
    const indexPath=path.join(directory,'calculation-v1.json');await fs.writeFile(indexPath,binary.data,{mode:0o400,flag:'wx'});
    lastCompletedPhase=phase;
    const plan={version:1,source:PROFILE.source,tree:PROFILE.tree,sourceCalculationVersion:PROFILE.sourceCalculationVersion,
      servingCalculationVersion:PROFILE.servingCalculationVersion,privateIndexDigest:PROFILE.privateIndexDigest,
      inventorySha256:PROFILE.inventorySha256,nonce,imageId:imageBuild.imageId,imageBuild,
      resourceFiles:imageBuild.resourceFiles,privateFileSha256:sha256(binary.data),privateFileBytes:binary.data.length,
      generationId:authority.generationId,acceptedReadModelFingerprint:authority.acceptedReadModelFingerprint};
    await step('plan',()=>writeJson(path.join(directory,'safe-plan.json'),{version:1,controllerSha:invocation.sourceSha,planSha256:sha256(JSON.stringify(plan)),plan,ci}));
    await step('publication-guard',()=>authority.guard());
    const controls=await step('controls-retire',async()=>{
      const value=await retireAjesNonJapanControls({storage,runId:process.env.GITHUB_RUN_ID,
        attempt:process.env.GITHUB_RUN_ATTEMPT,sourceSha:PROFILE.source});
      await authority.retainControls();return value;
    });
    console.log(JSON.stringify({stage:'aj_controls_retired',...controls}));
    hostContacted=true;
    session=await step('ssh-connect',()=>openAjSshSession({root:ROOT,directory,nonce,authority,
      browser:()=>runBrowserGate({root:ROOT,directory,nonce})}));
    await step('init',()=>session.call('init',{plan,planSha256:sha256(JSON.stringify(plan))}));
    await step('image',()=>session.upload('image',path.join(directory,'image.tar'),{bytes:imageBuild.imageArchiveBytes}));
    await step('private-index',()=>session.upload('private-index',indexPath));
    phase='resources-read';
    const resources={};
    for(const name of Object.keys(RESOURCE_FILES)){
      const raw=await fs.readFile(path.join(directory,'resources',name));need(sha256(raw)===imageBuild.resourceFiles[name],'resource_changed');
      resources[name]=raw.toString('base64');
    }
    lastCompletedPhase=phase;
    await step('resources',()=>session.call('resources',{files:resources}));
    phase='activation';
    outcome=await activateTransaction({
      start:()=>session.call('start'),identity:()=>session.call('identity'),aj:phase=>session.call('aj-'+phase),
      server:phase=>session.call('server-'+phase),guard:async()=>{await assertPublicationQuiescence(reader,process.env.GITHUB_RUN_ID);await authority.guard();},
      fresh:()=>session.call('fresh'),switch:async()=>{await session.call('switch');authority.setIngress('candidate');},
      publicIdentity:()=>session.call('public-identity'),browser:()=>session.call('browser'),accept:()=>session.call('accept'),
      rollback:async()=>{await session.call('rollback');authority.setIngress('retained');},cleanup:()=>session.call('cleanup'),
    },{nonce,routes});
    lastCompletedPhase=outcome.lastCompletedPhase;
    await step('close',()=>session.close());closed=true;
    await step('authority-release',()=>authority.release());
    await step('result-write',()=>writeJson(path.join(directory,'safe-result.json'),{...outcome,controls,lastCompletedPhase,
      servingCalculationVersion:PROFILE.servingCalculationVersion,
      encyclopediaWrites:0,catalogWrites:0,supplierCollectionRuns:0,controllerSha:invocation.sourceSha}));
    console.log(JSON.stringify({stage:'aj_release_accepted',...outcome}));
  }catch(error){
    const details=failureDetails(error,{phase,lastCompletedPhase});
    if(error.ajOutcome)outcome=error.ajOutcome;
    if(session&&!closed){
      try{await session.close();closed=true;}catch{session.abort(Error('aj_release_cleanup'));await session.exited;}
    }
    // A lost transport must not clear a potentially active lease. Its bounded
    // TTL remains until the remote emergency rollback is independently known.
    if(!hostContacted||closed)await authority.release().catch(()=>{});else await authority.stopHeartbeat();
    await writeJson(path.join(directory,'safe-result.json'),{...outcome,hostContacted,remoteClosed:closed,
      ...details}).catch(()=>{});
    throw error;
  }
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    need(process.argv.length===4&&['--build','--activate'].includes(process.argv[2]),'arguments');
    const directory=path.join(await fs.realpath(process.env.RUNNER_TEMP),'aj-japan-release');
    if(process.argv[2]==='--build')await buildImage(path.resolve(process.argv[3]),directory);
    else await activate(path.resolve(process.argv[3]),directory);
  }catch(error){console.error(failureDetails(error).failureCode);process.exitCode=1;}
}
