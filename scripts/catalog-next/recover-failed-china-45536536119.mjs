import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createChinaStateStorage,createChinaState,inspectChinaPublicationState} from './china-state.mjs';
import {openChinaSshSession} from './release-ssh.mjs';

// One-time, proof-bound recovery for a specific failed publication. Never
// publish, delete, cleanup, start the candidate, or touch another market.
const FAILED_RUN='45536536119';
const FAILED_RUNTIME='38895e53f7f770ee68edb0b8ad53056468b928a5';
const FAILED_GENERATION='gen_china_45369451603_1';
const FAILED_NONCE='bbc8a1aa9f4b73e6aaab3665fbdf0c1f';
const PREVIOUS_PUBLIC='56d6b94fea70457e0ce2b0820596da9972846b90';
const root=fileURLToPath(new URL('../../',import.meta.url));
const need=(ok,code)=>assert(ok,'china_exact_recovery_'+code);
const same=(a,b)=>a.found===b.found&&a.etag===b.etag&&a.sha256===b.sha256;
const checkIntent=(intent)=>{
  need(intent.found && intent.value?.market==='china' &&
    intent.value?.owner?.runId===FAILED_RUN &&
    intent.value?.nonce===FAILED_NONCE &&
    intent.value?.candidate?.runtimeSha===FAILED_RUNTIME &&
    intent.value?.candidate?.generationId===FAILED_GENERATION,'target');
};
async function oldPublicHealth(){
  const response=await fetch('https://avtocena.com/api/health',{cache:'no-store',signal:AbortSignal.timeout(15000)});
  need(response.ok,'public_health');
  const data=await response.json();
  need(data.ok===true && data.releaseSha===PREVIOUS_PUBLIC,'public_identity');
}
async function main(){
  need(process.env.GITHUB_REPOSITORY==='jeep-jim/AvtoCena' &&
    process.env.GITHUB_REPOSITORY_ID==='1289722938' &&
    process.env.GITHUB_REF==='refs/heads/main' &&
    process.env.GITHUB_RUN_ATTEMPT==='1' &&
    /^[1-9]\d+$/.test(process.env.GITHUB_RUN_ID||'') &&
    /^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA||'') &&
    typeof process.env.SSH_PRIVATE_KEY==='string' && process.env.SSH_PRIVATE_KEY.length>0,
  'invocation');
  const storage=createChinaStateStorage();
  await storage.assertPrivateBucket();
  const state=createChinaState({storage});
  let [accepted,intent,previousLease]=await Promise.all(['accepted','intent','lease'].map(key=>state.read(key)));
  const before=inspectChinaPublicationState({accepted,intent}).status;
  if(before==='resolved'){
    need(!accepted.value?.current && !accepted.value?.pending,'resolved_identity');
    process.stdout.write(JSON.stringify({kind:'china-exact-recovery',failedRun:FAILED_RUN,status:'already_resolved'})+'\n');
    return;
  }
  need(['reserved','rollback_needs_evidence'].includes(before),'state_not_recoverable');
  checkIntent(intent);
  need(!accepted.value?.current && (previousLease.value?.status==='released' ||
    previousLease.value?.status==='held' && Date.parse(previousLease.value.expiresAt)<=Date.now()),'lease_not_free');
  await oldPublicHealth();
  const scratch=await fs.mkdtemp(path.join(process.env.RUNNER_TEMP||os.tmpdir(),'china-recovery-proof-'));
  let session;
  let lease;
  try{
    session=await openChinaSshSession({root,directory:scratch,privateKey:process.env.SSH_PRIVATE_KEY});
    const outcome=await session.call('recover',{runtimeSha:FAILED_RUNTIME,nonce:FAILED_NONCE});
    await session.close();session=null;
    need(outcome?.status==='rolled_back' && typeof outcome.hostRollbackBase64==='string' &&
      /^[a-f0-9]{64}$/.test(outcome.hostRollbackSha256||''),'host_rollback_not_proved');
    await oldPublicHealth();
    const evidence={hostRollbackBase64:outcome.hostRollbackBase64,hostRollbackSha256:outcome.hostRollbackSha256};
    const [currentAccepted,currentIntent,currentLease]=await Promise.all(['accepted','intent','lease'].map(key=>state.read(key)));
    need(same(currentAccepted,accepted)&&same(currentIntent,intent)&&same(currentLease,previousLease),'state_changed');
    lease=await state.acquireLease({previous:currentLease,
      owner:{runId:process.env.GITHUB_RUN_ID,attempt:process.env.GITHUB_RUN_ATTEMPT,revision:process.env.GITHUB_SHA},
      nonce:randomBytes(16).toString('hex'),expiresAt:new Date(Date.now()+10*60*1000).toISOString()});
    const [fencedAccepted,fencedIntent]=await Promise.all([state.read('accepted'),state.read('intent')]);
    need(same(fencedAccepted,accepted)&&same(fencedIntent,intent),'fenced_state_changed');
    if(before==='reserved')await state.abortReserved({lease,intent:fencedIntent,reservation:fencedAccepted,evidence});
    else await state.finalizeRollback({lease,intent:fencedIntent,accepted:fencedAccepted,evidence});
    const [finalAccepted,finalIntent]=await Promise.all([state.read('accepted'),state.read('intent')]);
    need(inspectChinaPublicationState({accepted:finalAccepted,intent:finalIntent}).status==='resolved'
      && !finalAccepted.value?.current && !finalAccepted.value?.pending,'not_resolved');
    await oldPublicHealth();
    process.stdout.write(JSON.stringify({kind:'china-exact-recovery',failedRun:FAILED_RUN,status:'resolved',
      initialState:before,finalState:'resolved',newMarketAccepted:false,previousRuntime:PREVIOUS_PUBLIC})+'\n');
  }finally{
    if(session){session.abort();await session.exited;}
    if(lease){try{await state.releaseLease({lease});}catch{
      process.stderr.write('china_exact_recovery_lease_release_requires_verification\n');
      process.exitCode=1;
    }}
    await fs.rm(scratch,{recursive:true,force:true});
  }
}
main().catch(error=>{
  process.stderr.write(/^china_(?:state|host|ssh|exact_recovery)_[a-z0-9_]+$/.test(error?.message||'')?
    error.message+'\n':'china_exact_recovery_unverified\n');
  process.exitCode=1;
});
