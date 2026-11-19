import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { RAW_GC_TARGET } from './lib/catalog-raw-gc.mjs';
import { createReadOnlyRawGcS3Transport } from './lib/catalog-raw-gc-s3.mjs';
import { rawDigest } from './lib/catalog-raw-provenance.mjs';
import { validateIntakeArchive } from './lib/nonjp-intake-archive-probe.mjs';

const MiB = 1024 ** 2;
const sha = b => createHash('sha256').update(b).digest('hex');
const sourceProvider = 'auto_api_che168';
const ageCheck = (value, now) => {
  const at = typeof value === 'string' ? Date.parse(value) : NaN;
  return { at: Number.isFinite(at) ? new Date(at).toISOString() : null,
    within48h: Number.isFinite(at) && at <= now && now - at <= 48 * 3600000 };
};
const identity = /^([1-9]\d{5,19}):([1-9]\d{0,5})$/;

export async function inspectChinaFreshInput({ io, candidates, now = Date.now } = {}) {
  const started = now(), deadline = started + 120000;
  assert.ok(io && rawDigest(io.target) === rawDigest(RAW_GC_TARGET), 'china_ro_target');
  assert.ok(typeof io.writeJson === 'undefined' && typeof io.deleteBatch === 'undefined', 'china_ro_readonly');
  assert.ok(Array.isArray(candidates) && candidates.length > 0 && candidates.length <= 6 &&
    new Set(candidates).size === candidates.length && candidates.every(x => typeof x === 'string' && identity.test(x)), 'china_ro_candidates');
  const read = async (key, maxBytes = 2 * MiB) => (await io.readJson({ target: RAW_GC_TARGET, key, maxBytes, deadline })).value;
  const [active, cursor, lock] = await Promise.all([
    read('catalog/manifest.json'),
    read('catalog/intake-cursors/v1/china.json'),
    read('catalog/import-lock.json', 256 * 1024),
  ]);
  const activeChina = active?.markets?.china;
  const source = cursor?.sources?.find(s => s?.provider === sourceProvider);
  const replica = source?.replica;
  let publishedReplicaMetadataMatch = false;
  if (typeof replica?.key === 'string' && /^catalog\/provider-replicas\/che168\/[a-f0-9-]{36}$/.test(replica.key)) {
    const actual = await read(replica.key + '/manifest.json');
    publishedReplicaMetadataMatch = Boolean(actual?.version === 1 && actual.cursor === source.cursor &&
      actual.binding === source.snapshotBinding && replica.binding === actual.binding && replica.cursor === actual.cursor &&
      rawDigest(actual) === replica.sha256 && Array.isArray(actual.parts) && actual.parts.length > 0);
  }
  const archives = [];
  for (const candidate of candidates) {
    const [,runId, attempt] = identity.exec(candidate);
    const root = `catalog/nonjp-intake/v1/china/${runId}/${attempt}`;
    try {
    const manifest = await read(root + '/complete.json');
    if (!manifest) { archives.push({runId, attempt, status:'missing_complete_manifest'}); continue; }
    // Matching a self-digest only confirms the archive shape, never authority.
    validateIntakeArchive(manifest,root,rawDigest(manifest));
    const file = manifest.files.find(f=>f.name === 'report.json');
    // The small report alone is enough to classify apparent freshness. Do not read inventory shards.
    if (file.bytes > 64 * MiB) { archives.push({runId, attempt, status:'report_too_large_for_probe'}); continue; }
    const parts = [];
    for (const part of file.parts) {
      const data = await read(part.key, 4 * MiB);
      assert.ok(data?.version === 1 && data.encoding === 'gzip-base64' && data.sha256 === part.sha256 &&
        data.bytes === part.bytes && typeof data.payload === 'string' && data.payload.length <= 3 * MiB, 'china_ro_report_part');
      const compressed = Buffer.from(data.payload,'base64');
      assert.equal(compressed.toString('base64'),data.payload,'china_ro_report_base64');
      const plain = gunzipSync(compressed,{maxOutputLength:part.bytes});
      assert.ok(plain.length === part.bytes && sha(plain) === part.sha256, 'china_ro_report_part_hash');
      parts.push(plain);
    }
    const reportBytes = Buffer.concat(parts);
    assert.ok(reportBytes.length === file.bytes && sha(reportBytes) === file.sha256, 'china_ro_report_hash');
    const report = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(reportBytes));
    assert.ok(report.market === 'china' && rawDigest(report) === manifest.reportDigest, 'china_ro_report_identity');
    const paid = report.sources?.find(r=>r?.provider===sourceProvider);
    const freshness = ageCheck(report.completedAt,started);
    const complete = manifest.collection.complete && report.completed === true && paid?.completeInventory === true &&
      paid.stopReason === 'source_finished' && Number.isSafeInteger(paid.uniqueOffers) && paid.uniqueOffers > 0;
    archives.push({runId,attempt,status:complete && freshness.within48h ? 'candidate_for_full_verification' : 'not_a_fresh_complete_candidate',
      apparentCollectionComplete:complete,freshness,offers:Number.isSafeInteger(paid?.uniqueOffers) ? paid.uniqueOffers : null});
    } catch (err) {
      const code = String(err?.message || '').split('\n')[0];
      archives.push({runId,attempt,status:'candidate_probe_failed',code:/^(china_ro_|raw_gc_s3_|intake_archive_)[a-z0-9_]+$/.test(code)?code:'china_ro_candidate_failed'});
    }
  }
  const {get, list, head, put, post, requests, responseBytes} = io.stats();
  assert.ok(now() < deadline && put === 0 && post === 0 && get === requests && list === 0 && head === 0, 'china_ro_scope');
  return { scope:'selected_china_producer_metadata_only', coverage:'not_a_complete_storage_inventory',
    publishAuthorized:false, identityAndHandoffVerified:false, storageWrites:0, supplierRequests:0, checkedAt:new Date(started).toISOString(),
    activeChina:{count:Number.isSafeInteger(activeChina?.count) ? activeChina.count : null,updatedAt:ageCheck(activeChina?.updatedAt,started).at},
    importLockPresent: Boolean(lock),
    publishedCursor:{updatedAt:ageCheck(cursor?.updatedAt,started).at,hasMatchingReplicaMetadata:publishedReplicaMetadataMatch},
    archives,transport:{get,responseBytes} };
}

if(process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const io = createReadOnlyRawGcS3Transport({limits:{requests:72,responseBytes:96 * MiB}});
    console.log(JSON.stringify(await inspectChinaFreshInput({io,candidates:process.argv.slice(2)})));
  } catch (error) {
    const label = String(error?.message||'').split('\n')[0];
    console.error(JSON.stringify({ok:false,code:/^(china_ro_|raw_gc_s3_|intake_archive_)[a-z0-9_]+$/.test(label)?label:'china_ro_failed'}));
    process.exitCode=1;
  }
}
