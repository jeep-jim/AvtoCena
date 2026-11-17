import assert from 'node:assert/strict';
import {readRawCoordinationPolicy} from '../publisher-runtime83/raw-coordination-gate.mjs';
import {intakeRawReferences, rawProducerOwner, rawReferences} from './catalog-raw-provenance.mjs';
import {commitRawPointer, reconcileRawPublication} from './catalog-raw-session.mjs';
import {finishRawPublication} from './catalog-raw-publication.mjs';

export async function commitCoordinatedIntakeCursor({storage, intake, publication, checkpoint, owner}) {
  const key = `catalog/intake-cursors/v1/${intake.market}.json`;
  if (intake.market === 'japan') {
    // Japan has no raw archive and no participation in raw GC.
    await storage.writeJson(key, checkpoint);
    return {cursorCommitted: true, rawPinRelease: publication.rawPinRelease || null};
  }
  const policy = await readRawCoordinationPolicy(storage);
  if (!policy) {
    await storage.writeJson(key, checkpoint);
    return {cursorCommitted: true, rawPinRelease: publication.rawPinRelease || null};
  }
  assert.ok(publication.rawCoordination, 'raw_coord_publication_receipt_missing');
  const manifest = await storage.readJson('catalog/manifest.json', null);
  assert.equal(manifest?.generationId, checkpoint.generationId, 'raw_coord_cursor_generation_changed');
  await reconcileRawPublication({storage, binding: publication.rawCoordination, manifest});
  const evidence = intakeRawReferences(intake);
  const references = rawReferences([...evidence.references, ...(intake.rawStoragePins || []).flatMap(row => row.references)]);
  owner ||= rawProducerOwner();
  await commitRawPointer({storage, id: `intake_cursor:${intake.market}`, key, value: checkpoint,
    references, complete: evidence.complete, owner, operationId: `cursor-${intake.market}-${owner.runId}-${owner.attempt}`});
  try {
    const rawPinRelease = await finishRawPublication({storage, manifest, binding: publication.rawCoordination, cursorCommitted: true});
    return {cursorCommitted: true, rawPinRelease};
  } catch {
    // The durable session receipt and ready claims survive; never report the
    // pointer as uncommitted or roll back already-visible catalogue data.
    return {cursorCommitted: true, rawPinRelease: {status: 'cleanup_pending', pinsClosed: [],
      cleanupPending: (intake.rawStoragePins || []).map(row => row.operationId)}};
  }
}
