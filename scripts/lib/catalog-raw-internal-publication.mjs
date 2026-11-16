import {verifyIndependentInternalContribution} from './catalog-source-contribution-authority.mjs';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {RAW_INTERNAL_MANIFEST_KEY, RAW_INTERNAL_COORDINATION_ID, rawInternalProvenanceKey,
  buildRawInternalProvenance, rawInternalPointerDescriptor} from '../../apps/web/lib/catalog/raw-internal-provenance.mjs';
import {readSourceContributionDescriptor, sourceContributionReference,
  verifySourceContribution} from '../../apps/web/lib/catalog/source-contribution-reader.mjs';
import {readRawCoordinationPolicy, assertRawCoordinationPolicy, assertRawCoordinationTicket,
  assertRawInternalReservation, assertRawInternalCompletion} from '../../apps/web/lib/catalog/raw-coordination-gate.mjs';
import {RAW_COORDINATION_KEY, assertRawCoordination, mutateRawCoordination} from './catalog-raw-coordination.mjs';
import {rawDigest, rawReferences, intakeRawReferences, assertRawHandoff, rawProducerOwner} from './catalog-raw-provenance.mjs';

const same = (a, b) => rawDigest(a) === rawDigest(b);
const receiptKey = ticket => `catalog/raw-feed-coordination/v1/pointer-receipts/${ticket.token}.json`;
const sessionKey = manifest => rawInternalProvenanceKey(manifest.generationId).replace('/provenance.json', '/session.json');
async function immutable(storage, key, value) {
  try {await storage.writeJson(key, value, {ifNoneMatch: '*'});}
  catch (error) {if (error?.name !== 'StorageConflictError') throw error;}
  assert.ok(same(await storage.readJson(key, null), value), 'raw_internal_immutable_changed');
}
async function priorProof(storage, manifest) {
  return manifest === null ? null : storage.readJson(rawInternalProvenanceKey(manifest.generationId), null);
}
async function readState(storage, policy) {
  await assertRawCoordinationPolicy(storage, policy);
  const state = assertRawCoordination(await storage.readJson(RAW_COORDINATION_KEY, null));
  assert.equal(state.registryId, policy.registryId, 'raw_coord_registry_changed');
  return state;
}
function capability(state, pending) {
  assert.ok(pending, 'raw_coord_internal_reservation_missing');
  return assertRawCoordinationTicket({...pending, registryId: state.registryId});
}

/** Recovery may complete only an already-drained exact writer. Reading the
 * candidate bytes after a PUT timeout never manufactures this receipt. */
export async function reconcileRawInternalPublication({storage, binding, manifest}) {
  if (!binding) {
    assert.equal(await readRawCoordinationPolicy(storage), null, 'raw_coord_internal_not_coordinated');
    return {status: 'disabled'};
  }
  const {policy, ticket} = binding, state = await readState(storage, policy);
  const actual = await storage.readJson(RAW_INTERNAL_MANIFEST_KEY, null);
  assert.ok(same(actual, manifest), 'raw_coord_internal_readback_changed');
  const proof = await priorProof(storage, manifest), candidate = rawInternalPointerDescriptor(manifest, proof);
  const receipt = await storage.readJson(receiptKey(ticket), null);
  assert.ok(receipt?.version === 1 && receipt.kind === 'pointer_write_settled'
    && receipt.id === RAW_INTERNAL_COORDINATION_ID && receipt.key === RAW_INTERNAL_MANIFEST_KEY
    && same(receipt.ticket, ticket) && receipt.valueSha256 === candidate.sha256, 'raw_coord_internal_writer_not_settled');
  const saved = await storage.readJson(sessionKey(manifest), null);
  assert.ok(saved?.version === 1 && same(saved.binding, binding) && same(saved.candidate, candidate), 'raw_coord_internal_session_changed');
  const pointer = state.pointers.find(row => row.id === RAW_INTERNAL_COORDINATION_ID);
  if (pointer.pending) {
    assert.ok(same(capability(state, pointer.pending), ticket) && same(pointer.pending.candidate, candidate), 'raw_coord_ownership_changed');
    await mutateRawCoordination({storage, command: {type: 'commit_pointer', id: RAW_INTERNAL_COORDINATION_ID,
      ticket, observedValue: actual}});
  }
  await assertRawInternalCompletion({storage, policy, ticket, manifest});
  return {status: 'committed'};
}

/** Called after immutable internal chunks have completed, before their actual
 * manifest CAS. Unknown retained row lineage stays unknown; known dependency
 * roots are conservatively retained from the old internal reserve and intake. */
