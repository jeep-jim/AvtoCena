import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {rawDigest} from './catalog-raw-provenance.mjs';
import {createSourceContributionProtocol} from './catalog-source-contributions.mjs';
import {mergeOfferVersions} from './catalog-offer-merge.mjs';
import {assertChe168ReplicaInputWitness,CHE168_REPLICA_WITNESS_KIND,CHE168_REPLICA_WITNESS_SOURCE} from './che168-replica-witness.mjs';

const sourceId=CHE168_REPLICA_WITNESS_SOURCE,COMMIT=/^[a-f0-9]{40}$/;
const sourceRow=row=>typeof row?.id==='string' && /^[a-zA-Z0-9_-]{1,200}$/.test(row.id)
  && row.sourceId===sourceId && row.market==='china' && row.operational?.provider==='auto-api.com';

/** Actual publisher checkout, distinct from workflow owner and input producer.
 * A missing or changed tracked code closure makes only the optional proof unavailable. */
export function che168ContributionWorkerSource(root=fileURLToPath(new URL('../../',import.meta.url))) {
  const options={cwd:root,encoding:'utf8',timeout:10000,maxBuffer:1024*1024,stdio:['ignore','pipe','pipe']};
  try {
    execFileSync('git',['ls-files','--error-unmatch','scripts/lib/catalog-che168-contributions.mjs',
      'scripts/lib/catalog-source-contributions.mjs','scripts/lib/catalog-source-contribution-authority.mjs','scripts/lib/catalog-offer-merge.mjs','scripts/lib/che168-replica-witness.mjs',
      'scripts/catalog-auto-api-che168-bulk-intake.mjs','scripts/catalog-publish-market.mjs',
      'apps/web/lib/catalog/auto-api-che168.ts'],options);
    execFileSync('git',['diff','--quiet','HEAD','--'],options);
    const sha=execFileSync('git',['rev-parse','--verify','HEAD'],options).trim();return COMMIT.test(sha)?sha:null;
  } catch {return null;}
}

export function che168InputRowsProof(rows) {
  const pairs=new Map();
  for(const row of rows) {
    if(row?.sourceId!==sourceId)continue;
    assert.ok(sourceRow(row) && !pairs.has(row.id) && pairs.size<500000,'che168_contribution_input_rows');
    pairs.set(row.id,rawDigest(row));
  }
  const sorted=[...pairs].sort(([a],[b])=>a<b?-1:a>b?1:0);
  return {rows:sorted.length,idsSha256:rawDigest(sorted.map(([id])=>id)),rowsSha256:rawDigest(sorted)};
}

/** Recheck actual deduplicated conversion. Discarding optional metadata never
 * drops a row, changes a date or advances a cursor. */
export function verifiedChe168InputReport(report,rows) {
  if(!report?.sourceInputWitness)return report;
  try {
    const witness=assertChe168ReplicaInputWitness(report.sourceInputWitness);
    assert.equal(rawDigest(che168InputRowsProof(rows)),rawDigest(witness.normalized),'che168_contribution_converted_rows');
    return report;
  } catch {
    const {sourceInputWitness,...rest}=report;
    return {...rest,sourceInputWitnessUnavailable:'che168_contribution_converted_rows'};
  }
}

function cleanChe168Intake(intake,freshOffers,sellerInventory) {
  const witness=assertChe168ReplicaInputWitness(intake?.sourceInputWitness);
  const source=intake.sources?.find(row=>row.sourceId===sourceId);
  assert.ok(sellerInventory && intake.market==='china' && intake.provider==='auto_api_che168'
    && intake.completed===true && !intake.failure && !intake.partial && !intake.technicalRepair
    && !['saved_snapshot_technical_repair','technical_repair'].includes(intake.mode)
    && !(intake.rawArchiveDependencies?.length) && intake.durableIntakeArchive
    && intake.sources.filter(row=>row.sourceId===sourceId).length===1
    && source?.provider==='auto_api_che168' && source.completeInventory===true
    && source.syncMode==='snapshot' && source.stopReason==='source_finished' && source.rejectedIdentity===0
    && !source.partial && !source.failure && source.observations===source.uniqueOffers
    && source.uniqueOffers===witness.normalized.rows && intake.completedAt===witness.snapshot.completedAt
    && source.replica?.key===witness.snapshot.root && source.replica.sha256===witness.snapshot.completeSha256
    && source.snapshotBinding===witness.replicaReadback.binding && source.cursor===witness.replicaReadback.cursor
    && source.replica.cursor===source.cursor && source.replica.binding===source.snapshotBinding,
  'che168_contribution_not_independent_snapshot');
  // One proof cannot certify another nonempty China source. Such input keeps
  // the normal retention union until that source has its own complete witness.
  assert.ok(Array.isArray(freshOffers) && freshOffers.length>0 && freshOffers.every(sourceRow),'che168_contribution_other_source');
  assert.equal(rawDigest(che168InputRowsProof(freshOffers)),rawDigest(witness.normalized),'che168_contribution_fresh_bytes');
  return witness;
}

const protocol=createSourceContributionProtocol({sourceId,market:'china',producerKind:CHE168_REPLICA_WITNESS_KIND,
  witnessField:'sourceInputWitness',snapshotKind:'che168-replica',snapshotReceiptLeaf:'manifest.json',
  sourceRow,assertWitness:assertChe168ReplicaInputWitness,validateInput:cleanChe168Intake,
  defaultReusableSourceIds:['autohome_used_china_open','autohome_new_china_open'],
  errorPrefix:'che168_contribution',allowIndependentRetained:true,freshOnlyMerge:primary=>mergeOfferVersions(primary,{})});
export const createChe168PublicationContributions=protocol.createPublicationContributions;
export const prepareChe168InternalContribution=protocol.prepareInternalContribution;
export const prepareChe168PublicContribution=protocol.preparePublicContribution;
export const verifyChe168PublicContribution=protocol.verifyPublicContribution;
export const verifyChe168InternalContribution=protocol.verifyInternalContribution;
