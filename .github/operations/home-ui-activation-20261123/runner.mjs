import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {setTimeout as pause} from 'node:timers/promises';
import {HOME_UI,sha256,verifyHomeSourceCheckout,verifyHomeGateFiles,assertHomeSourceEvidence} from '../home-ui-only-20261123/contract.mjs';
import {assertReviewedInventory,acceptReviewedHomeUi} from '../home-ui-only-20261123/acceptance.mjs';
import {prepareHomeBindingPlan,applyReviewedHomeBinding} from '../home-ui-only-20261123/private-binding.mjs';
import {buildHomeImageForActivation,RESOURCE_FILES} from '../home-ui-adapter-20261123/build-image.mjs';
import {acquireHomeAuthority,resumeHomeAuthority} from './authority.mjs';
import {openHomeSshSession} from './ssh-session.mjs';
import {runBrowserGate} from './browser.mjs';
import {githubReader,assertPublicationQuiescence,verifyControllerCi,findPlanApproval} from './github-evidence.mjs';
import {CONTROLLER_ROOT,INVENTORY_FILE,REVIEWED_INVENTORY_SHA,checkActivationInvocation,approvalOperation,APPROVAL_MARKER} from './profile.mjs';

const need=(value,code)=>{if(!value)throw Error('home_activation_'+code);};
const INDEX_KEY='knowledge/encyclopedia/calculation-indexes/'+HOME_UI.privateIndexDigest+'.json';
const jsonFile=async filename=>JSON.parse(await fs.readFile(filename,'utf8'));
const privateWrite=(filename,value)=>fs.writeFile(filename,JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});
async function digest(filename){const hash=createHash('sha256');for await(const chunk of createReadStream(filename))hash.update(chunk);return hash.digest('hex');}
async function paths(){const temporary=await fs.realpath(process.env.RUNNER_TEMP);return {directory:path.join(temporary,'home-ui-activation'),image:path.join(temporary,'home-ui-image-catalog-b4d2')};}
async function storage(){const module=await import(pathToFileURL(path.join(CONTROLLER_ROOT,'apps/web/lib/data.ts')));const store=module.getJsonStorage();need(store.driver==='object','object_storage');return store;}
async function liveIdentity(){
  const response=await fetch('https://avtocena.com/api/health',{method:'GET',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(30000)});
  need(response.status===200,'live_health');const value=await response.json();
  return {release:value.releaseSha,calculationVersion:value.calculationVersion};
}

export function checkedPrepared(receipt,{runId,controllerSha,now=Date.now()}){
  need(receipt?.version===1&&receipt.status==='awaiting_exact_home_plan_review'&&receipt.activationAuthorized===false
    &&receipt.runId===String(runId)&&receipt.controllerSha===controllerSha,'prepared_identity');
  need(receipt.planSha256===sha256(JSON.stringify(receipt.plan))&&/^[a-f0-9]{64}$/.test(receipt.planSha256),'prepared_digest');
  need(Date.parse(receipt.createdAt)<=now&&Date.parse(receipt.reviewExpiresAt)>now,'review_window');
  const p=receipt.plan;
  assertHomeSourceEvidence(p.imageBuild?.sourceProof);assertReviewedInventory(receipt.inventory,REVIEWED_INVENTORY_SHA);
  need(p.version===1&&p.source===HOME_UI.source&&p.tree===HOME_UI.tree&&p.sourceCalculationVersion===HOME_UI.sourceCalculationVersion
    &&p.servingCalculationVersion===HOME_UI.servingCalculationVersion&&p.privateIndexDigest===HOME_UI.privateIndexDigest
    &&p.inventorySha256===REVIEWED_INVENTORY_SHA&&/^[a-f0-9]{32}$/.test(p.nonce),'prepared_source');
  need(p.imageBuild.version===1&&p.imageBuild.status==='verified_exact_home_image_build'&&p.imageBuild.activationAuthorized===false
    &&p.imageBuild.imageId===p.imageId&&p.imageBuild.controllerSha===controllerSha
    &&/^sha256:[a-f0-9]{64}$/.test(p.imageId)&&/^[a-f0-9]{64}$/.test(p.imageBuild.imageArchiveSha256)
    &&p.imageBuild.source===HOME_UI.source&&p.imageBuild.tree===HOME_UI.tree
    &&p.imageBuild.sourceCalculationVersion===HOME_UI.sourceCalculationVersion
    &&p.imageBuild.intendedServingCalculationVersion===HOME_UI.servingCalculationVersion
    &&p.imageBuild.modelAssetSha256==='ee5c872e9127430890f58abf239cddfa48553f86c3032799c9c29953b6109662'
    &&Number.isSafeInteger(p.imageBuild.imageUnpackedBytes)&&p.imageBuild.imageUnpackedBytes>0
    &&p.imageBuild.privateIndexInImage===false&&p.imageBuild.resourceProbePassed===true
    &&p.imageBuild.nodeVersion==='v24.22.1'&&JSON.stringify(p.imageBuild.resourceFiles)===JSON.stringify(p.resourceFiles),'prepared_image');
  need(/^[a-f0-9]{64}$/.test(p.privateBindingPlanSha256)&&/^[a-f0-9]{64}$/.test(p.privateFileSha256)
    &&Number.isSafeInteger(p.privateFileBytes)&&p.privateFileBytes>0
    &&Number.isSafeInteger(p.imageArchiveBytes)&&p.imageArchiveBytes>0,'prepared_materials');
  return receipt;
}

