import assert from 'node:assert/strict';
import {isCompletedDubicarsDelta} from './auto-api-che168-client.mjs';
import {assertDurableIntakeArchive,rawDigest} from './catalog-raw-provenance.mjs';
import {publishedIntakeCheckpoint} from './catalog-intake-checkpoint.mjs';
import {readRawCoordinationPolicy} from '../../apps/web/lib/catalog/raw-coordination-gate.mjs';
import {RAW_COORDINATION_KEY} from './catalog-raw-coordination.mjs';

export const DUBICARS_CURSOR_KEY='catalog/intake-cursors/v1/uae.json';
const SOURCE='dubicars_uae_exact',PROVIDER='auto_api_dubicars',SHA=/^[a-f0-9]{64}$/;
const same=(left,right)=>rawDigest(left)===rawDigest(right);
const number=value=>Number.isSafeInteger(value)&&value>=0;
const time=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
const validEtag=value=>typeof value==='string'&&value.length>0&&value.length<=256&&!/[\x00-\x20\x7f]/.test(value);

// A full snapshot changes its baseline by a different protocol. Do not infer
// numeric ordering for that path or for any other market/opaque cursor.
export function isDubicarsDeltaIntake(intake) {
  return intake?.market==='uae'&&intake.provider===PROVIDER
    &&intake.sources?.some(row=>row?.sourceId===SOURCE&&row.provider===PROVIDER&&row.syncMode==='delta')===true;
}

function identity(intake) {
  assert.ok(isCompletedDubicarsDelta(intake),'dubicars_cursor_incomplete_delta');
  const rows=intake.sources.filter(row=>row?.sourceId===SOURCE&&row.provider===PROVIDER);
  assert.ok(rows.length===1&&time(rows[0].snapshotStartedAt),'dubicars_cursor_source');
  const source=rows[0],archive=assertDurableIntakeArchive(intake.durableIntakeArchive,'uae');
  assert.ok(source.yearFrom===undefined||number(source.yearFrom),'dubicars_cursor_source');
  return {version:1,market:'uae',sourceId:SOURCE,provider:PROVIDER,initialCursor:source.initialCursor,
    cursor:source.cursor,snapshotStartedAt:source.snapshotStartedAt,yearFrom:source.yearFrom??null,completedAt:intake.completedAt,
    archive:{root:archive.root,manifestSha256:archive.manifestSha256,reportDigest:archive.reportDigest,owner:archive.owner}};
}

function currentSource(meta) {
  const value=meta.value,rows=Array.isArray(value?.sources)?value.sources.filter(row=>row?.sourceId===SOURCE&&row.provider===PROVIDER):[];
  assert.ok(meta.found&&validEtag(meta.etag)&&value?.version===1&&value.market==='uae'&&rows.length===1
    &&number(rows[0].cursor)&&time(rows[0].snapshotStartedAt)
    &&['source_finished','source_changes_finished'].includes(rows[0].stopReason),'dubicars_cursor_base_missing_or_invalid');
  return rows[0];
}

function assertInitial(meta,input) {
  const source=currentSource(meta);
  assert.ok(source.snapshotStartedAt===input.snapshotStartedAt&&(source.yearFrom??null)===input.yearFrom,
    'dubicars_cursor_snapshot_changed');
  assert.ok(time(meta.value.updatedAt)&&Date.parse(meta.value.updatedAt)<=Date.parse(input.completedAt),
    'dubicars_cursor_newer_checkpoint_preserved');
  assert.ok(source.cursor<=input.cursor,'dubicars_cursor_newer_preserved');
  assert.equal(source.cursor,input.initialCursor,'dubicars_cursor_initial_changed');
}

async function assertLease(storage,operationId,now) {
  const lease=await storage.readJson('catalog/import-lock.json',null);
  assert.ok(lease?.operationId===operationId&&lease.operationType==='catalog_v3_publish_uae'
    &&Date.parse(lease.lockedUntil)>now(),'dubicars_cursor_publication_lease_required');
}

/** Captured after acquiring the ordinary publication lease, then checked again
 * immediately before manifest CAS. It does not advance a cursor or write REG. */
