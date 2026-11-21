// Apply only to a separately reviewed, isolated owner job. These imports are
// exact native writer/reader modules; don't add this to app routes or deploy it.
// A protected runner supplies fresh code/material/running-app authority and
// the exact scoped read-only preview bundle built from 22867.
import {ObjectJsonStorage} from './apps/web/lib/data';
import {CHINA_PUBLIC_CONTROL,openPreviouslyAcceptedRev5ForSuccessor,openChinaStageObjectFiles,
  readChinaPublicState,readConfiguredRegcloudScope} from './apps/web/lib/catalog/china-regcloud-object-reader';
import {openIndependentChinaRegcloud} from './apps/web/lib/catalog/independent-market-activation-fixture';
import {activateRev5Successor,restorePreviouslyAcceptedRev5,guard,RELEASE,OLD} from './rev5-successor-core.mjs';
type Scope=ReturnType<typeof readConfiguredRegcloudScope>;
const SCOPE:Scope={endpoint:'https://s3.regru.cloud',bucket:'avtocena-staging-8120751',prefix:'migration-staging/full-20261011',region:'us-east-1'};
type Authority={
  assertApprovedMainRunAnd22867Lease(input:{approvedSha256:string;authorizationSha256:string;expected22867:string}):Promise<void>;
  assertFreshSourceReceiptAndArchiveApproved():Promise<void>;
  runPinned22867NativePreview(p:{readySha256:string;generationId:string;assertCurrent:()=>Promise<void>}):Promise<{
   runtimeRelease:string;readySha256:string;generationId:string;checkedAt:number;cardId:string;listRub:number;detailRub:number;filteredCount:number}>;
};
export async function runNativeSuccessor(input:{approval:Buffer;sha256:string;authority:Authority;action:'activate'|'restore'}){
 const {authority,action}=input;let sealedCredential:readonly string[]|null=null;let sealedAuthority:{approvedSha256:string;authorizationSha256:string;expected22867:string}|null=null;
 guard(action==='activate'||action==='restore','one_explicit_verb');
 const scope=JSON.stringify(readConfiguredRegcloudScope());
 guard(Object.entries(SCOPE).every(([k,v])=>readConfiguredRegcloudScope()[k as keyof Scope]===v),'scope');
 const key=()=>[process.env.YC_OBJECT_STORAGE_ACCESS_KEY_ID??'',process.env.YC_OBJECT_STORAGE_SECRET_ACCESS_KEY??''];
 const sameScope=()=>guard(JSON.stringify(readConfiguredRegcloudScope())===scope&&(!sealedCredential||key().every((x,i)=>x===sealedCredential![i])),'scope_changed');
 const storage=new ObjectJsonStorage();
 const ops={
   async reauthenticate(expected:NonNullable<typeof sealedAuthority>){
     sameScope();guard(expected.expected22867===RELEASE,'wrong_native');
     await authority.assertApprovedMainRunAnd22867Lease(expected);
     if(action==='activate')await authority.assertFreshSourceReceiptAndArchiveApproved();
     sameScope();sealedAuthority=expected;sealedCredential??=key();
   },
   async readControl(){sameScope();return readChinaPublicState(storage);},
   async openAcceptedRev5(proof:{checksum:string;etag:string;allowExactPreviouslyPublishedBackup?:string;assertCurrent:()=>Promise<void>}){
      const old=await openPreviouslyAcceptedRev5ForSuccessor(storage,proof);
      const read=await openIndependentChinaRegcloud(old).openChinaPrepared();
      return {generationId:read.cut.generationId,readySha256:OLD.readySha256,acceptedLegalUntil:old.acceptedLegalUntil,
        acceptedPreviouslyPublished:true,assertCurrent:read.assertCurrent};
   },
   async openStrictCandidate(ref:Parameters<typeof openChinaStageObjectFiles>[1],assertCurrent:()=>Promise<void>){
      const f=await openChinaStageObjectFiles(storage,ref,assertCurrent);const v=await openIndependentChinaRegcloud(f).openChinaPrepared();
      return {generationId:v.cut.generationId,readySha256:f.readySha256,manifestSha256:f.durable.manifestSha256,
       pricingReceiptSha256:f.durable.pricingReceiptSha256,calc:v.cut.pricing.calculationVersion,admittedRows:f.durable.admittedRows,
       expectedChinaPublicBaseSha256:f.durable.expectedChinaPublicBaseSha256,archiveSha256:f.durable.archiveSha256,strictFreshCandidate:true,
       source:v.cut.source,validUntil:Math.min(f.ready.validUntil,f.durable.validUntil),assertCurrent:v.assertCurrent};
   },
   async probeNative22867Private(args:Parameters<Authority['runPinned22867NativePreview']>[0]){
     sameScope();await args.assertCurrent();const proof=await authority.runPinned22867NativePreview(args);
     await args.assertCurrent();sameScope();return proof;
   },
   async casOneControl(key:string,data:Buffer,etag:string,validUntil:number){
     sameScope();guard(key===CHINA_PUBLIC_CONTROL&&sealedAuthority&&etag,'narrow_existing_control_only');
     await authority.assertApprovedMainRunAnd22867Lease(sealedAuthority!);
     // Core has completed final freshness/seal/readback; native transport still
     // enforces exact captured ETag in If-Match, including after this auth check.
     sameScope();guard(Date.now()+10_000<validUntil,'insufficient_cas_headroom');
     await storage.compareAndSwapScopedControl(CHINA_PUBLIC_CONTROL,data,etag,Math.min(validUntil,Date.now()+25_000));
   },
 };
 const run=action==='activate'?activateRev5Successor:restorePreviouslyAcceptedRev5;
 return run({approvedBytes:input.approval,approvedSha256:input.sha256,ops});
}
