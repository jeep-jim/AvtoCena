import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {rawDigest, RAW_PREFIXES, rawGenerationKey} from './catalog-raw-provenance.mjs';
import {RAW_COORDINATION_KEY, assertRawCoordination, coordinatedRawReferences, mutateRawCoordination,
  assertRawWritePermit, assertRawReadPermit, rawClaimForTicket, rawReadyClaimForRecovery, rawCatalogDescriptor, rawPointerDescriptor} from './catalog-raw-coordination.mjs';
import {readRawCoordinationPolicy, assertRawCoordinationPolicy, assertRawCoordinationTicket,
  assertRawPublicationReservation} from '../../apps/web/lib/catalog/raw-coordination-gate.mjs';

const nonce = () => randomBytes(24).toString('hex');
const ownerIdentity = owner => ({runId: owner.runId, attempt: owner.attempt, sourceSha: owner.sourceSha || owner.revision});
const isRawKey = key => typeof key === 'string' && Object.values(RAW_PREFIXES).some(prefix => key.startsWith(prefix));
const frozenCopy = value => structuredClone(value);
const publicationDrainedKey = manifest => {
  rawGenerationKey(manifest.generationId);
  return `catalog/raw-feed-coordination/v1/publications/${manifest.generationId}/settled.json`;
};
const pointerDrainedKey = ticket => `catalog/raw-feed-coordination/v1/pointer-receipts/${ticket.token}.json`;

async function immutableControlReceipt(storage, key, value) {
  try {await storage.writeJson(key, value, {ifNoneMatch: '*'});}
  catch (error) {if (error?.name !== 'StorageConflictError') throw error;}
  assert.equal(rawDigest(await storage.readJson(key, null)), rawDigest(value), 'raw_coord_settled_receipt_changed');
}

export function assertRawSessionBinding(binding) {
  assert.ok(binding?.version === 1 && binding.policy?.version === 1
    && /^[a-f0-9]{64}$/.test(binding.policy.policySha256), 'raw_coord_session_binding');
  const ticket = assertRawCoordinationTicket(binding.ticket);
  assert.equal(ticket.registryId, binding.policy.registryId, 'raw_coord_session_registry');
  return {version: 1, policy: {...binding.policy}, ticket};
}

async function readState(storage, policy) {
  await assertRawCoordinationPolicy(storage, policy);
  const state = assertRawCoordination(await storage.readJson(RAW_COORDINATION_KEY, null));
  assert.equal(state.registryId, policy.registryId, 'raw_coord_registry_changed');
  return state;
}

/** The claim is durable; the queue is process-local. A writing claim is never
 * automatically resumed by another process, even with the same Actions owner.
 * A ready claim can be recovered only for read-only handoff completion. */
