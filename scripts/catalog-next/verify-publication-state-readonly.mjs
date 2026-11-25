import {createChinaStateStorage,createChinaState,inspectChinaPublicationState} from './china-state.mjs';

// Strictly read-only, bounded diagnostic. No raw private state, credentials,
// ETags, host receipts, nonces, or supplier identities leave this process.
async function main() {
  const storage=createChinaStateStorage();
  await storage.assertPrivateBucket();
  const state=createChinaState({storage});
  const [accepted,intent,lease]=await Promise.all([state.read('accepted'),state.read('intent'),state.read('lease')]);
  const inspection=inspectChinaPublicationState({accepted,intent});
  const output={
    version:1,kind:'china-publication-state-readonly',
    status:inspection.status,
    hasAcceptedCurrent:Boolean(accepted.value?.current),
    acceptedRuntime:accepted.value?.current?.runtimeSha||null,
    hasPendingReservation:Boolean(accepted.value?.pending),
    intentStatus:intent.value?.status||null,
    leaseStatus:lease.value?.status||null,
    leaseExpired:lease.value?.status==='held' ? Date.parse(lease.value.expiresAt)<=Date.now() : null,
  };
  process.stdout.write(JSON.stringify(output)+'\n');
}
main().catch(()=>{process.stderr.write('china_publication_state_readonly_unavailable\n');process.exitCode=1;});
