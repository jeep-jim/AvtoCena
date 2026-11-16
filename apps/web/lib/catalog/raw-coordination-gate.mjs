import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {RAW_INTERNAL_MANIFEST_KEY, RAW_INTERNAL_COORDINATION_ID, rawInternalProvenanceKey,
  rawInternalPointerDescriptor} from './raw-internal-provenance.mjs';

export const RAW_COORDINATION_POLICY_KEY = 'catalog/raw-feed-coordination/v1/policy.json';
const STATE_KEY = 'catalog/raw-feed-coordination/v1/state.json';
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const TOKEN = /^[a-f0-9]{32,64}$/;

/** Read-only rollout gate. No caller may bootstrap or enable coordination by
 * setting an environment flag. A missing policy is disabled only while there
 * is no registry; a partially installed or removed policy fails closed. */
export async function readRawCoordinationPolicy(storage, {required = process.env.CATALOG_RAW_COORDINATION_REQUIRED === '1'} = {}) {
  if (storage.driver !== 'object') {
    assert.ok(!required, 'raw_coord_object_storage_required');
    return null;
  }
  const policy = await storage.readJson(RAW_COORDINATION_POLICY_KEY, null);
  const state = await storage.readJson(STATE_KEY, null);
  if (policy === null) {
    assert.ok(state === null && !required, 'raw_coord_policy_missing');
    return null;
  }
  assert.ok(policy.version === 1 && policy.mode === 'required' && policy.protocolVersion === 1
    && TOKEN.test(policy.registryId), 'raw_coord_policy_invalid');
  assert.ok(state?.version === 1 && state.scope === 'nonjp_raw_lifecycle_v1'
    && state.registryId === policy.registryId, 'raw_coord_registry_changed');
  return {version: 1, registryId: policy.registryId, policySha256: digest(policy)};
}

export async function assertRawCoordinationPolicy(storage, expected) {
  const actual = await readRawCoordinationPolicy(storage);
  assert.equal(digest(actual), digest(expected), 'raw_coord_policy_changed');
  return actual;
}

export function assertRawCoordinationTicket(value) {
  assert.ok(value && TOKEN.test(value.registryId) && /^[a-zA-Z0-9_-]{1,150}$/.test(value.operationId)
    && TOKEN.test(value.token) && /^\d{1,20}$/.test(value.owner?.runId)
    && /^[1-9]\d{0,5}$/.test(value.owner?.attempt) && /^[a-f0-9]{40}$/.test(value.owner?.sourceSha)
    && Number.isSafeInteger(value.grantRevision) && value.grantRevision > 0
    && Number.isSafeInteger(value.revision) && value.revision >= value.grantRevision, 'raw_coord_ticket_invalid');
  return {registryId: value.registryId, operationId: value.operationId, owner: {
    runId: value.owner.runId, attempt: value.owner.attempt, sourceSha: value.owner.sourceSha},
    token: value.token, grantRevision: value.grantRevision, revision: value.revision};
}

/** Mandatory in the shared runtime writer before aliases and every manifest
 * CAS. An arbitrary beforePreparedGeneration callback is not a reservation. */
export async function assertRawPublicationReservation({storage, policy, ticket, manifest, expectedBaseGenerationId}) {
  await assertRawCoordinationPolicy(storage, policy);
  if (!policy) return;
  const capability = assertRawCoordinationTicket(ticket);
  assert.equal(capability.registryId, policy.registryId, 'raw_coord_registry_changed');
  const state = await storage.readJson(STATE_KEY, null), pending = state?.catalog?.pending;
  assert.ok(state?.registryId === policy.registryId && pending, 'raw_coord_publication_reservation_missing');
  assert.equal(digest(assertRawCoordinationTicket({...pending, registryId: state.registryId})), digest(capability), 'raw_coord_ownership_changed');
  assert.ok(pending.base?.generationId === expectedBaseGenerationId
    && pending.candidate?.generationId === manifest.generationId
    && pending.candidate.manifestSha256 === digest(manifest), 'raw_coord_publication_binding_changed');
  const actual = await storage.readJson('catalog/manifest.json', null);
  assert.equal(digest(actual), pending.base.manifestSha256, 'raw_coord_publication_base_changed');
  const provenance = await storage.readJson(`catalog/generations/${manifest.generationId}/raw-provenance-v1.json`, null);
  assert.equal(digest(provenance), pending.candidate.provenanceSha256, 'raw_coord_publication_provenance_changed');
  assert.ok(Array.isArray(pending.candidate.references) && pending.candidate.references.every(ref =>
    state.roots.some(root => root.root === ref.root && root.kind === ref.kind && root.state === 'live')), 'raw_coord_publication_root_changed');
}

