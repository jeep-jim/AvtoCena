// Detached operator core. No network, CLI, storage credentials or implicit grants.
import {createHash} from 'node:crypto';
export const SHA=/^[a-f0-9]{64}$/;
export const digest=x=>createHash('sha256').update(Buffer.isBuffer(x)?x:JSON.stringify(x)).digest('hex');
export const guard=(x,code)=>{if(!x)throw Error('china_rev5_successor:'+code);};
export const RELEASE='22867cbcfaee27b2e8917b6bf880e44827f67b60';
export const CALC='4654386ca34f04041effe31f38259d0fae9c396ecda35c364e3a18dd125a4b90';
export const WORKER_CALC='a72dc08b17d43b4f2685bbc17d33cae639e2015d79c67e242042ab9a35d09ce5';
export const CONTROL='catalog/independent-market-public-v1/china/control.json';
export const REV5='9e3f73d6282465019f43dcd0370bf9c71688445a0e361dccf641bd45acc5be62';
export const OLD=Object.freeze({runId:'full-fresh-44710087159-1',generationId:'gen_1795166586455_china44710087159',readySha256:'1080f0664095d3ed784eb1134cf20ab89c0facd33489b82f575eb7d279eb7cb6'});
export const OLD_BASE='fd69b2d1e628759e7658f13139268f2513fe0afbf7b83b9ebaee1f26233c57a5';
const oldDraft=Date.parse('2026-11-21T05:02:36.435Z');
export const freshClock=n=>Number.isSafeInteger(n)&&n>0;
const shape=(p,keys)=>p&&typeof p==='object'&&Object.keys(p).length===keys.length&&keys.every(k=>Object.hasOwn(p,k));
const ref=x=>shape(x,['runId','generationId','readySha256'])&&/^full-fresh-[1-9][0-9]{0,19}-1$/.test(x.runId)&&/^gen_[0-9]{13}_china[1-9][0-9]{0,19}$/.test(x.generationId)&&x.generationId.endsWith('_china'+x.runId.split('-')[2])&&SHA.test(x.readySha256);
const ordered=x=>({runId:x.runId,generationId:x.generationId,readySha256:x.readySha256});
const soundControl=x=>typeof x?.etag==='string'&&x.etag.length>0&&x.etag.length<=256&&!/[\r\n]/.test(x.etag)&&SHA.test(x.checksum)&&x.checksum===digest(x.state)&&x.state.version===1&&x.state.market==='china';
export function verifyRev5Control(x){
 guard(soundControl(x)&&x.checksum===REV5&&x.state.revision===5&&digest(x.state.active)===OLD_BASE,'rev5_drift');
}
export function acceptedIncumbent(v,now){
 // Old preparation time is not reclassified as fresh, even if never elapsed.
 guard(v?.readySha256===OLD.readySha256&&v.generationId===OLD.generationId&&v.acceptedPreviouslyPublished===true&&
   freshClock(v.acceptedLegalUntil)&&v.acceptedLegalUntil>now&&v.acceptedLegalUntil>=oldDraft,'accepted_rollback_not_legal');
}
function strictSource(source,now){
 guard(shape(source,['terminalWitnessSha256','archiveSha256','sourceReceiptSha256','observedAt','validUntil','cursor','replicaSha256'])&&
  [source.terminalWitnessSha256,source.archiveSha256,source.sourceReceiptSha256,source.replicaSha256].every(x=>SHA.test(x))&&
  freshClock(source.observedAt)&&freshClock(source.validUntil)&&source.observedAt<=now&&now<source.validUntil&&
  source.validUntil-source.observedAt<=48*3600_000&&Number.isSafeInteger(source.cursor)&&source.cursor>=13180841,'source_missing_or_expired');
}
export function preparePins({source,now,sourceArchiveRows,sourceShards,authenticatedTerminalArchiveSha256}){
 strictSource(source,now);
 guard(authenticatedTerminalArchiveSha256===source.archiveSha256&&Number.isSafeInteger(sourceArchiveRows)&&sourceArchiveRows>=100000&&sourceArchiveRows<=400000&&
   Number.isSafeInteger(sourceShards)&&sourceShards>0&&sourceShards<=1500,'authenticated_native_archive_census_missing');
 return Object.freeze({expectedChinaPublicControlSha256:REV5,expectedChinaPublicBaseSha256:OLD_BASE,sourceArchiveRows,sourceShards,
  source:Object.freeze({...source}),release:RELEASE,calculationVersion:CALC,workerCalculationVersion:WORKER_CALC,publicationAuthorized:false,cursorAdvanceAuthorized:false});
}
export async function activateRev5Successor({approvedBytes,approvedSha256,now=Date.now,ops}){
 guard(Buffer.isBuffer(approvedBytes)&&approvedBytes.length>0&&approvedBytes.length<=32*1024&&digest(approvedBytes)===approvedSha256,'approval_bytes');
 const p=JSON.parse(approvedBytes.toString('utf8'));
 guard(shape(p,['version','kind','expectedControlSha256','expectedBaseSha256','release','calculationVersion','workerCalculationVersion','authorizationSha256','target','source','ready','validUntil','noIngress','cursorAdvanceAuthorized'])&&
   p.version===1&&p.kind==='china-rev5-successor-no-ingress-v1'&&p.expectedControlSha256===REV5&&p.expectedBaseSha256===OLD_BASE&&p.release===RELEASE&&p.calculationVersion===CALC&&p.workerCalculationVersion===WORKER_CALC&&
   SHA.test(p.authorizationSha256)&&ref(p.target)&&p.target.generationId!==OLD.generationId&&p.noIngress===true&&p.cursorAdvanceAuthorized===false&&
   shape(p.ready,['manifestSha256','pricingReceiptSha256','admittedRows'])&&[p.ready.manifestSha256,p.ready.pricingReceiptSha256].every(x=>SHA.test(x))&&
   Number.isSafeInteger(p.ready.admittedRows)&&p.ready.admittedRows>=100000&&p.ready.admittedRows<=400000&&freshClock(p.validUntil)&&
   p.validUntil<=p.source?.validUntil&&p.validUntil<=now()+15*60_000,'scope');
 const check=()=>{strictSource(p.source,now());guard(now()<p.validUntil,'approval_expired');};
 const verify=async()=>{check();await ops.reauthenticate({approvedSha256,authorizationSha256:p.authorizationSha256,expected22867:RELEASE});check();};
 await verify();
 const before=await ops.readControl();verifyRev5Control(before);
 const recheck=async()=>{
   check();const again=await ops.readControl();verifyRev5Control(again);
   guard(again.etag===before.etag,'same_digest_new_opaque_etag');
 };
 const [prior,newer]=await Promise.all([ops.openAcceptedRev5({checksum:REV5,etag:before.etag,assertCurrent:recheck}),ops.openStrictCandidate(ordered(p.target),recheck)]);
 acceptedIncumbent(prior,now());
 const s=newer?.source;
 guard(newer?.generationId===p.target.generationId&&newer.readySha256===p.target.readySha256&&newer.manifestSha256===p.ready.manifestSha256&&
   newer.pricingReceiptSha256===p.ready.pricingReceiptSha256&&newer.calc===p.workerCalculationVersion&&newer.admittedRows===p.ready.admittedRows&&
   newer.expectedChinaPublicBaseSha256===OLD_BASE&&newer.archiveSha256===p.source.archiveSha256&&newer.strictFreshCandidate===true&&
   s?.complete===true&&s.receiptSha256===p.source.sourceReceiptSha256&&s.observedAt===p.source.observedAt&&s.validUntil===p.source.validUntil&&
   s.cursor?.sequence===p.source.cursor&&s.cursor?.stream==='che168'&&s.cursor?.anchorSha256===p.source.replicaSha256&&
   freshClock(newer.validUntil)&&p.validUntil<=newer.validUntil&&now()<newer.validUntil,'strict_candidate_readiness');
 const proof=await ops.probeNative22867Private({readySha256:p.target.readySha256,generationId:p.target.generationId,assertCurrent:recheck});
 check();
 guard(proof?.runtimeRelease===RELEASE&&proof.readySha256===p.target.readySha256&&proof.generationId===p.target.generationId&&
  freshClock(proof.checkedAt)&&proof.checkedAt<=now()&&now()-proof.checkedAt<5*60_000&&
  /^[a-f0-9]{24}$/.test(proof.cardId)&&Number.isSafeInteger(proof.listRub)&&proof.listRub>0&&proof.detailRub===proof.listRub&&
  Number.isSafeInteger(proof.filteredCount)&&proof.filteredCount>=1&&proof.filteredCount<=newer.admittedRows,'private_native_parity');
 await verify(); await newer.assertCurrent();await prior.assertCurrent();await recheck();acceptedIncumbent(prior,now());check();
 const state={version:1,market:'china',revision:6,active:ordered(p.target),previous:OLD};
 // The checksum authorizes bytes. Only opaque storage ETag is the If-Match.
 // No write retry on timeouts/conflict; caller must reconcile observed state.
 await ops.casOneControl(CONTROL,Buffer.from(JSON.stringify(state)),before.etag,p.validUntil);
 const after=await ops.readControl();
 guard(soundControl(after)&&after.checksum===digest(state),'verify_receipt_indeterminate_reconcile_no_replay');
 return Object.freeze({status:'china_rev6_control_cas_verified',revision:6,controlSha256:after.checksum,liveGeneration:p.target.generationId,
  previousGeneration:OLD.generationId,previousRetained:true,publicIngressChanged:false,cursorAdvanced:false});
}