export async function openRawProducerSession({storage, operationId, owner, references, binding = null, existingPin = false, readOnly = false}) {
  const policy = await readRawCoordinationPolicy(storage);
  if (!policy) {
    assert.equal(binding, null, 'raw_coord_required_session_disabled');
    return {required: false, storage, binding: () => null, extend: async () => {}, seal: async () => null};
  }
  assert.ok(!existingPin || binding, 'raw_coord_legacy_pin_requires_bootstrap');
  let capability, ready = false;
  const refs = coordinatedRawReferences(references);
  if (binding) {
    const saved = assertRawSessionBinding(binding);
    assert.equal(rawDigest(saved.policy), rawDigest(policy), 'raw_coord_policy_changed');
    assert.equal(saved.ticket.operationId, operationId, 'raw_coord_operation_changed');
    assert.equal(rawDigest(saved.ticket.owner), rawDigest(ownerIdentity(owner)), 'raw_coord_owner_changed');
    capability = rawReadyClaimForRecovery(await readState(storage, policy), saved.ticket, refs);
    ready = true;
  } else {
    capability = (await mutateRawCoordination({storage, command: {type: 'claim', operationId,
      owner: ownerIdentity(owner), token: nonce(), references: refs}})).result;
  }
  let accepting = !ready, control = Promise.resolve(), sealPromise = null;
  const pending = new Set();
  let ioFailure = null;
  const currentBinding = () => ({version: 1, policy: {...policy}, ticket: frozenCopy(capability)});
  const enqueueControl = action => {
    const result = control.then(action);
    control = result;
    return result;
  };
  // Register the promise before its first await. An unawaited caller therefore
  // cannot make seal() overlook a PUT that is already scheduled locally.
  function io(method, args, write) {
    assert.ok(accepting, 'raw_coord_session_closed');
    assert.ok(!write || !readOnly, 'raw_coord_read_session_write_forbidden');
    const permission = enqueueControl(async () => {
      const state = await readState(storage, policy);
      (write ? assertRawWritePermit : assertRawReadPermit)(state, capability, args[0]);
    });
    const operation = permission.then(() => storage[method](...args));
    pending.add(operation);
    operation.then(() => pending.delete(operation), error => {
      pending.delete(operation);
      // A failed condition guarantees no object mutation. The immutable
      // writer still has to compare its existing receipt before proceeding.
      if (error?.name !== 'StorageConflictError') ioFailure ||= error;
    });
    return operation;
  }
  const scoped = new Proxy(storage, {get(target, property) {
    if (['deleteObject', 'deleteObjects', 'deleteJson', 'deleteBinary', 'deletePrefix'].includes(property)) return () => {throw Error('raw_coord_session_delete_forbidden');};
    const value = target[property];
    if (typeof value !== 'function') return value;
    if (property === 'writeJson' || property === 'putBinary') return (...args) => io(property, args, true);
    if (['readJson', 'readJsonWithMeta', 'getBinary', 'exists', 'binaryExists', 'readObjectMetadata'].includes(property)) return (...args) =>
      isRawKey(args[0]) ? io(property, args, false) : value.apply(target, args);
    if (property === 'createBinaryDownloadUrl') return (...args) => {
      assert.ok(!isRawKey(args[0]), 'raw_coord_detached_download_forbidden');
      return value.apply(target, args);
    };
    return value.bind(target);
  }});
  return {
    required: true, storage: scoped, binding: currentBinding,
    extend(references) {
      assert.ok(accepting, 'raw_coord_session_closed');
      const added = coordinatedRawReferences(references);
      return enqueueControl(async () => {
        await readState(storage, policy);
        capability = (await mutateRawCoordination({storage, command: {type: 'extend', ticket: capability, references: added}})).result;
        return currentBinding();
      });
    },
    seal() {
      if (ready) return Promise.resolve(currentBinding());
      if (sealPromise) return sealPromise;
      accepting = false; // No new PUT can enter after this synchronous boundary.
      sealPromise = (async () => {
        let controlFailure = null;
        try {await control;} catch (error) {controlFailure = error;}
        await Promise.allSettled([...pending]);
        if (controlFailure || ioFailure && !readOnly) throw Error('raw_coord_session_io_failed', {cause: controlFailure || ioFailure});
        await readState(storage, policy);
        capability = (await mutateRawCoordination({storage, command: {type: 'seal', ticket: capability, allWritesDrained: true}})).result;
        ready = true;
        return currentBinding();
      })();
      return sealPromise;
    },
  };
}

export async function releaseRawReadSession({storage, binding, terminalPin}) {
  const saved = assertRawSessionBinding(binding), state = await readState(storage, saved.policy);
  rawClaimForTicket(state, saved.ticket);
  assert.ok(terminalPin?.state === 'abandoned' && terminalPin.reason === 'read_complete'
    && terminalPin.mode === 'read_only' && rawDigest(terminalPin.coordination) === rawDigest(saved), 'raw_coord_read_terminal_receipt');
  await mutateRawCoordination({storage, command: {type: 'release', ticket: saved.ticket, outcome: 'abandoned',
    terminalPinSha256: rawDigest(terminalPin), terminalWriterProofSha256: rawDigest({protocol: 1,
      ticket: saved.ticket, terminalPinSha256: rawDigest(terminalPin), writes: 0, allRequestsDrained: true})}});
}

/** A standalone restore/verification holds its own read claim, including when
 * the original producer pin was published long ago. A returned signed URL or
 * unfinished stream is not supported: all object reads must settle here. */
export async function withRawReadProtection({storage, references, read, owner}) {
  if (!await readRawCoordinationPolicy(storage)) return read(storage);
  const {openRawFeedPin, rawProducerOwner} = await import('./catalog-raw-provenance.mjs');
  const actualOwner = owner || rawProducerOwner();
  const pin = await openRawFeedPin({storage, owner: actualOwner, references, readOnly: true,
    operationId: `raw-read-${actualOwner.runId}-${actualOwner.attempt}-${nonce().slice(0, 12)}`});
  try {return await read(pin.storage);}
  finally {await pin.finishRead();}
}

/** The caller has already closed and read back its own pin. A CAS failure leaves
 * the ready registry claim protecting every root for explicit reconciliation. */