export async function preparePlan(sourceRoot){
  const invocation=checkActivationInvocation(),{directory,image}=await paths();
  verifyHomeGateFiles(CONTROLLER_ROOT);const sourceProof=verifyHomeSourceCheckout(sourceRoot);
  const imageBuild=await jsonFile(path.join(image,'receipt.json'));
  need(imageBuild.controllerSha===invocation.sourceSha&&imageBuild.source===HOME_UI.source
    &&imageBuild.imageArchiveSha256===await digest(path.join(image,'image.tar')),'image_changed');
  const inventory=await jsonFile(path.join(CONTROLLER_ROOT,INVENTORY_FILE));assertReviewedInventory(inventory,REVIEWED_INVENTORY_SHA);
  const reader=githubReader(),ci=await verifyControllerCi(reader,CONTROLLER_ROOT,invocation);
  const quiescence=await assertPublicationQuiescence(reader,process.env.GITHUB_RUN_ID);
  await fs.mkdir(directory,{mode:0o700});
  const store=await storage(),nonce=randomBytes(16).toString('hex');
  const authority=await acquireHomeAuthority({storage:store,nonce,readLiveIdentity:liveIdentity});
  let prepared=false;
  try{
    const binding=await prepareHomeBindingPlan({storage:store,sourceRoot,readLiveIdentity:liveIdentity});
    const index=await store.readJson(INDEX_KEY,null);
    need(index?.version===1&&index.digest===HOME_UI.privateIndexDigest
      &&sha256(JSON.stringify(index.models))===HOME_UI.privateIndexDigest,'private_index');
    const privateBytes=Buffer.from(JSON.stringify(index));
    await fs.writeFile(path.join(directory,'calculation-v1.json'),privateBytes,{mode:0o400,flag:'wx'});
    const plan={version:1,source:HOME_UI.source,tree:HOME_UI.tree,sourceCalculationVersion:HOME_UI.sourceCalculationVersion,
      servingCalculationVersion:HOME_UI.servingCalculationVersion,privateIndexDigest:HOME_UI.privateIndexDigest,
      nonce,imageId:imageBuild.imageId,imageBuild,imageArchiveBytes:(await fs.stat(path.join(image,'image.tar'))).size,
      inventorySha256:REVIEWED_INVENTORY_SHA,privateFileSha256:sha256(privateBytes),privateFileBytes:privateBytes.length,
      resourceFiles:imageBuild.resourceFiles,privateBindingPlanSha256:binding.planSha256,
      generationId:authority.generationId,acceptedReadModelFingerprint:authority.acceptedReadModelFingerprint};
    const createdAt=new Date(),receipt={version:1,status:'awaiting_exact_home_plan_review',activationAuthorized:false,
      runId:String(process.env.GITHUB_RUN_ID),controllerSha:invocation.sourceSha,approvedControllerSha:invocation.approvedSourceSha,
      createdAt:createdAt.toISOString(),reviewExpiresAt:new Date(createdAt.getTime()+20*60000).toISOString(),
      planSha256:sha256(JSON.stringify(plan)),plan,inventory,ci,quiescence};
    checkedPrepared(receipt,{runId:process.env.GITHUB_RUN_ID,controllerSha:invocation.sourceSha});
    await authority.guard();
    await privateWrite(path.join(directory,'plan-receipt.json'),receipt);
    prepared=true;
    console.log(JSON.stringify({stage:'home_plan_ready',runId:receipt.runId,planSha256:receipt.planSha256,
      imageId:plan.imageId,imageArchiveSha256:imageBuild.imageArchiveSha256,nonce,
      reviewExpiresAt:receipt.reviewExpiresAt,markerPath:APPROVAL_MARKER,
      markerOperation:approvalOperation({runId:receipt.runId,nonce,planSha256:receipt.planSha256}),
      vmContacted:false,privateBindingWritten:false}));
    return receipt;
  }finally{if(prepared)await authority.stopHeartbeat();else await authority.release();}
}

