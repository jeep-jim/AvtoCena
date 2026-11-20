import {ObjectJsonStorage} from '../data';
import {CHINA_PUBLIC_CONTROL,chinaObjectDigest,openChinaStageObjectFiles,readChinaPublicState,readConfiguredRegcloudScope,
 chinaLegacyRollback,assertChinaLegacyRollback,validChinaPointerTarget,type ChinaConfiguredStorageScope,type ChinaPointerTarget,type ChinaPublicState} from './china-regcloud-object-reader';
import {openIndependentChinaRegcloud} from './independent-market-activation-fixture';

const SHA=/^[a-f0-9]{64}$/;
const fail=(code:string):never=>{throw Error('china_regcloud_switch:'+code);};
export type VerifiedChinaRuntimeProbe={
 version:1;kind:'normal-china-runtime-readback'|'normal-china-legacy-readback';readySha256?:string;legacyManifestSha256?:string;generationId:string;
 buildSha256:string;checkedAt:number;cardId:string;listRub:number;detailRub:number;filteredCount:number;
};
export type ChinaOwnSwitchPermit={
 version:1;market:'china';kind:'china-own-public-cut-cas-v1';action:'activate'|'rollback';
 storage:ChinaConfiguredStorageScope;expectedBaseSha256:string;expectedPublicControlSha256:string|null;
 target:ChinaPointerTarget;bootstrapPrevious?:ChinaPointerTarget;expectedRuntimeProbeSha256:string;validUntil:number;
};
/** Called by an independently authenticated owner-run service only. No admin
 * endpoint or default permission. This is the sole mutable key; candidate
 * and rollback generations remain immutable and available independently. */
