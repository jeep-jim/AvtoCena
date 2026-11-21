/** China-only decision/receipt contract, no dispatcher, environment, network or storage. */
import {createHash} from 'node:crypto';
const H=/^[0-9a-f]{64}$/,ID=/^[1-9]\d{0,19}$/,G=/^gen_\d{13}_[a-z0-9]{1,64}$/,R=/^catalog\/provider-replicas\/che168\/[0-9a-f-]{36}$/;
const DAY=86400000,HOUR=3600000,TARGET=14*HOUR;
export const REV6=Object.freeze({controlSha256:'8314e862b8aba06c1a72f7ac578cb3d521a7fb09e9944ec9f31441710d00414b',revision:6,
 generationId:'gen_1795239842026_china44871616387',cursor:13196544,sourceObservedAt:1795233875417,
 readySha256:'c66a7f5e6b0ee3373e8d850195bfe34409adec641f86457d0e2485bc7a07494e',
 terminalSha256:'3eb0b346ce24d3f3503ebfdd0cd95968ebb8375b3bc44ec13683cc692c9a9d79',archiveSha256:'c438e8f3476783d0e0d0b567199f635e40c3089eff8806ca2f2d6c54c482cb46'});
export const sha=x=>createHash('sha256').update(Buffer.isBuffer(x)?x:JSON.stringify(x)).digest('hex');
const need=(x,r)=>{if(!x)throw Error('china_daily_durable:'+r);};
const int=n=>Number.isSafeInteger(n)&&n>0;
const hash=v=>H.test(v??'');
const sameFields=(a,b,fields)=>fields.every(k=>a?.[k]!==undefined&&a[k]===b?.[k]);

/** The caller must authenticate official run/job and pinned main content independently.
 * Inputs can never authorize another event, repo, replay slot or working base. */