export async function verifyRawProducerRelease({storage, binding, manifest, pin}) {
  if (!binding) {
    assert.equal(await readRawCoordinationPolicy(storage), null, 'raw_coord_handoff_not_coordinated');
    return;
  }
  const saved = assertRawSessionBinding(binding), state = await readState(storage, saved.policy);
  assert.equal(rawDigest(pin.coordination), rawDigest(saved), 'raw_coord_terminal_pin_changed');
  const claim = state.claims.find(row => row.token === saved.ticket.token);
  if (claim) assert.equal(rawClaimForTicket(state, saved.ticket).phase, 'ready', 'raw_coord_claim_not_ready');
  else assert.equal(pin.state, 'published', 'raw_coord_ready_claim_missing');
  assert.ok([state.catalog.current, state.catalog.previous].some(row => row.generationId === manifest.generationId
    && row.manifestSha256 === rawDigest(manifest)), 'raw_coord_published_generation_missing');
}

export async function releaseRawProducerSession({storage, binding, terminalPin, generationId}) {
  if (!binding) {
    assert.equal(await readRawCoordinationPolicy(storage), null, 'raw_coord_handoff_not_coordinated');
    return;
  }
  const saved = assertRawSessionBinding(binding), state = await readState(storage, saved.policy);
  assert.ok(terminalPin?.state === 'published' && terminalPin.operationId === saved.ticket.operationId
    && rawDigest(terminalPin.coordination) === rawDigest(saved), 'raw_coord_terminal_pin_changed');
  assert.equal(rawDigest(await storage.readJson(`catalog/raw-feed-pins/v1/${saved.ticket.operationId}.json`, null)),
    rawDigest(terminalPin), 'raw_coord_terminal_pin_changed');
  const claim = state.claims.find(row => row.token === saved.ticket.token);
  if (!claim) {
    // Idempotent only after this exact terminal pin; no new claim is adopted.
    assert.ok(terminalPin?.state === 'published'
      && rawDigest(terminalPin.coordination) === rawDigest(saved), 'raw_coord_release_receipt_changed');
    return;
  }
  rawClaimForTicket(state, saved.ticket);
  await mutateRawCoordination({storage, command: {type: 'release', ticket: saved.ticket, outcome: 'published',
    terminalPinSha256: rawDigest(terminalPin), generationId}});
}

export async function reserveRawPublication({storage, manifest, baseline, previous, owner, operationId}) {
  const policy = await readRawCoordinationPolicy(storage);
  if (!policy) return null;
  if (!owner) owner = (await import('./catalog-raw-provenance.mjs')).rawProducerOwner();
  const state = await readState(storage, policy);
  const provenance = await storage.readJson(rawGenerationKey(manifest.generationId), null);
  const candidate = rawCatalogDescriptor(manifest, provenance);
  assert.equal(state.catalog.current.manifestSha256, rawDigest(baseline), 'raw_coord_publication_base_changed');
  assert.equal(state.catalog.previous.manifestSha256, rawDigest(previous), 'raw_coord_publication_previous_changed');
  const result = await mutateRawCoordination({storage, command: {type: 'reserve_publication', operationId,
    owner: ownerIdentity(owner), token: nonce(), catalogRevision: state.catalog.revision,
    base: state.catalog.current, previous: state.catalog.previous, candidate}});
  return {version: 1, policy, ticket: result.result};
}

export async function verifyRawPublicationSession({storage, binding, manifest, expectedBaseGenerationId}) {
  const saved = binding ? assertRawSessionBinding(binding) : null;
  await assertRawPublicationReservation({storage, policy: saved?.policy || null, ticket: saved?.ticket,
    manifest, expectedBaseGenerationId});
}

/** Called only after the runtime's awaited manifest PUT has returned. Merely
 * observing matching object bytes from a second process does not prove that
 * the first process has drained its writes. A missing receipt is left pending
 * until a separate terminal-writer recovery can establish that fact. */
export async function recordRawPublicationWritesSettled({storage, binding, manifest}) {
  if (!binding) return;
  const saved = assertRawSessionBinding(binding), state = await readState(storage, saved.policy);
  const pending = state.catalog.pending;
  assert.ok(pending && rawDigest(assertRawCoordinationTicket({...pending, registryId: state.registryId}))
    === rawDigest(saved.ticket), 'raw_coord_ownership_changed');
  const actual = await storage.readJson('catalog/manifest.json', null);
  const previous = await storage.readJson('catalog/previous-manifest.json', null);
  assert.ok(rawDigest(actual) === rawDigest(manifest) && pending.candidate.manifestSha256 === rawDigest(actual)
    && pending.base.manifestSha256 === rawDigest(previous), 'raw_coord_publication_readback_changed');
  await immutableControlReceipt(storage, publicationDrainedKey(manifest), {version: 1, kind: 'publication_writes_settled',
    binding: saved, manifestSha256: rawDigest(actual), previousManifestSha256: rawDigest(previous)});
}