async function internalDescriptor(storage, manifest) {
  const proof = manifest === null ? null : await storage.readJson(rawInternalProvenanceKey(manifest.generationId), null);
  return rawInternalPointerDescriptor(manifest, proof);
}

/** The internal reserve is an input to the next refresh, so its CAS has its
 * own reservation before the later public-generation reservation exists. */
export async function assertRawInternalReservation({storage, policy, ticket, manifest, baseManifest}) {
  await assertRawCoordinationPolicy(storage, policy);
  if (!policy) return;
  const capability = assertRawCoordinationTicket(ticket);
  assert.equal(capability.registryId, policy.registryId, 'raw_coord_registry_changed');
  const state = await storage.readJson(STATE_KEY, null);
  const pointer = state?.pointers?.find(row => row.id === RAW_INTERNAL_COORDINATION_ID), pending = pointer?.pending;
  assert.ok(state?.registryId === policy.registryId && pending, 'raw_coord_internal_reservation_missing');
  assert.equal(digest(assertRawCoordinationTicket({...pending, registryId: state.registryId})), digest(capability), 'raw_coord_ownership_changed');
  const actual = await storage.readJson(RAW_INTERNAL_MANIFEST_KEY, null);
  assert.ok(digest(actual) === digest(baseManifest) && pending.base?.sha256 === digest(actual), 'raw_coord_internal_base_changed');
  const base = await internalDescriptor(storage, actual), candidate = await internalDescriptor(storage, manifest);
  assert.equal(digest(base), digest(pending.base), 'raw_coord_internal_base_provenance_changed');
  assert.equal(digest(candidate), digest(pending.candidate), 'raw_coord_internal_provenance_changed');
  assert.ok(candidate.provenanceSha256 !== null, 'raw_coord_internal_provenance_missing');
  assert.ok([...base.references, ...candidate.references].every(ref => state.roots?.some(root =>
    root.root === ref.root && root.kind === ref.kind && root.state === 'live')), 'raw_coord_internal_root_changed');
}

export async function assertRawInternalCompletion({storage, policy, ticket, manifest}) {
  await assertRawCoordinationPolicy(storage, policy);
  if (!policy) return;
  const capability = assertRawCoordinationTicket(ticket), state = await storage.readJson(STATE_KEY, null);
  assert.equal(capability.registryId, policy.registryId, 'raw_coord_registry_changed');
  const pointer = state?.pointers?.find(row => row.id === RAW_INTERNAL_COORDINATION_ID);
  const actual = await storage.readJson(RAW_INTERNAL_MANIFEST_KEY, null);
  assert.equal(digest(actual), digest(manifest), 'raw_coord_internal_readback_changed');
  const candidate = await internalDescriptor(storage, actual);
  assert.ok(pointer?.pending === null && digest(pointer.current) === digest(candidate), 'raw_coord_internal_commit_pending');
  const committed = pointer.lastCommit;
  assert.ok(committed && digest(assertRawCoordinationTicket({...committed, registryId: state.registryId}))
    === digest(capability), 'raw_coord_internal_commit_ownership_changed');
  const settled = await storage.readJson(`catalog/raw-feed-coordination/v1/pointer-receipts/${capability.token}.json`, null);
  assert.ok(settled?.version === 1 && settled.kind === 'pointer_write_settled' && settled.id === RAW_INTERNAL_COORDINATION_ID
    && settled.key === RAW_INTERNAL_MANIFEST_KEY && settled.valueSha256 === candidate.sha256
    && digest(settled.ticket) === digest(capability), 'raw_coord_internal_writer_not_settled');
}

/** Rare legacy writers stay explicitly blocked once the protocol is required. */
export async function assertLegacyRawWriterDisabled(storage) {
  assert.equal(await readRawCoordinationPolicy(storage), null, 'raw_coord_legacy_writer_blocked');
}