/** The concrete IO bridge uses the already-held, exact remote flock and the
 * previously acquired publication owner; the accepted controller keeps every
 * private/public/browser/rollback transition and validates every gate receipt. */
export async function activateWithSession({session,authority,receipt,sourceProof,verifyBuild,verifyQuiescence,bind,resources,imagePath,indexPath,controllerRoot=CONTROLLER_ROOT}){
  let candidateStarted=false,closed=false,leaseReleased=false,result,failure,candidate,evidence={};
  const plan=receipt.plan;
  const io={
    withRuntimeChangeLock:async action=>{await session.call('init',{plan,reviewedPlanSha256:receipt.planSha256,inventory:receipt.inventory});return action();},
    assertFreshInventory:()=>session.call('fresh'),
    assertNonceUnused:async nonce=>need(nonce===plan.nonce,'nonce'),
    verifyPinnedBuildAndRequiredChecks:verifyBuild,
    verifyExactPrivateBinding:bind,
    acquirePublicationLease:async()=>authority.lease,
    assertLeaseOwned:async lease=>{need(lease.operationId===authority.lease.operationId,'lease_identity');await authority.guard();},
    startExactInactiveCandidate:async()=>{
      evidence.imageTransfer=await session.upload('image',imagePath,{bytes:plan.imageArchiveBytes});
      await session.upload('private-index',indexPath);
      await session.call('resources',{files:resources});
      candidateStarted=true;candidate=await session.call('start');evidence.candidate=candidate;return candidate;
    },
    verifyCandidateIdentity:()=>session.call('identity'),
    verifyPrivateCardPriceAndAuthParity:async()=>{evidence.privateParity=await session.call('parity-private');},
    runFullServerGate:async(_,nonce,phase)=>{
      need(nonce===plan.nonce,'server_nonce');
      if(phase==='public')evidence.publicParity=await session.call('parity-public');
      const proof=await session.call('server-'+phase);evidence[phase+'Server']=proof;return proof;
    },
    switchExactIngressCompareAndSwap:async()=>{await verifyQuiescence();await authority.guard();await session.call('switch');authority.setIngress('candidate');},
    verifyPublicCandidateIdentity:()=>session.call('public-identity'),
    waitForRequiredBrowserVerdict:async()=>{evidence.browser=await session.call('browser');return evidence.browser;},
    recordAcceptedRelease:async()=>{await verifyQuiescence();await authority.guard();await session.call('accept');},
    restoreExactIngressCompareAndSwap:async()=>{await session.call('rollback');authority.setIngress('retained');},
    verifyRetainedPublicIdentity:()=>session.call('retained-identity'),
    cleanupOnlyOwnedUnroutedCandidate:()=>session.call('cleanup'),
    // Keep ownership until the remote process confirms accepted state or a
    // drained retained state and releases its OS flock.
    releaseOnlyOwnedPublicationLease:async()=>{},
  };
  try{result=await acceptReviewedHomeUi(io,{sourceProof,inventory:receipt.inventory,
    reviewedInventorySha256:REVIEWED_INVENTORY_SHA,nonce:plan.nonce,controllerRoot});}
  catch(error){failure=error;}
  try{await session.close();closed=true;}
  catch(error){session.abort?.(error);failure=failure||error;}
  const outcome=result||failure?.homeUiOutcome||{release:HOME_UI.source,accepted:false,ingressState:candidateStarted?'unknown':'retained',nonce:plan.nonce};
  try{
    if(closed||!candidateStarted||outcome.accepted===true){await authority.release();leaseReleased=true;}
    else await authority.stopHeartbeat(); // Unknown remote cleanup: retain TTL, never override an owner.
  }catch(error){failure=failure||error;}
  const summary={version:1,...outcome,planSha256:receipt.planSha256,remoteCloseVerified:closed,
    leaseReleaseVerified:leaseReleased,evidence};
  if(failure){failure.homeUiOutcome=summary;throw failure;}
  return summary;
}