export async function reconcileRawPublication({storage, binding, manifest}) {
  if (!binding) {
    assert.equal(await readRawCoordinationPolicy(storage), null, 'raw_coord_publication_not_coordinated');
    return {status: 'disabled'};
  }
  const saved = assertRawSessionBinding(binding), state = await readState(storage, saved.policy);
  const actual = await storage.readJson('catalog/manifest.json', null);
  assert.equal(rawDigest(actual), rawDigest(manifest), 'raw_coord_publication_readback_changed');
  const previous = await storage.readJson('catalog/previous-manifest.json', null);
  const settled = await storage.readJson(publicationDrainedKey(manifest), null);
  assert.ok(settled?.version === 1 && settled.kind === 'publication_writes_settled'
    && rawDigest(settled.binding) === rawDigest(saved) && settled.manifestSha256 === rawDigest(actual)
    && settled.previousManifestSha256 === rawDigest(previous), 'raw_coord_publication_writer_not_settled');
  if (!state.catalog.pending) {
    const last = state.catalog.lastCommit;
    assert.ok(state.catalog.current.manifestSha256 === rawDigest(actual) && last
      && last.operationId === saved.ticket.operationId && last.token === saved.ticket.token
      && last.grantRevision === saved.ticket.grantRevision, 'raw_coord_publication_reconciliation_changed');
    return {status: 'committed'};
  }
  await mutateRawCoordination({storage, command: {type: 'commit_publication', ticket: saved.ticket,
    observedManifest: actual, observedPreviousManifest: previous}});
  return {status: 'committed'};
}

/** Reserve both old and new cursor/config references, then CAS the actual
 * pointer. A crash after PUT leaves pending protection and is recoverable only
 * from the exact candidate bytes, owner and original reservation token. */
export async function commitRawPointer({storage, id, key, value, references, complete, owner, operationId}) {
  const policy = await readRawCoordinationPolicy(storage);
  const meta = await storage.readJsonWithMeta(key, null);
  if (!policy) { await storage.writeJson(key, value); return {status: 'disabled'}; }
  const state = await readState(storage, policy), pointer = state.pointers.find(row => row.id === id);
  assert.ok(pointer, 'raw_coord_pointer_scope');
  const candidate = rawPointerDescriptor(value, references, {complete});
  let capability;
  if (pointer.pending) {
    const pending = pointer.pending;
    assert.ok(pending.operationId === operationId && rawDigest(pending.owner) === rawDigest(ownerIdentity(owner))
      && rawDigest(pending.candidate) === rawDigest(candidate), 'raw_coord_pointer_recovery_changed');
    // Reusing the grant is safe only after the exact pointer was already PUT.
    // A crash before PUT is not proof that the former process has stopped.
    assert.equal(rawDigest(meta.value), candidate.sha256, 'raw_coord_pointer_writer_not_terminal');
    capability = assertRawCoordinationTicket({...pending, registryId: state.registryId});
    const settled = await storage.readJson(pointerDrainedKey(capability), null);
    assert.ok(settled?.version === 1 && settled.kind === 'pointer_write_settled' && settled.id === id
      && settled.key === key && settled.valueSha256 === candidate.sha256
      && rawDigest(settled.ticket) === rawDigest(capability), 'raw_coord_pointer_writer_not_settled');
  } else if (pointer.current.sha256 === candidate.sha256 && rawDigest(pointer.current) === rawDigest(candidate)) {
    assert.equal(rawDigest(meta.value), candidate.sha256, 'raw_coord_pointer_readback_changed');
    return {status: 'committed'};
  } else {
    assert.equal(rawDigest(meta.value), pointer.current.sha256, 'raw_coord_pointer_base_changed');
    capability = (await mutateRawCoordination({storage, command: {type: 'reserve_pointer', id, operationId,
      owner: ownerIdentity(owner), token: nonce(), pointerRevision: pointer.revision,
      base: pointer.current, candidate}})).result;
    const beforePut = await readState(storage, policy), pending = beforePut.pointers.find(row => row.id === id)?.pending;
    assert.ok(pending && rawDigest(assertRawCoordinationTicket({...pending, registryId: beforePut.registryId}))
      === rawDigest(capability), 'raw_coord_ownership_changed');
    await storage.writeJson(key, value, meta.found && meta.etag ? {ifMatch: meta.etag} : {ifNoneMatch: '*'});
    const observed = await storage.readJson(key, null);
    assert.equal(rawDigest(observed), candidate.sha256, 'raw_coord_pointer_readback_changed');
    await immutableControlReceipt(storage, pointerDrainedKey(capability), {version: 1, kind: 'pointer_write_settled',
      id, key, ticket: capability, valueSha256: rawDigest(observed)});
  }
  const actual = await storage.readJson(key, null);
  await mutateRawCoordination({storage, command: {type: 'commit_pointer', id, ticket: capability, observedValue: actual}});
  return {status: 'committed'};
}