export function qualifyNominalSlot({run,now,slotState,base,replay,workflowPath}){
 need(run?.repositoryId===1289722938&&run.repository==='jeep-jim/AvtoCena'&&run.headBranch==='main'&&run.event==='schedule'&&
  run.attempt===1&&run.cron==='0 14 * * *'&&run.workflowPath===workflowPath&&workflowPath==='.github/workflows/china-independent-daily.yml'&&
  run.officialProof===true&&ID.test(run.runId??'')&&/^[a-f0-9]{40}$/.test(run.headSha??'')&&int(run.createdAt)&&int(now)&&run.createdAt<=now&&
  slotState?.readable===true&&slotState.atomicallyClaimedForRunId===run.runId,'scheduled_owner');
 const slotAt=Math.floor(run.createdAt/DAY)*DAY+TARGET;
 need(run.createdAt>=slotAt&&run.createdAt<slotAt+4*HOUR&&now<slotAt+6*HOUR&&slotState.slotAt===slotAt&&
  slotState.previousCount===0&&Number.isSafeInteger(slotState.previousCount)&&slotState.previousCount>=0,'late_duplicate_or_catchup');
 need(base?.accepted===true&&base.market==='china'&&hash(base.controlSha256)&&G.test(base.generationId??'')&&
  int(base.cursor)&&hash(base.replicaSha256)&&R.test(base.replicaRoot??'')&&hash(base.snapshotBinding)&&int(base.sourceObservedAt),
  'accepted_base');
 // Provider replay entitlement/bounds is independent from the app 48h
 // candidate freshness clock. No assumption from dashboard or 3-day snapshot cadence.
 need(replay?.verified===true&&int(replay.minimumCoveredCursor)&&base.cursor>=replay.minimumCoveredCursor&&
  base.sourceObservedAt<=now&&int(replay.expiresAt)&&now<replay.expiresAt&&int(replay.maxChangeRequests)&&
  int(replay.maxLinkedRequests)&&replay.allowFreshSnapshot===false&&replay.extraFeesAuthorized===false,'provider_replay_uncertain');
 return Object.freeze({kind:'china-durable-daily-slot-v1',slotAt,runId:run.runId,market:'china',controlSha256:base.controlSha256,
  baseCursor:base.cursor,replicaSha256:base.replicaSha256,snapshotBinding:base.snapshotBinding,scheduledOnly:true,
  publicWriteAllowed:false,legacyCursorWriteAllowed:false,providerSnapshotAllowed:false});
}
export function decideTerminal({slot,base,terminal,now}){
 need(slot?.kind==='china-durable-daily-slot-v1'&&slot.market==='china'&&slot.publicWriteAllowed===false&&slot.legacyCursorWriteAllowed===false&&
  base?.accepted===true&&slot.controlSha256===base.controlSha256&&slot.baseCursor===base.cursor&&slot.replicaSha256===base.replicaSha256&&
  slot.snapshotBinding===base.snapshotBinding&&terminal?.market==='china'&&terminal.source==='che168'&&terminal.runId===slot.runId&&
  terminal.slotAt===slot.slotAt&&terminal.baseControlSha256===base.controlSha256&&terminal.fromCursor===base.cursor&&
  terminal.baseReplicaSha256===base.replicaSha256&&terminal.snapshotBinding===base.snapshotBinding,'terminal_lineage');
 if(terminal.status==='partial'){
  need(terminal.publicWriteAllowed===false&&hash(terminal.partialReceiptSha256)&&int(terminal.privateCursor)&&terminal.privateCursor>=base.cursor&&
   terminal.terminalEmptyWireSha256===undefined,'partial_not_terminal');
  return Object.freeze({action:'hold_retain_private_checkpoint',publicChanged:false,cursorChanged:false,replicaChanged:false});
 }
 need(terminal.status==='source_finished'&&terminal.providerExactlyVerified===true&&terminal.emptyFinalPageVerified===true&&
  terminal.attestedRemoteJob===true&&hash(terminal.terminalEmptyWireSha256)&&hash(terminal.terminalReceiptSha256)&&
  int(terminal.observedAt)&&terminal.observedAt>base.sourceObservedAt&&terminal.observedAt>=slot.slotAt&&terminal.observedAt<=now&&
  now<terminal.observedAt+2*DAY&&int(terminal.toCursor)&&terminal.toCursor>=base.cursor,'completed_terminal_required');
 if(terminal.toCursor===base.cursor){
  need(terminal.committedPages===0&&terminal.committedChanges===0&&terminal.providerChangeCalls===1&&terminal.linkedOfferCalls===0&&
   terminal.replicaSha256===base.replicaSha256&&terminal.replicaRoot===base.replicaRoot&&terminal.workingReplicaMutated===false,'no_delta_exact_empty');
  return Object.freeze({action:'freshness_only_keep_immutable_data',reportObservedAt:terminal.observedAt,reportValidUntil:terminal.observedAt+2*DAY,
   terminalReceiptSha256:terminal.terminalReceiptSha256,sameReplicaSha256:base.replicaSha256,
   publicChanged:false,cursorChanged:false,replicaChanged:false,doNotRelabelLiveCut:true,
   repriceIfPricingAuthorityChanged:true,ifPublicRefreshNeeded:'prepare_new_native_cut_from_same_verified_data'});
 }
 need(int(terminal.committedPages)&&int(terminal.committedChanges)&&terminal.committedChanges>=terminal.committedPages&&
  hash(terminal.archiveSha256)&&hash(terminal.replicaSha256)&&terminal.replicaSha256!==base.replicaSha256&&
  R.test(terminal.replicaRoot??'')&&terminal.replicaRoot!==base.replicaRoot&&terminal.completeInventoryVerified===true&&
  terminal.archiveReadbackVerified===true&&terminal.retainsReachableReplica===true,'changed_source_not_ready');
 return Object.freeze({action:'prepare_private_native_price',sourceObservedAt:terminal.observedAt,sourceExpiresAt:terminal.observedAt+2*DAY,
  targetCursor:terminal.toCursor,terminalReceiptSha256:terminal.terminalReceiptSha256,archiveSha256:terminal.archiveSha256,
  publicChanged:false,cursorChanged:false,replicaChanged:false});
}
/** Provider replay and regulatory FX are independently witnessed clocks.
 * Use the existing calculator's same-context single quote, not a URL response in isolation. */
