// Offline review adapter for one lane. Never import the provider/source writer,
// storage client, FX resolver, runtime deployment, or pointer CAS.
import { createHash } from 'node:crypto';
import { constants, promises as fs } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { assessMarketScheduleAdmission } from './lib/catalog-market-schedule-admission.mjs';

const SHA = /^[a-f0-9]{64}$/;
const natural = (n) => Number.isSafeInteger(n) && n > 0;
const digest = (b) => createHash('sha256').update(b).digest('hex');
const plain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const boundedJson = (bytes, expected) => {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > 16384 || !SHA.test(expected ?? '') || digest(bytes) !== expected)
    throw new Error('input_sha');
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { throw new Error('input_json'); }
  if (!plain(value)) throw new Error('input_json');
  return value;
};
const demand = (ok, reason) => { if (!ok) throw new Error(reason); };
const noEffects = () => ({ supplierRequests: 0, storageWrites: 0, scheduleChanged: false,
  cursorAdvanceAuthorized: false, publicationAuthorized: false });
const priceIntent = Object.freeze({ phase: 'after_verified_new_archive', policy: 'freeze_once_per_prepare_run',
  sameReceiptThroughoutPrepareVerifyReadback: true, calendarRolloverRequiresNewReceipt: false,
  actualSourceAndTariffHorizonStillRequired: true });
const sameText = (a, b) => typeof a === 'string' && a === b;

export function inspectChinaRecurringReadiness({ acknowledgement, expectedAckSha256, acceptedPlan, pinnedDryEvidence, now }) {
  const ack = boundedJson(acknowledgement, expectedAckSha256);
  demand(ack.version === 1 && ack.kind === 'china-recurring-baseline-ack-v1' && ack.market === 'china'
     && ack.reviewOnly === true && ack.publicationAuthorized === false && ack.cursorAdvanceAuthorized === false, 'ack_scope');
  const plan = boundedJson(acceptedPlan, ack.planSha256);
  const evidence = boundedJson(pinnedDryEvidence, ack.dryEvidenceSha256);
  demand(plan.version === 1 && plan.kind === 'china-independent-daily-dry-v1' && plan.market === 'china'
    && natural(plan.revision) && SHA.test(plan.controlSha256 ?? '') && SHA.test(plan.target?.readySha256 ?? '')
    && SHA.test(plan.archiveSha256 ?? '') && SHA.test(plan.snapshotConfigSha256 ?? '')
    && /^catalog\/nonjp-intake\/v1\/china\/[1-9]\d{0,19}\/[1-9]\d{0,5}$/.test(plan.archiveRoot ?? ''), 'plan_scope');
  demand(evidence.version === 1 && evidence.kind === 'china-independent-daily-dry-evidence-v1' && evidence.market === 'china'
    && evidence.revision === plan.revision && evidence.controlSha256 === plan.controlSha256
    && sameText(evidence.generationId, plan.target.generationId) && natural(evidence.sourceRows)
    && evidence.nativeResume?.mode === 'local_replica_and_changes'
    && natural(evidence.nativeResume.initialCursor) && evidence.nativeResume.initialCursor === ack.controlCursor
    && SHA.test(evidence.nativeResume.replicaSha256 ?? '')
    && evidence.supplierRequests === 0 && evidence.storageWrites === 0 && evidence.nextArchiveMustBeFresh === true
    && evidence.publicationAuthorized === false && evidence.cursorAdvanceAuthorized === false, 'dry_evidence_scope');
  demand(ack.accepted?.receiptSha256 === plan.controlSha256 && ack.accepted?.revision === plan.revision, 'ack_active_mismatch');
  // The installed cut may be past *draft* validity. Check its actual accepted
  // horizon; future incoming source and tariff bounds are checked by native
  // preparation, not here and never by a calendar-day label.
  demand(typeof now === 'string' && typeof evidence.acceptedLegalUntil === 'number'
    && Number.isFinite(Date.parse(now)) && evidence.acceptedLegalUntil > Date.parse(now), 'accepted_horizon');
  const scheduled = assessMarketScheduleAdmission({ market: 'china', now, held: ack.held,
    ownerEnabled: ack.ownerEnabled, baseline: ack.baseline, accepted: ack.accepted,
    scheduledWakeAt: ack.scheduledWakeAt, claim: ack.claim });
  if (scheduled.decision === 'hold') return { status: 'held', reason: scheduled.reason, ...noEffects() };
  demand(scheduled.decision === 'eligible_stored_source_claim', 'wrong_lane');
  return { status: 'china_one_lane_review_only', slotKey: scheduled.slotKey,
    expectedActive: scheduled.expectedActive, readySha256: plan.target.readySha256,
    archiveSha256: plan.archiveSha256, initialCursor: evidence.nativeResume.initialCursor,
    next: 'independent_authenticated_claim_then_existing_native_source_only_actor',
    priceIntent, ...noEffects(), newCollectionAuthorized: false };
}

async function localFile(filename) {
  demand(typeof filename === 'string' && filename.length > 0, 'args');
  const handle = await fs.open(filename, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const st = await handle.stat();
    demand(st.isFile() && st.size > 0 && st.size <= 16384, 'local_file');
    const b = Buffer.alloc(st.size + 1);
    let offset = 0;
    while (offset < b.length) {
      const r = await handle.read(b, offset, b.length - offset, offset);
      if (!r.bytesRead) break;
      offset += r.bytesRead;
    }
    demand(offset === st.size, 'local_file');
    return b.subarray(0, offset);
  } finally { await handle.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { values } = parseArgs({ options: { ack: {type:'string'}, 'expected-ack-sha': {type:'string'},
      'accepted-plan': {type:'string'}, 'dry-evidence': {type:'string'} } });
    const result = inspectChinaRecurringReadiness({ acknowledgement: await localFile(values.ack),
      expectedAckSha256: values['expected-ack-sha'], acceptedPlan: await localFile(values['accepted-plan']),
      pinnedDryEvidence: await localFile(values['dry-evidence']), now: new Date().toISOString() });
    console.log(JSON.stringify(result));
    if (result.status === 'held') process.exitCode = 2;
  } catch {
    console.error(JSON.stringify({ status: 'held', reason: 'local_review_input_unverified', ...noEffects() }));
    process.exitCode = 2;
  }
}