export function createDubicarsDeltaCursorGuard({storage,intake,operationId,now=Date.now}) {
  assert.ok(storage?.driver==='object'&&typeof storage.readJsonWithMeta==='function','dubicars_cursor_object_storage_required');
  assert.match(operationId||'',/^catalog_v3_publish_uae_[a-z0-9-]+$/,'dubicars_cursor_operation');
  const input=identity(intake);let base=null;
  return {
    assertIntake(other) {assert.ok(same(identity(other),input),'dubicars_cursor_mixed_intakes');},
    async capture() {
      await assertLease(storage,operationId,now);
      const meta=await storage.readJsonWithMeta(DUBICARS_CURSOR_KEY,null);assertInitial(meta,input);
      if(await readRawCoordinationPolicy(storage)) {
        const state=await storage.readJson(RAW_COORDINATION_KEY,null),pointer=state?.pointers?.find(row=>row.id==='intake_cursor:uae');
        assert.ok(pointer&&pointer.pending===null&&pointer.current?.sha256===rawDigest(meta.value),
          'dubicars_cursor_coordination_base_changed');
      }
      base={found:true,etag:meta.etag,sha256:rawDigest(meta.value)};
      return {...base};
    },
    async verify() {
      assert.ok(base,'dubicars_cursor_base_not_captured');await assertLease(storage,operationId,now);
      const meta=await storage.readJsonWithMeta(DUBICARS_CURSOR_KEY,null);assertInitial(meta,input);
      assert.ok(meta.etag===base.etag&&rawDigest(meta.value)===base.sha256,'dubicars_cursor_base_changed');
    },
    receipt(manifest) {
      assert.ok(base&&manifest?.version===2&&/^gen_\d+_[a-z0-9-]+$/.test(manifest.generationId)
        &&manifest.markets?.uae,'dubicars_cursor_publication_manifest');
      return {version:1,kind:'dubicars_delta_cursor_commit',input,base:{...base},operationId,
        generationId:manifest.generationId,manifestSha256:rawDigest(manifest),marketSha256:rawDigest(manifest.markets.uae)};
    },
  };
}

/** No historical report may authorize a new cursor write outside the original
 * publisher lease. An exact already-written checkpoint is a read-only replay;
 * equality of the number alone is deliberately insufficient. */
export async function prepareDubicarsDeltaCursorCommit({storage,intake,publication,checkpoint,now=Date.now}) {
  const input=identity(intake),receipt=publication?.dubicarsCursor;
  assert.ok(storage?.driver==='object'&&receipt?.version===1&&receipt.kind==='dubicars_delta_cursor_commit'
    &&same(receipt.input,input)&&receipt.generationId===publication.generationId
    &&SHA.test(receipt.manifestSha256)&&SHA.test(receipt.marketSha256)
    &&receipt.base?.found===true&&validEtag(receipt.base.etag)&&SHA.test(receipt.base.sha256)
    &&/^catalog_v3_publish_uae_[a-z0-9-]+$/.test(receipt.operationId||''),'dubicars_cursor_publication_receipt');
  assert.ok(same(checkpoint,publishedIntakeCheckpoint(intake,publication)),'dubicars_cursor_checkpoint_changed');
  const meta=await storage.readJsonWithMeta(DUBICARS_CURSOR_KEY,null);
  // Do not rewrite updatedAt, generation or provenance on a harmless repeat.
  if(meta.found&&rawDigest(meta.value)===rawDigest(checkpoint))return {idempotent:true};
  assertInitial(meta,input);
  assert.ok(meta.etag===receipt.base.etag&&rawDigest(meta.value)===receipt.base.sha256,'dubicars_cursor_base_changed');
  const beforeWrite=async()=>{
    await assertLease(storage,receipt.operationId,now);
    const manifest=await storage.readJson('catalog/manifest.json',null);
    assert.ok(manifest?.generationId===receipt.generationId&&rawDigest(manifest)===receipt.manifestSha256
      &&rawDigest(manifest.markets?.uae)===receipt.marketSha256,'dubicars_cursor_publication_changed');
  };
  await beforeWrite();
  return {idempotent:false,expectedBase:{...receipt.base},beforeWrite};
}
