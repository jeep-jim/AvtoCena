import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {INTAKE_ARCHIVE_RECEIPT, assertLocalIntakeArchive, verifyIntakeArchive} from './nonjp-intake-archive.mjs';
import {assertDurableIntakeArchive, rawDigest, rawReferences} from './catalog-raw-provenance.mjs';

/** Recovery produces a new dataset. An archived input is never edited in
 * place or rebound to new bytes. Its old receipt remains a protected semantic
 * dependency of the corrected dataset, not the corrected dataset's receipt. */
export async function forkArchivedIntakeForRecovery({storage, directory, market, owner, beforeRead,
  temporaryRoot = process.env.RUNNER_TEMP || os.tmpdir()}) {
  let saved;
  try {saved = JSON.parse(await fs.readFile(path.join(directory, INTAKE_ARCHIVE_RECEIPT), 'utf8'));}
  catch (error) {if (error?.code === 'ENOENT') return {directory, archivedInput: null}; throw error;}
  const receipt = assertDurableIntakeArchive(saved, market);
  assert.equal(typeof beforeRead, 'function', 'intake_recovery_claim_required');
  await beforeRead(rawReferences([{kind: 'nonjp-intake', root: receipt.root, sha256: receipt.manifestSha256}, ...receipt.handoff.references]));
  await assertLocalIntakeArchive({storage, directory, receipt, readerOwner: owner});
  const parent = await fs.mkdtemp(path.join(temporaryRoot, 'catalog-recovery-input-'));
  const fork = path.join(parent, `catalog-intake-${market}`);
  await verifyIntakeArchive({storage, receipt, directory: fork, readerOwner: owner});
  // This is only the new local working copy. The original local receipt and
  // immutable own-storage archive are untouched.
  await fs.rm(path.join(fork, INTAKE_ARCHIVE_RECEIPT));
  return {directory: fork, archivedInput: receipt};
}

export function retainRecoveryArchive(report, receipt) {
  if (!receipt) return report;
  receipt = assertDurableIntakeArchive(receipt, report.market);
  const prior = report.rawArchiveDependencies || [];
  assert.ok(Array.isArray(prior) && prior.length < 64, 'intake_recovery_dependency_limit');
  const dependencies = new Map(prior.map(row => {const value = assertDurableIntakeArchive(row, report.market); return [value.root, value];}));
  const existing = dependencies.get(receipt.root);
  assert.ok(!existing || rawDigest(existing) === rawDigest(receipt), 'intake_recovery_dependency_changed');
  dependencies.set(receipt.root, receipt);
  const pins = new Map((report.rawStoragePins || []).map(row => [row.operationId, row]));
  const oldPin = pins.get(receipt.handoff.operationId);
  assert.ok(!oldPin || rawDigest(oldPin) === rawDigest(receipt.handoff), 'intake_recovery_pin_changed');
  pins.set(receipt.handoff.operationId, receipt.handoff);
  return {...report, rawArchiveDependencies: [...dependencies.values()], rawStoragePins: [...pins.values()]};
}