export async function switchChinaRegcloudCut(input:{
 storage:ObjectJsonStorage;permit:ChinaOwnSwitchPermit;expectedPermitSha256:string;
 assertApprovedRunner:(permit:Readonly<ChinaOwnSwitchPermit>,sha256:string)=>Promise<void>;
 verifyNormalRuntimeReadback:(target:ChinaPointerTarget)=>Promise<VerifiedChinaRuntimeProbe>;
}){
 const {storage,expectedPermitSha256}=input;
 const p=Object.freeze({...structuredClone(input.permit),target:Object.freeze({...input.permit.target}),storage:Object.freeze({...input.permit.storage}),
  ...(input.permit.bootstrapPrevious?{bootstrapPrevious:Object.freeze({...input.permit.bootstrapPrevious})}:{})});
 if(!(storage instanceof ObjectJsonStorage)||!SHA.test(expectedPermitSha256)||chinaObjectDigest(p)!==expectedPermitSha256||
    p.version!==1||p.market!=='china'||p.kind!=='china-own-public-cut-cas-v1'||!['activate','rollback'].includes(p.action)||
    !validChinaPointerTarget(p.target)||!SHA.test(p.expectedBaseSha256)||!SHA.test(p.expectedRuntimeProbeSha256)||
    !(p.expectedPublicControlSha256===null||SHA.test(p.expectedPublicControlSha256))||
    !Number.isSafeInteger(p.validUntil)||Date.now()>=p.validUntil||typeof input.assertApprovedRunner!=='function'||
    typeof input.verifyNormalRuntimeReadback!=='function')return fail('permit');
 const storageScope=chinaObjectDigest(readConfiguredRegcloudScope());
 const credentialKey=()=>chinaObjectDigest([process.env.YC_OBJECT_STORAGE_ACCESS_KEY_ID,process.env.YC_OBJECT_STORAGE_SECRET_ACCESS_KEY]);
 const key=credentialKey();
 const check=()=>{
  if(Date.now()>=p.validUntil||chinaObjectDigest(readConfiguredRegcloudScope())!==storageScope||
     Object.entries(p.storage).some(([k,v])=>readConfiguredRegcloudScope()[k as keyof ChinaConfiguredStorageScope]!==v)||
     key!==credentialKey())return fail('scope_or_expiry');
 };
 const auth=async()=>{check();await input.assertApprovedRunner(p,expectedPermitSha256);check();};
 await auth();
 const before=await readChinaPublicState(storage);
 if((before?.checksum??null)!==p.expectedPublicControlSha256||
    chinaObjectDigest(before?.state.active??null)!==p.expectedBaseSha256)return fail('base_changed');
 if(p.action==='rollback'&&(!before?.state.previous||chinaObjectDigest(before.state.previous)!==chinaObjectDigest(p.target)||p.bootstrapPrevious))
  return fail('rollback_target');
 if(p.action==='activate'&&(chinaLegacyRollback(p.target)||p.target.generationId===before?.state.active.generationId||
    (before&&p.bootstrapPrevious)))return fail('activate_target');
 const previous=before?.state.active??p.bootstrapPrevious;
 if(!previous||!validChinaPointerTarget(previous)||previous.generationId===p.target.generationId)return fail('verified_rollback_required');
 const assertUnchanged=async()=>{
  check();
  const again=await readChinaPublicState(storage);
  if((again?.checksum??null)!==(before?.checksum??null)||(again?.etag??null)!==(before?.etag??null))return fail('base_changed');
 };
 const verify=async(ref:ChinaPointerTarget)=>{
  if(chinaLegacyRollback(ref)){
   const guard=async()=>{await assertUnchanged();await assertChinaLegacyRollback(storage,ref);await assertUnchanged();};
   await guard();return {stage:null,assertPointer:guard};
  }
  const stage=await openChinaStageObjectFiles(storage,ref,assertUnchanged);
  await openIndependentChinaRegcloud(stage).openChinaPrepared();
  return {stage,assertPointer:stage.assertPointer};
 };
 const [target,backup]=await Promise.all([verify(p.target),verify(previous)]);
 if(p.action==='activate'&&target.stage?.durable.expectedChinaPublicBaseSha256!==p.expectedBaseSha256)return fail('candidate_base');
 const proof=await input.verifyNormalRuntimeReadback(p.target);
 const selected=p.target;
 const matching=chinaLegacyRollback(selected)?proof?.kind==='normal-china-legacy-readback'&&proof.legacyManifestSha256===selected.manifestSha256&&proof.readySha256===undefined:
  'readySha256' in selected&&proof?.kind==='normal-china-runtime-readback'&&proof.readySha256===selected.readySha256&&proof.legacyManifestSha256===undefined;
 if(!proof||proof.version!==1||!matching||chinaObjectDigest(proof)!==p.expectedRuntimeProbeSha256||
    proof.generationId!==p.target.generationId||!SHA.test(proof.buildSha256)||
    !Number.isSafeInteger(proof.checkedAt)||proof.checkedAt>Date.now()||proof.checkedAt<Date.now()-5*60_000||
    typeof proof.cardId!=='string'||!/^[A-Za-z0-9_:-]{1,150}$/.test(proof.cardId)||
    !Number.isSafeInteger(proof.listRub)||proof.listRub<=0||proof.listRub!==proof.detailRub||
    !Number.isSafeInteger(proof.filteredCount)||proof.filteredCount<1||(target.stage&&proof.filteredCount>target.stage.ready.admittedRows))
  return fail('normal_runtime_readback');
 await auth();await target.assertPointer();await backup.assertPointer();check();
 const revision=(before?.state.revision??0)+1;
 if(!Number.isSafeInteger(revision))return fail('revision');
 const next:ChinaPublicState={version:1,market:'china',revision,active:p.target,previous};
 // Storage signs the exact precondition on the wire; conflict is never retried
 // as an unconditional write. No cursor/external/neighbor write.
 await storage.compareAndSwapScopedControl(CHINA_PUBLIC_CONTROL,Buffer.from(JSON.stringify(next)),before?.etag??null);
 const after=await readChinaPublicState(storage);
 if(!after||after.checksum!==chinaObjectDigest(next))return fail('activation_readback_changed');
 return {state:after.state,controlSha256:after.checksum};
}
