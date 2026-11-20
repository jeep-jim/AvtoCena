import path from 'node:path';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {isBoundChinaContinuity} from './bind-converted-continuity.mjs';
import {isCleanSnapshotProof} from './clean-snapshot-admission.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex'), hex=/^[a-f0-9]{64}$/;
const need=(v,c)=>{if(!v)throw Error('china_fresh_replacement_proof_'+c);};
/** Materialize only the package's source evidence. Final priced dispositions are
 * deliberately issued by a distinct native authority, not by this file writer. */
export async function writeFreshReplacementProof({continuity,proof,authorityDir,collectorClosureSha256,ownerApprovalSha256,assertRunAuthority,now=Date.now}){
 need(isBoundChinaContinuity(continuity)&&isCleanSnapshotProof(proof)&&typeof assertRunAuthority==='function'&&
  proof.oldRowsMerged===false&&proof.priced===false&&proof.continuitySha256===continuity.continuitySha256&&
  proof.nativeAdmissionSha256===continuity.result.nativeAdmissionSha256&&[collectorClosureSha256,ownerApprovalSha256,continuity.sourceReceiptSha256].every(x=>hex.test(x||'')),'authority');
 const time=()=>need(now()<proof.sourceExpiresAt,'source_expired');
 time();await assertRunAuthority();await continuity.assertContinuityCurrent();
 need(path.isAbsolute(authorityDir)&&path.normalize(authorityDir)===authorityDir&&await fs.realpath(path.dirname(authorityDir))===path.dirname(authorityDir),'destination');
 const report=await continuity.readReport();
 need(report.length>0&&report.length<=128*1024**2&&sha(report)===proof.sourceReportSha256,'report');
 await fs.mkdir(authorityDir,{mode:0o700});const reportPath=path.join(authorityDir,'native-report.json');
 await fs.writeFile(reportPath,report,{flag:'wx',mode:0o600});
 need(sha(await fs.readFile(reportPath))===proof.sourceReportSha256,'report_readback');
 const record=Object.freeze({version:1,kind:'china-complete-source-replacement-v1',market:'china',coverage:'materialized-full-active-snapshot',
  previousServingGeneration:'rollback-only',publicationAuthorized:false,cursorAdvanceAuthorized:false,ownerApprovalSha256,collectorClosureSha256,
  continuitySha256:continuity.continuitySha256,nativeAdmissionSha256:proof.nativeAdmissionSha256,nativeShardsSha256:proof.nativeShardsSha256,
  archiveManifestSha256:proof.archiveManifestSha256,sourceReceiptSha256:continuity.sourceReceiptSha256,rows:proof.sourceRows,
  rawReport:{path:'native-report.json',sha256:proof.sourceReportSha256,bytes:report.length}});
 const bytes=Buffer.from(JSON.stringify(record)),file=path.join(authorityDir,'FRESH_REPLACEMENT.json');
 await assertRunAuthority();await continuity.assertContinuityCurrent();time();
 await fs.writeFile(file,bytes,{flag:'wx',mode:0o600});need(sha(await fs.readFile(file))===sha(bytes),'proof_readback');
 return Object.freeze({record,sha256:sha(bytes),finalDispositionIssued:false,publicationAuthorized:false});
}