export async function prepareRawInternalPublication({storage, manifest, baseManifest, intake, operationId, owner, contributionReferences = [], contributionCapabilities = []}) {
  assert.ok(Array.isArray(contributionReferences) && contributionReferences.length===0,'source_contribution_internal_authority');
  assert.ok(Array.isArray(contributionCapabilities) && contributionCapabilities.length<=100,'raw_internal_contribution_limit');
  const ownedCapabilities=[...contributionCapabilities];
  const policy = await readRawCoordinationPolicy(storage);
  const baseProof = await priorProof(storage, baseManifest);
  const base = rawInternalPointerDescriptor(baseManifest, baseProof);
  const handoffs = intake?.rawStoragePins || [];
  assert.ok(Array.isArray(handoffs) && handoffs.length <= 64, 'raw_internal_pin_limit');
  handoffs.forEach(assertRawHandoff);
  const intakeRefs = intake && (intake.completed === true || intake.durableIntakeArchive) ? intakeRawReferences(intake).references : [];
  const count = Object.values(manifest.sources).reduce((sum, source) => sum + Number(source.count), 0);
  const references = count === 0 ? [] : rawReferences([...base.references, ...intakeRefs, ...handoffs.flatMap(row => row.references)]);
  const verifiedCapabilities=[];
  for(const capability of ownedCapabilities)verifiedCapabilities.push(await verifyIndependentInternalContribution({
    contributions:capability,manifest,intake}));
  const selected = new Map(), contributions = [], contributionUnavailable = [];
  for (const previous of baseProof?.version === 2 ? baseProof.contributions : []) {
    const source = manifest.sources[previous.sourceId];
    if (source?.count > 0 && rawDigest(source) === previous.sourceSha256) selected.set(previous.sourceId, previous);
  }
  for (const value of verifiedCapabilities) {
    const reference=sourceContributionReference(value.reference);selected.set(reference.sourceId,reference);
  }
  for (const reference of selected.values()) {
    try {contributions.push(await (policy ? readSourceContributionDescriptor : verifySourceContribution)({storage, ...reference, internalManifest: manifest}));}
    catch {contributionUnavailable.push(reference.sourceId);}
  }
  // This stage reads only immutable control headers. The shared runtime checks
  // actual input witnesses/chunks after this pending pointer protects all refs.
  const provenance = buildRawInternalProvenance({manifest, references, contributions});
  const candidate = rawInternalPointerDescriptor(manifest, provenance);
  await immutable(storage, rawInternalProvenanceKey(manifest.generationId), provenance);
  let binding = null;
  if (policy) {
    const state = await readState(storage, policy), pointer = state.pointers.find(row => row.id === RAW_INTERNAL_COORDINATION_ID);
    assert.ok(pointer && same(pointer.current, base), 'raw_coord_internal_base_provenance_changed');
    assert.equal(pointer.pending, null, 'raw_coord_internal_prior_writer_pending');
    const identity = owner || rawProducerOwner();
    const ticket = (await mutateRawCoordination({storage, command: {type: 'reserve_pointer', id: RAW_INTERNAL_COORDINATION_ID,
      operationId, owner: {runId: identity.runId, attempt: identity.attempt, sourceSha: identity.sourceSha || identity.revision},
      token: randomBytes(16).toString('hex'), pointerRevision: pointer.revision, base, candidate}})).result;
    binding = {version: 1, policy, ticket};
    await immutable(storage, sessionKey(manifest), {version: 1, binding, base, candidate});
  }
  const verify = async () => {
    for(const capability of ownedCapabilities)await verifyIndependentInternalContribution({contributions:capability,manifest,intake});
    assert.ok(same(await storage.readJson(rawInternalProvenanceKey(manifest.generationId), null), provenance), 'raw_internal_immutable_changed');
    if (binding) assert.ok(same(await storage.readJson(sessionKey(manifest), null), {version: 1, binding, base, candidate}), 'raw_coord_internal_session_changed');
    await assertRawInternalReservation({storage, policy, ticket: binding?.ticket, manifest, baseManifest, verifyInputs: false});
  };
  return {manifest, provenance, binding, contributionUnavailable, ticket: binding?.ticket, verifyBeforeCommit: verify,
    async afterCommit() {
      if (!binding) {await assertRawCoordinationPolicy(storage, null); return;}
      const state = await readState(storage, policy), pointer = state.pointers.find(row => row.id === RAW_INTERNAL_COORDINATION_ID);
      assert.ok(same(capability(state, pointer?.pending), binding.ticket), 'raw_coord_ownership_changed');
      const actual = await storage.readJson(RAW_INTERNAL_MANIFEST_KEY, null);
      assert.ok(same(actual, manifest), 'raw_coord_internal_readback_changed');
      await immutable(storage, receiptKey(binding.ticket), {version: 1, kind: 'pointer_write_settled',
        id: RAW_INTERNAL_COORDINATION_ID, key: RAW_INTERNAL_MANIFEST_KEY, ticket: binding.ticket, valueSha256: rawDigest(actual)});
      await reconcileRawInternalPublication({storage, binding, manifest});
    }};
}