/** Separately approved immediate restore with rev6 still exact. Never retried
 * blindly or bundled into activate. The ref must come from the proven rev5
 * history; no write to global control, host or provider cursor. */
export async function restorePreviouslyAcceptedRev5({approvedBytes,approvedSha256,now=Date.now,ops}){
 guard(Buffer.isBuffer(approvedBytes)&&approvedBytes.length>0&&approvedBytes.length<=32*1024&&digest(approvedBytes)===approvedSha256,'rollback_approval_bytes');
 const p=JSON.parse(approvedBytes.toString('utf8'));
 guard(shape(p,['version','kind','expectedRev6Sha256','exactRev5Sha256','from','release','authorizationSha256','validUntil','noIngress','cursorAdvanceAuthorized'])&&
  p.version===1&&p.kind==='china-exact-rev6-rollback-no-ingress-v1'&&p.exactRev5Sha256===REV5&&p.release===RELEASE&&
  SHA.test(p.expectedRev6Sha256)&&SHA.test(p.authorizationSha256)&&ref(p.from)&&freshClock(p.validUntil)&&p.validUntil<=now()+15*60_000&&
  p.noIngress===true&&p.cursorAdvanceAuthorized===false,'rollback_scope');
 const fresh=()=>guard(now()<p.validUntil,'rollback_approval_expired');
 const authenticate=async()=>{fresh();await ops.reauthenticate({approvedSha256,authorizationSha256:p.authorizationSha256,expected22867:RELEASE});fresh();};
 const exact=x=>guard(soundControl(x)&&x.checksum===p.expectedRev6Sha256&&x.state.revision===6&&
   digest(x.state.active)===digest(ordered(p.from))&&digest(x.state.previous)===OLD_BASE,'rollback_incumbent_changed');
 await authenticate();const before=await ops.readControl();exact(before);
 const recheck=async()=>{fresh();const again=await ops.readControl();exact(again);guard(before.etag===again.etag,'same_digest_new_opaque_etag');};
 const old=await ops.openAcceptedRev5({checksum:p.expectedRev6Sha256,etag:before.etag,allowExactPreviouslyPublishedBackup:OLD_BASE,assertCurrent:recheck});
 acceptedIncumbent(old,now());
 await authenticate();await old.assertCurrent();await recheck();acceptedIncumbent(old,now());fresh();
 const next={version:1,market:'china',revision:7,active:OLD,previous:ordered(p.from)};
 await ops.casOneControl(CONTROL,Buffer.from(JSON.stringify(next)),before.etag,p.validUntil);
 const after=await ops.readControl();
 guard(soundControl(after)&&after.checksum===digest(next),'rollback_receipt_indeterminate_reconcile_no_replay');
 return Object.freeze({status:'china_previous_accepted_cut_restored',revision:7,controlSha256:after.checksum,liveGeneration:OLD.generationId,
  publicIngressChanged:false,cursorAdvanced:false});
}