export async function activate(sourceRoot){
  const invocation=checkActivationInvocation(),{directory,image}=await paths();
  const receipt=checkedPrepared(await jsonFile(path.join(directory,'plan-receipt.json')),
    {runId:process.env.GITHUB_RUN_ID,controllerSha:invocation.sourceSha});
  const reader=githubReader(),store=await storage();
  const authority=await resumeHomeAuthority({storage:store,nonce:receipt.plan.nonce,readLiveIdentity:liveIdentity,
    resume:{generationId:receipt.plan.generationId,acceptedReadModelFingerprint:receipt.plan.acceptedReadModelFingerprint}});
  let handedOff=false,summary;
  try{
    let approval;
    while(Date.now()<Date.parse(receipt.reviewExpiresAt)){
      await authority.guard();approval=await findPlanApproval(reader,CONTROLLER_ROOT,receipt);if(approval)break;
      await pause(15000);
    }
    need(approval,'review_not_received');
    await privateWrite(path.join(directory,'approval.json'),approval);
    await assertPublicationQuiescence(reader,receipt.runId);await authority.guard();
    checkActivationInvocation();verifyHomeGateFiles(CONTROLLER_ROOT);
    const sourceProof=verifyHomeSourceCheckout(sourceRoot);
    need(await digest(path.join(image,'image.tar'))===receipt.plan.imageBuild.imageArchiveSha256
      &&await digest(path.join(directory,'calculation-v1.json'))===receipt.plan.privateFileSha256,'reviewed_material_changed');
    const resources={};for(const[name,filename]of Object.entries(RESOURCE_FILES)){
      const raw=await fs.readFile(path.join(CONTROLLER_ROOT,filename));need(sha256(raw)===receipt.plan.resourceFiles[name],'resource_changed');resources[name]=raw.toString('base64');
    }
    // Exclusive runner marker lets cancellation cleanup distinguish pre-contact
    // preparation from a remote process whose teardown cannot yet be proven.
    await privateWrite(path.join(directory,'vm-contact-started.json'),{planSha256:receipt.planSha256,nonce:receipt.plan.nonce});
    const session=await openHomeSshSession({root:CONTROLLER_ROOT,directory,nonce:receipt.plan.nonce,authority,
      browser:()=>runBrowserGate({root:CONTROLLER_ROOT,directory,nonce:receipt.plan.nonce})});
    handedOff=true;
    summary=await activateWithSession({session,authority,receipt,sourceProof,resources,
      imagePath:path.join(image,'image.tar'),indexPath:path.join(directory,'calculation-v1.json'),
      verifyQuiescence:()=>assertPublicationQuiescence(reader,receipt.runId),
      verifyBuild:async()=>{verifyHomeSourceCheckout(sourceRoot);verifyHomeGateFiles(CONTROLLER_ROOT);
        need(receipt.ci.codeFingerprint===(await verifyControllerCi(reader,CONTROLLER_ROOT,invocation)).codeFingerprint,'ci_changed');},
      bind:async()=>{await authority.guard();return applyReviewedHomeBinding({storage:store,sourceRoot,
        readLiveIdentity:liveIdentity,reviewedPlanSha256:receipt.plan.privateBindingPlanSha256});}});
    summary.approval=approval;
    return summary;
  }catch(error){summary=error.homeUiOutcome||{version:1,release:HOME_UI.source,accepted:false,
    ingressState:handedOff?'unknown':'retained',planSha256:receipt.planSha256};throw error;}
  finally{
    if(!handedOff)try{await authority.release();}catch{summary={...summary,leaseReleaseVerified:false};}
    if(summary)try{await privateWrite(path.join(directory,'result.json'),summary);}
    catch{const error=Error('home_activation_receipt_write_failed');error.homeUiOutcome=summary;throw error;}
  }
}

async function cleanupPreparedOnly(){
  checkActivationInvocation();const {directory}=await paths();
  let receipt;try{receipt=await jsonFile(path.join(directory,'plan-receipt.json'));}catch{return;}
  // Never clear a possibly active remote owner's lease from an always() step.
  try{await fs.stat(path.join(directory,'vm-contact-started.json'));console.log('home_cleanup_remote_owner_managed_by_session');return;}
  catch(error){if(error.code!=='ENOENT')throw error;}
  const store=await storage();
  const current=await store.readJsonWithMeta('catalog/import-lock.json',null);
  if(current.value?.lockedUntil==='')return;
  const authority=await resumeHomeAuthority({storage:store,nonce:receipt.plan.nonce,readLiveIdentity:liveIdentity,
    resume:{generationId:receipt.plan.generationId,acceptedReadModelFingerprint:receipt.plan.acceptedReadModelFingerprint},heartbeat:false});
  await authority.release();console.log('home_cleanup_owned_preparation_released');
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const mode=process.argv[2],sourceRoot=process.argv[3]?path.resolve(process.argv[3]):null;
    if(mode==='--cleanup'&&process.argv.length===3)await cleanupPreparedOnly();
    else{
      need(['--build','--prepare','--activate'].includes(mode)&&process.argv.length===4,'arguments');
      if(mode==='--build'){checkActivationInvocation();await buildHomeImageForActivation(sourceRoot,(await paths()).image);}
      if(mode==='--prepare')await preparePlan(sourceRoot);
      if(mode==='--activate')console.log(JSON.stringify(await activate(sourceRoot)));
    }
  }catch(error){if(error.homeUiOutcome)console.log(JSON.stringify(error.homeUiOutcome));
    console.error(/^home_[a-z0-9_:-]+$/.test(error.message||'')?error.message:'home_activation_failed');process.exitCode=1;}
}
