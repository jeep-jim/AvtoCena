import assert from 'node:assert/strict';
import {rawDigest, rawGenerationKey, intakeRawReferences, assertRawGenerationProvenance,
  RAW_TRACKED_MARKETS, rawReferences, collectPaidReportReferences, stageRawGenerationProvenance,
  assertRawHandoff, releaseRawHandoff} from './catalog-raw-provenance.mjs';
import {readIntakeArchiveManifest} from './nonjp-intake-archive.mjs';
import {reserveRawPublication, verifyRawPublicationSession, reconcileRawPublication, recordRawPublicationWritesSettled} from './catalog-raw-session.mjs';

export const rawPublicationSessionKey = generationId => {
  rawGenerationKey(generationId);
  return `catalog/raw-feed-coordination/v1/publications/${generationId}/session.json`;
};

async function immutableSession(storage, value) {
  const key = rawPublicationSessionKey(value.manifest.generationId);
  try {await storage.writeJson(key, value, {ifNoneMatch: '*'});}
  catch (error) {if (error?.name !== 'StorageConflictError') throw error;}
  assert.equal(rawDigest(await storage.readJson(key, null)), rawDigest(value), 'raw_publication_session_changed');
  return key;
}

async function persistCleanupStatus(storage, manifest, status) {
  const key = rawPublicationSessionKey(manifest.generationId).replace('/session.json', '/cleanup.json');
  const meta = await storage.readJsonWithMeta(key, null);
  const value = {version: 1, generationId: manifest.generationId, manifestSha256: rawDigest(manifest), ...status};
  await storage.writeJson(key, value, meta.found && meta.etag ? {ifMatch: meta.etag} : {ifNoneMatch: '*'});
  assert.equal(rawDigest(await storage.readJson(key, null)), rawDigest(value), 'raw_cleanup_status_readback');
}

async function releasePins({storage, handoffs, manifest, clock}) {
  const pending = [], closed = [];
  for (const handoff of handoffs) {
    try {await releaseRawHandoff({storage, handoff, manifest, clock}); closed.push(handoff.operationId);}
    catch {pending.push(handoff.operationId);}
  }
  return {pinsClosed: closed, cleanupPending: pending, status: pending.length ? 'cleanup_pending' : 'pins_released'};
}

/** Publication and cursor recovery use this immutable receipt, never a new
 * handoff assembled from a later input or a reused friendly operation name. */
export async function finishRawPublication({storage, manifest, binding, cursorCommitted = false, clock = Date.now}) {
  const receipt = await storage.readJson(rawPublicationSessionKey(manifest.generationId), null);
  assert.ok(receipt?.version === 1 && rawDigest(receipt.manifest) === rawDigest(manifest)
    && rawDigest(receipt.binding) === rawDigest(binding), 'raw_publication_session_changed');
  receipt.handoffs.forEach(assertRawHandoff);
  await reconcileRawPublication({storage, binding, manifest});
  if (receipt.releaseAfterCursor) {
    assert.equal(cursorCommitted, true, 'raw_publication_waiting_for_cursor');
    const cursor = await storage.readJson(`catalog/intake-cursors/v1/${receipt.market}.json`, null);
    assert.equal(cursor?.generationId, manifest.generationId, 'raw_publication_cursor_changed');
    const {RAW_COORDINATION_KEY} = await import('./catalog-raw-coordination.mjs');
    const state = await storage.readJson(RAW_COORDINATION_KEY, null);
    const pointer = state?.pointers?.find(row => row.id === `intake_cursor:${receipt.market}`);
    assert.ok(pointer?.pending === null && pointer.current.sha256 === rawDigest(cursor), 'raw_publication_cursor_not_coordinated');
  }
  const status = await releasePins({storage, handoffs: receipt.handoffs, manifest, clock});
  await persistCleanupStatus(storage, manifest, status);
  return status;
}

function retainSourceDependencies(previous, next) {
  if (!previous) return next;
  if (!next) return previous;
  return {complete: previous.complete === true && next.complete === true,
    producers: [...new Map([...previous.producers, ...next.producers].map(row => [rawDigest(row), row])).values()],
    references: rawReferences([...previous.references, ...next.references]),
    unknownSources: [...new Set([...previous.unknownSources, ...next.unknownSources])]};
}