export function approveIndependentPricing({decision,base,quote,offerInputs,now}){
 need(decision?.action==='prepare_private_native_price'||(decision?.action==='freshness_only_keep_immutable_data'&&offerInputs.sameVerifiedInventory===true),'pricing_decision');
 need(quote?.market==='china'&&quote?.observations===1&&['cbr','cbr_live'].includes(quote.source)&&quote.authenticatedWorker===true&&
  hash(quote.receiptSha256)&&hash(quote.nativeFingerprint)&&hash(quote.workerCalculationVersion)&&hash(quote.servingCalculationVersion)&&
  quote.nativeParityVerified===true&&quote.servingCalculationVersion===offerInputs.liveCalculationVersion&&quote.fxDatesVerified===true&&
  quote.rateEffectiveFrom<=quote.pricingAsOf&&quote.pricingAsOf<=quote.observedAt&&quote.observedAt<=now&&now<quote.rateEffectiveUntil&&
  int(quote.legalValidUntil)&&now<quote.legalValidUntil&&offerInputs.market==='china'&&offerInputs.baseControlSha256===base.controlSha256&&
  ['CNY','USD','EUR','RUB'].every(k=>Number.isFinite(quote.rates?.[k])&&quote.rates[k]>0)&&quote.rates.RUB===1,
  'native_frozen_fx_not_current');
 const sourceUntil=decision.sourceExpiresAt??decision.reportValidUntil;
 need(now<sourceUntil&&now<(quote.stageValidUntil??0)&&quote.stageValidUntil<=quote.legalValidUntil,'prepared_expiry');
 return Object.freeze({kind:'china-daily-private-ready-input-v1',market:'china',publicChanged:false,legacyCursorChanged:false,
  expectedBaseSha256:base.controlSha256,terminalReceiptSha256:decision.terminalReceiptSha256,pricingReceiptSha256:quote.receiptSha256,
  validUntil:Math.min(sourceUntil,quote.stageValidUntil),knownPriceGenerationId:base.generationId,
  readyRequiresNativeListCountDetailAndRollback:true});
}
export function checkRetainedParity({base,next,rollback}){
 need(base?.market==='china'&&next?.market==='china'&&next?.sourceToolTouchedOtherMarket===false&&
  next?.oldArchivePruned===false&&next?.sharedAliasWritten===false&&next?.legacyCursorWritten===false&&
  rollback?.preservedImmutableRef===true&&sameFields(rollback,base,['generationId','readySha256']),'market_isolation_and_rollback');
 if(next.kind==='observation-only'){
  need(sameFields(base,next,['generationId','readySha256','controlSha256','cursor','replicaSha256','publicIndexSha256','priceBlockSha256','archiveSha256']),
   'no_delta_must_keep_old_bytes');
 }
 return true;
}

/** Resume only an authenticated, still-private prefix of this accepted lineage.
 * Token/head stay opaque. Never re-issue the first request on a stale or lost state. */
export function choosePrivateReplayStart({slot,base,retained,replay,now}){
 need(slot?.kind==='china-durable-daily-slot-v1'&&slot.controlSha256===base.controlSha256&&slot.baseCursor===base.cursor&&
  slot.replicaSha256===base.replicaSha256&&slot.snapshotBinding===base.snapshotBinding,'replay_slot_scope');
 need(retained?.signedReadObserved===true&&retained?.decisionKnown===true,'private_head_unknown');
 if(retained.state==='none')return Object.freeze({mode:'accepted_base_changes_only',cursor:base.cursor});
 const p=retained.checkpoint;
 need(retained.state==='verified_partial'&&p?.market==='china'&&p?.source==='che168'&&p.baseControlSha256===base.controlSha256&&
  p.baseCursor===base.cursor&&p.baseReplicaSha256===base.replicaSha256&&p.snapshotBinding===base.snapshotBinding&&
  p.publicationAuthorized===false&&p.cursorAdvanceAuthorized===false&&p.wasTerminal===false&&
  int(p.cursor)&&p.cursor>=base.cursor&&int(p.chainDepth)&&p.chainDepth<=4&&hash(p.receiptSha256)&&hash(p.headSha256)&&
  int(p.expiresAt)&&now<p.expiresAt&&now<replay.expiresAt&&p.cursor>=replay.minimumCoveredCursor,'unsafe_private_resume');
 return Object.freeze({mode:'verified_private_changes_only',cursor:p.cursor,headSha256:p.headSha256,checkpointSha256:p.receiptSha256});
}