/** Called by the existing publisher while its import lease is held, before aliases. */
export async function prepareRawPublication({storage, manifest, expectedBaseGenerationId, market, intake, clock = Date.now, owner, operationId}) {
  const baseline = await storage.readJson('catalog/manifest.json', null);
  assert.equal(baseline?.generationId || 'empty', expectedBaseGenerationId, 'raw_publication_base_changed');
  const prior = expectedBaseGenerationId === 'empty' ? null : await storage.readJson(rawGenerationKey(expectedBaseGenerationId), null);
  const marketSources = {};
  if (prior !== null) {
    assertRawGenerationProvenance(prior, baseline, {requireComplete: false});
    for (const name of RAW_TRACKED_MARKETS) marketSources[name] = prior.markets[name];
  }
  // The normal publisher merges fresh and retained fields/rows. A new archive
  // alone cannot erase the origin of borrowed data or make historic unknowns
  // complete. A future proven replacement/compaction may retire dependencies.
  if (baseline?.markets?.[market]?.count > 0 && !marketSources[market]) marketSources[market] = {
    complete: false, producers: [], references: [], unknownSources: ['historic_provenance_missing'],
  };
  if (RAW_TRACKED_MARKETS.includes(market) && intake) {
    assert.equal(intake.market, market, 'raw_publication_intake_market');
    if (intake.durableIntakeArchive) await readIntakeArchiveManifest({storage, receipt: intake.durableIntakeArchive});
    if (intake.completed === true || intake.durableIntakeArchive) marketSources[market] = retainSourceDependencies(
      baseline?.markets?.[market]?.count > 0 ? marketSources[market] : null, intakeRawReferences(intake));
  }
  const handoffs = intake?.rawStoragePins || [];
  assert.ok(Array.isArray(handoffs) && handoffs.length <= 64, 'raw_publication_pin_limit');
  handoffs.forEach(assertRawHandoff);
  if (marketSources[market]) marketSources[market].references.push(...handoffs.flatMap(row => row.references));
  const paidReports = await collectPaidReportReferences({storage, manifest});
  const verifyProvenance = await stageRawGenerationProvenance({storage, manifest, marketSources, paidReports});
  const previous = await storage.readJson('catalog/previous-manifest.json', null);
  const binding = await reserveRawPublication({storage, manifest, baseline, previous, owner, operationId});
  const receipt = binding ? {version: 1, market, manifest, binding, handoffs,
    releaseAfterCursor: intake?.mode !== 'saved_snapshot_technical_repair'} : null;
  if (receipt) await immutableSession(storage, receipt);
  return {
    binding,
    async afterCommit() {
      try {await recordRawPublicationWritesSettled({storage, binding, manifest});}
      catch {
        const status = {pinsClosed: [], cleanupPending: handoffs.map(row => row.operationId), status: 'cleanup_pending'};
        try {await persistCleanupStatus(storage, manifest, status);} catch {status.statusPersistencePending = true;}
        return status;
      }
      return this.releasePins();
    },
    async verify() {
      assert.equal(rawDigest(await storage.readJson('catalog/manifest.json', null)), rawDigest(baseline), 'raw_publication_base_changed');
      await verifyProvenance();
      if (intake?.durableIntakeArchive) await readIntakeArchiveManifest({storage, receipt: intake.durableIntakeArchive});
      await verifyRawPublicationSession({storage, binding, manifest, expectedBaseGenerationId});
      if (receipt) assert.equal(rawDigest(await storage.readJson(rawPublicationSessionKey(manifest.generationId), null)), rawDigest(receipt), 'raw_publication_session_changed');
    },
    async releasePins() {
      if (!binding) return releasePins({storage, handoffs, manifest, clock});
      try {
        await reconcileRawPublication({storage, binding, manifest});
        if (receipt.releaseAfterCursor) {
          const status = {pinsClosed: [], cleanupPending: handoffs.map(row => row.operationId), status: 'awaiting_cursor'};
          await persistCleanupStatus(storage, manifest, status);
          return status;
        }
        return await finishRawPublication({storage, binding, manifest, clock});
      } catch {
        const status = {pinsClosed: [], cleanupPending: handoffs.map(row => row.operationId), status: 'cleanup_pending'};
        try {await persistCleanupStatus(storage, manifest, status);} catch {status.statusPersistencePending = true;}
        return status;
      }
    },
  };
}
