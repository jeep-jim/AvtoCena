import assert from 'node:assert/strict';
import {rawDigest, rawRootKind, assertRawGenerationProvenance} from './catalog-raw-provenance.mjs';
import {RAW_INTERNAL_COORDINATION_ID} from '../../apps/web/lib/catalog/raw-internal-provenance.mjs';

export const RAW_COORDINATION_KEY = 'catalog/raw-feed-coordination/v1/state.json';
export const RAW_COORDINATION_LIMITS = Object.freeze({roots: 10000, claims: 256, references: 4096,
  bytes: 4 * 1024 * 1024, groups: 10, objects: 250000, inventoryBytes: 100 * 1024 ** 3, batch: 1000});
export const RAW_COORDINATED_WRITERS = Object.freeze(['che168_archive', 'che168_bulk', 'che168_recovery',
  'encar_intake', 'encar_reports', 'encar_restore', 'nonjp_intake', 'nonjp_restore',
  'catalog_persist', 'catalog_activate_verified', 'catalog_stitch_verified', 'catalog_restore_preinventory', 'catalog_commit_intake_cursor',
  'catalog_reset_public', 'catalog_import_sample_reset']);
export const RAW_COORDINATED_POINTERS = Object.freeze(['intake_cursor:china', 'intake_cursor:korea', 'intake_cursor:uae',
  'intake_cursor:europe', 'intake_cursor:georgia', 'che168_snapshot_config', RAW_INTERNAL_COORDINATION_ID]);
const SHA = /^[a-f0-9]{64}$/, SOURCE_SHA = /^[a-f0-9]{40}$/;
const ID = /^[a-zA-Z0-9_-]{1,150}$/, TOKEN = /^[a-f0-9]{32,64}$/;
const GENERATION = /^gen_\d+_[a-z0-9-]+$/;
const object = row => row !== null && typeof row === 'object' && !Array.isArray(row);
const integer = n => Number.isSafeInteger(n) && n >= 0;
const same = (left, right) => rawDigest(left) === rawDigest(right);
const list = (value, limit, code) => assert.ok(Array.isArray(value) && value.length <= limit, code);
const digest = (value, code) => assert.match(value || '', SHA, code);
const revision = (value, upper) => assert.ok(Number.isSafeInteger(value) && value > 0 && value <= upper, 'raw_coord_revision');

// The extension is deliberately explicit: a configurable arbitrary prefix could
// accidentally make customer data or Japan eligible for a raw-feed operation.
export function coordinatedRawRootKind(root) {
  return rawRootKind(root) || (typeof root === 'string'
    && /^catalog\/nonjp-intake\/v1\/(china|korea|uae|europe|georgia)\/\d{1,20}\/[1-9]\d{0,5}$/.test(root)
    ? 'nonjp-intake' : null);
}

export function coordinatedRawReferences(values) {
  list(values, RAW_COORDINATION_LIMITS.references, 'raw_coord_reference_limit');
  const roots = new Map();
  for (const row of values) {
    assert.ok(object(row) && coordinatedRawRootKind(row.root) === row.kind && row.kind, 'raw_coord_root_scope');
    if (row.sha256 !== undefined) digest(row.sha256, 'raw_coord_reference_sha');
    const clean = {kind: row.kind, root: row.root, ...(row.sha256 ? {sha256: row.sha256} : {})}, old = roots.get(row.root);
    if (old?.sha256 && clean.sha256) assert.equal(old.sha256, clean.sha256, 'raw_coord_reference_conflict');
    roots.set(row.root, old?.sha256 ? old : clean);
  }
  return [...roots.values()].sort((a, b) => a.root.localeCompare(b.root));
}

function owner(value) {
  assert.ok(object(value) && /^\d{1,20}$/.test(value.runId || '') && /^[1-9]\d{0,5}$/.test(value.attempt || '')
    && SOURCE_SHA.test(value.sourceSha), 'raw_coord_owner');
  return {runId: value.runId, attempt: value.attempt, sourceSha: value.sourceSha};
}

function identity(value) {
  assert.match(value?.operationId || '', ID, 'raw_coord_operation');
  assert.match(value.token || '', TOKEN, 'raw_coord_token');
  return {operationId: value.operationId, owner: owner(value.owner), token: value.token};
}

function descriptor(value) {
  assert.ok(object(value) && (GENERATION.test(value.generationId) || value.generationId === 'empty'), 'raw_coord_generation');
  digest(value.manifestSha256, 'raw_coord_manifest_sha');
  assert.equal(typeof value.complete, 'boolean', 'raw_coord_complete');
  if (value.provenanceSha256 !== null) digest(value.provenanceSha256, 'raw_coord_provenance_sha');
  const references = coordinatedRawReferences(value.references);
  if (value.complete && value.generationId !== 'empty') assert.ok(value.provenanceSha256 !== null, 'raw_coord_complete_without_provenance');
  if (value.generationId === 'empty') assert.ok(value.complete && !references.length
    && value.provenanceSha256 === null && value.manifestSha256 === rawDigest(null), 'raw_coord_empty_manifest');
  return {generationId: value.generationId, manifestSha256: value.manifestSha256,
    provenanceSha256: value.provenanceSha256, complete: value.complete, references};
}

export function rawPointerDescriptor(value, references, {complete = false} = {}) {
  return pointerDescriptor({sha256: rawDigest(value), references, complete});
}

function pointerDescriptor(value, id) {
  digest(value?.sha256, 'raw_coord_pointer_sha');
  assert.equal(typeof value.complete, 'boolean', 'raw_coord_pointer_complete');
  const clean = {sha256: value.sha256, complete: value.complete, references: coordinatedRawReferences(value.references)};
  if (id === RAW_INTERNAL_COORDINATION_ID) {
    assert.ok(Object.hasOwn(value, 'provenanceSha256'), 'raw_coord_internal_provenance_missing');
    if (value.provenanceSha256 !== null) digest(value.provenanceSha256, 'raw_coord_internal_provenance_sha');
    if (value.complete && value.sha256 !== rawDigest(null)) assert.ok(value.provenanceSha256 !== null, 'raw_coord_internal_complete_without_provenance');
    clean.provenanceSha256 = value.provenanceSha256;
  } else assert.equal(value.provenanceSha256, undefined, 'raw_coord_pointer_provenance_scope');
  return clean;
}

/** The caller reads the actual manifest/provenance. Unknown legacy is explicit. */
export function rawCatalogDescriptor(manifest, provenance = null) {
  if (manifest === null) return descriptor({generationId: 'empty', manifestSha256: rawDigest(null),
    provenanceSha256: null, complete: true, references: []});
  assert.ok(GENERATION.test(manifest?.generationId), 'raw_coord_generation');
  const references = provenance === null ? [] : assertRawGenerationProvenance(provenance, manifest, {requireComplete: false});
  const complete = provenance?.complete === true && ['china', 'korea', 'uae', 'europe', 'georgia']
    .every(market => !(manifest.markets?.[market]?.count > 0) || provenance.markets?.[market]?.complete === true);
  return descriptor({generationId: manifest.generationId, manifestSha256: rawDigest(manifest),
    provenanceSha256: provenance === null ? null : rawDigest(provenance), complete, references});
}

function ticket(state, entry) {
  return {registryId: state.registryId, ...identity(entry), grantRevision: entry.grantRevision, revision: entry.revision};
}

function owned(state, entry, supplied) {
  assert.ok(entry && same(ticket(state, entry), supplied), 'raw_coord_ownership_changed');
  return entry;
}

function allCatalogReferences(state) {
  return [state.catalog.current, state.catalog.previous, state.catalog.pending?.candidate]
    .filter(Boolean).flatMap(row => row.references);
}

function allPointerReferences(state) {
  return state.pointers.flatMap(row => [...row.current.references, ...(row.pending?.candidate.references || [])]);
}

function touch(state, ref, {invalidateProof = true} = {}) {
  let row = state.roots.find(item => item.root === ref.root);
  if (!row) {
    row = {kind: ref.kind, root: ref.root, incarnation: state.revision, revision: state.revision,
      state: 'live', proof: null};
    state.roots.push(row);
  }
  assert.equal(row.state, 'live', 'raw_coord_root_deleting_or_deleted');
  row.revision = state.revision;
  if (invalidateProof) row.proof = null;
  return row;
}

function protectedRoot(state, root) {
  return [...allCatalogReferences(state), ...allPointerReferences(state)].some(ref => ref.root === root)
    || state.claims.some(claim => claim.references.some(ref => ref.root === root));
}

function gcAllowed(state) {
  assert.equal(state.coverage.status, 'verified', 'raw_coord_coverage_unknown');
  assert.ok([state.catalog.current, state.catalog.previous, state.catalog.pending?.candidate]
    .filter(Boolean).every(row => row.complete), 'raw_coord_generation_unknown');
  assert.ok(state.pointers.every(row => row.current.complete && (!row.pending || row.pending.candidate.complete)), 'raw_coord_pointer_unknown');
}

export function rawCoordinationCapacity(state) {
  return {roots: state.roots.length, tombstones: state.roots.filter(row => row.state === 'deleted').length,
    claims: state.claims.length, bytes: Buffer.byteLength(JSON.stringify(state)), limits: RAW_COORDINATION_LIMITS};
}

export function assertRawCoordination(state) {
  assert.ok(state?.version === 1 && state.scope === 'nonjp_raw_lifecycle_v1' && TOKEN.test(state.registryId), 'raw_coord_state');
  revision(state.revision, Number.MAX_SAFE_INTEGER - 1);
  list(state.roots, RAW_COORDINATION_LIMITS.roots, 'raw_coord_root_capacity');
  list(state.claims, RAW_COORDINATION_LIMITS.claims, 'raw_coord_claim_capacity');
  assert.ok(['unknown', 'verified'].includes(state.coverage?.status), 'raw_coord_coverage');
  revision(state.coverage.revision, state.revision);
  if (state.coverage.status === 'verified') digest(state.coverage.proofSha256, 'raw_coord_coverage_proof');
  const roots = new Map();
  for (const row of state.roots) {
    assert.ok(coordinatedRawRootKind(row.root) === row.kind && row.kind && !roots.has(row.root), 'raw_coord_duplicate_or_invalid_root');
    revision(row.incarnation, row.revision); revision(row.revision, state.revision);
    assert.ok(['live', 'deleting', 'deleted'].includes(row.state), 'raw_coord_root_state');
    if (row.proof !== null) {
      for (const field of ['inventorySha256', 'receiptSha256', 'writerProofSha256', 'coverageProofSha256']) digest(row.proof[field], 'raw_coord_root_proof');
      revision(row.proof.revision, row.revision);
    }
    if (row.state !== 'live') {
      assert.match(row.deletion?.token || '', TOKEN, 'raw_coord_deletion_owner');
      digest(row.deletion?.planSha256, 'raw_coord_deletion_plan');
    }
    roots.set(row.root, row);
  }
  const tokens = new Set(), operations = new Set();
  for (const claim of state.claims) {
    identity(claim); revision(claim.grantRevision, claim.revision); revision(claim.revision, state.revision);
    assert.ok(!tokens.has(claim.token) && !operations.has(claim.operationId), 'raw_coord_duplicate_claim');
    assert.ok(['writing', 'ready'].includes(claim.phase), 'raw_coord_claim_phase');
    if (claim.phase === 'ready') assert.equal(claim.releasePolicy, 'published_generation_references_or_terminal_abandon');
    assert.ok(same(coordinatedRawReferences(claim.references), claim.references), 'raw_coord_claim_references');
    tokens.add(claim.token); operations.add(claim.operationId);
  }
  revision(state.catalog.revision, state.revision);
  descriptor(state.catalog.current); descriptor(state.catalog.previous);
  if (state.catalog.pending) {
    const pending = state.catalog.pending;
    identity(pending); revision(pending.grantRevision, pending.revision); revision(pending.revision, state.revision);
    descriptor(pending.candidate);
    assert.ok(same(pending.base, state.catalog.current) && same(pending.previous, state.catalog.previous), 'raw_coord_pending_base');
  }
  list(state.pointers, RAW_COORDINATED_POINTERS.length, 'raw_coord_pointer_limit');
  assert.deepEqual(state.pointers.map(row => row.id).sort(), [...RAW_COORDINATED_POINTERS].sort(), 'raw_coord_pointer_inventory');
  for (const pointer of state.pointers) {
    revision(pointer.revision, state.revision); pointerDescriptor(pointer.current, pointer.id);
    if (pointer.lastCommit) {
      identity(pointer.lastCommit);
      revision(pointer.lastCommit.grantRevision, pointer.lastCommit.revision);
      revision(pointer.lastCommit.revision, pointer.lastCommit.committedRevision);
      revision(pointer.lastCommit.committedRevision, pointer.revision);
    }
    if (pointer.pending) {
      const pending = pointer.pending;
      identity(pending); revision(pending.grantRevision, pending.revision); revision(pending.revision, state.revision);
      pointerDescriptor(pending.candidate, pointer.id);
      assert.ok(same(pending.base, pointer.current), 'raw_coord_pointer_pending_base');
    }
  }
  for (const ref of [...allCatalogReferences(state), ...allPointerReferences(state), ...state.claims.flatMap(claim => claim.references)]) {
    assert.equal(roots.get(ref.root)?.state, 'live', 'raw_coord_protected_root_not_live');
  }
  if (state.gc) {
    const gc = state.gc; identity(gc); revision(gc.grantRevision, gc.revision); revision(gc.revision, state.revision);
    digest(gc.planSha256, 'raw_coord_gc_plan'); digest(gc.coverageProofSha256, 'raw_coord_gc_coverage');
    assert.ok(['deleting', 'completed'].includes(gc.state), 'raw_coord_gc_state');
    list(gc.groups, RAW_COORDINATION_LIMITS.groups, 'raw_coord_gc_groups');
    list(gc.batches, RAW_COORDINATION_LIMITS.objects / RAW_COORDINATION_LIMITS.batch, 'raw_coord_gc_batches');
    assert.ok(integer(gc.nextBatch) && gc.nextBatch <= gc.batches.length
      && integer(gc.acknowledgedObjects) && integer(gc.acknowledgedInventoryBytes), 'raw_coord_gc_progress');
    for (const batch of gc.batches) assert.ok(integer(batch.count) && batch.count > 0 && batch.count <= RAW_COORDINATION_LIMITS.batch
      && integer(batch.bytes) && SHA.test(batch.sha256), 'raw_coord_gc_batch_descriptor');
    for (const group of gc.groups) {
      const root = roots.get(group.root);
      assert.ok(root && root.incarnation === group.incarnation && root.state === (gc.state === 'completed' ? 'deleted' : 'deleting')
        && root.deletion.token === gc.token && root.deletion.planSha256 === gc.planSha256, 'raw_coord_gc_root_ownership');
    }
    if (gc.inflight) {
      assert.equal(gc.inflight.index, gc.nextBatch, 'raw_coord_gc_batch_cursor');
      revision(gc.inflight.attemptRevision, gc.revision);
      assert.ok(['active', 'paused'].includes(gc.inflight.phase), 'raw_coord_gc_batch_phase');
      list(gc.inflight.objects, RAW_COORDINATION_LIMITS.batch, 'raw_coord_gc_batch_size');
      assert.equal(rawDigest(gc.inflight.objects), gc.batches[gc.nextBatch].sha256, 'raw_coord_gc_batch_binding');
      assert.ok(new Set(gc.inflight.absent).size === gc.inflight.absent.length
        && gc.inflight.absent.every(index => integer(index) && index < gc.inflight.objects.length), 'raw_coord_gc_absent_indexes');
    }
    const acknowledgedObjects = gc.batches.slice(0, gc.nextBatch).reduce((sum, batch) => sum + batch.count, 0) + (gc.inflight?.absent.length || 0);
    const acknowledgedBytes = gc.batches.slice(0, gc.nextBatch).reduce((sum, batch) => sum + batch.bytes, 0)
      + (gc.inflight?.absent.reduce((sum, index) => sum + gc.inflight.objects[index].size, 0) || 0);
    assert.ok(gc.acknowledgedObjects === acknowledgedObjects && gc.acknowledgedInventoryBytes === acknowledgedBytes, 'raw_coord_gc_progress_mismatch');
    if (gc.state === 'completed') assert.ok(gc.inflight === null && gc.nextBatch === gc.batches.length, 'raw_coord_gc_completed_with_pending');
  }
  assert.ok(rawCoordinationCapacity(state).bytes <= RAW_COORDINATION_LIMITS.bytes, 'raw_coord_byte_capacity');
  return state;
}

export function createRawCoordination({registryId, current, previous, pointers = []}) {
  list(pointers, RAW_COORDINATED_POINTERS.length, 'raw_coord_pointer_limit');
  assert.ok(new Set(pointers.map(row => row.id)).size === pointers.length
    && pointers.every(row => RAW_COORDINATED_POINTERS.includes(row.id)), 'raw_coord_pointer_scope');
  const state = {version: 1, scope: 'nonjp_raw_lifecycle_v1', registryId, revision: 1,
    coverage: {status: 'unknown', revision: 1, reason: 'writer_inventory_not_verified', proofSha256: null},
    roots: [], claims: [], catalog: {revision: 1, current: descriptor(current), previous: descriptor(previous), pending: null},
    pointers: RAW_COORDINATED_POINTERS.map(id => ({id, revision: 1, pending: null,
      current: pointerDescriptor(pointers.find(row => row.id === id)?.current || {sha256: rawDigest(null), complete: false, references: [],
        ...(id === RAW_INTERNAL_COORDINATION_ID ? {provenanceSha256: null} : {})}, id)})), gc: null};
  for (const ref of [...allCatalogReferences(state), ...allPointerReferences(state)]) touch(state, ref);
  return assertRawCoordination(state);
}

function assertCoverageReport(report, state) {
  assert.ok(report?.version === 1 && report.complete === true && report.registryId === state.registryId
    && report.atRevision === state.revision - 1, 'raw_coord_coverage_snapshot');
  assert.equal(report.currentSha256, rawDigest(state.catalog.current), 'raw_coord_coverage_current');
  assert.equal(report.previousSha256, rawDigest(state.catalog.previous), 'raw_coord_coverage_previous');
  assert.equal(report.pointersSha256, rawDigest(state.pointers), 'raw_coord_coverage_pointers');
  for (const name of ['writerInventorySha256', 'pinInventorySha256', 'objectInventorySha256']) digest(report[name], 'raw_coord_coverage_evidence');
  list(report.writers, RAW_COORDINATED_WRITERS.length, 'raw_coord_writer_inventory');
  assert.deepEqual(report.writers.map(row => row.id).sort(), [...RAW_COORDINATED_WRITERS].sort(), 'raw_coord_writer_inventory');
  assert.ok(report.writers.every(row => SOURCE_SHA.test(row.sourceSha)
    && ['coordinated', 'blocked'].includes(row.mode) && row.protocolVersion === 1), 'raw_coord_writer_protocol');
  assert.equal(report.legacyJobsComplete, true, 'raw_coord_legacy_jobs_unknown');
  list(report.legacyJobs, 1000, 'raw_coord_legacy_job_limit');
  for (const job of report.legacyJobs) {
    owner(job); assert.equal(job.status, 'completed', 'raw_coord_legacy_writer_active');
    digest(job.terminalEvidenceSha256, 'raw_coord_legacy_terminal_evidence');
  }
}

function inventoryObjects(group) {
  list(group.objects, RAW_COORDINATION_LIMITS.objects, 'raw_coord_inventory_object_limit');
  assert.ok(group.objects.length > 0, 'raw_coord_empty_gc_group');
  const seen = new Set();
  return group.objects.map(row => {
    const leaf = typeof row.key === 'string' && row.key.startsWith(group.root + '/') ? row.key.slice(group.root.length + 1) : '';
    assert.ok(/^[a-zA-Z0-9_./-]{1,512}$/.test(leaf) && !leaf.split('/').some(part => !part || part === '.' || part === '..')
      && !seen.has(row.key) && integer(row.size) && typeof row.lastModified === 'string'
      && Number.isFinite(Date.parse(row.lastModified)), 'raw_coord_inventory_object');
    seen.add(row.key);
    return {key: row.key, size: row.size, lastModified: row.lastModified};
  }).sort((a, b) => a.key.localeCompare(b.key));
}

/** The immutable plan contains exact keys. The coordinator keeps only its hash,
 * root identities, batch hashes and one bounded in-flight batch. */
export function rawGcPlan(groups) {
  list(groups, RAW_COORDINATION_LIMITS.groups, 'raw_coord_gc_group_limit');
  assert.ok(groups.length > 0, 'raw_coord_gc_empty_plan');
  const seen = new Set(), clean = groups.map(group => {
    assert.ok(coordinatedRawRootKind(group.root) === group.kind && group.kind && !seen.has(group.root), 'raw_coord_gc_group_scope');
    seen.add(group.root); revision(group.incarnation, group.revision); revision(group.revision, Number.MAX_SAFE_INTEGER - 1);
    digest(group.receiptSha256, 'raw_coord_gc_receipt');
    const objects = inventoryObjects(group);
    return {kind: group.kind, root: group.root, incarnation: group.incarnation, revision: group.revision,
      receiptSha256: group.receiptSha256, inventorySha256: rawDigest(objects), objects};
  }).sort((a, b) => a.root.localeCompare(b.root));
  const objects = clean.flatMap(group => group.objects), bytes = objects.reduce((sum, row) => sum + row.size, 0);
  assert.ok(objects.length <= RAW_COORDINATION_LIMITS.objects && integer(bytes) && bytes <= RAW_COORDINATION_LIMITS.inventoryBytes, 'raw_coord_gc_budget');
  const plan = {version: 1, groups: clean}, sha256 = rawDigest(plan), batches = [];
  for (let offset = 0; offset < objects.length; offset += RAW_COORDINATION_LIMITS.batch) {
    const rows = objects.slice(offset, offset + RAW_COORDINATION_LIMITS.batch);
    batches.push({count: rows.length, bytes: rows.reduce((sum, row) => sum + row.size, 0), sha256: rawDigest(rows)});
  }
  return {plan, sha256, key: 'catalog/raw-feed-gc-plans/v1/' + sha256 + '.json', objects, batches, bytes};
}

function gcEntry(state, supplied) { return owned(state, state.gc, supplied); }
function gcAttemptTicket(state, gc) {
  return {registryId: state.registryId, token: gc.token, grantRevision: gc.grantRevision,
    index: gc.inflight.index, attemptRevision: gc.inflight.attemptRevision, batchSha256: gc.batches[gc.inflight.index].sha256};
}

/** Pure transitions: a stale ticket is never rebased into a new owner grant.
 * Age is intentionally absent from every protection/deletion decision. */
export function transitionRawCoordination(before, command) {
  assertRawCoordination(before);
  assert.equal(command.expectedRevision, before.revision, 'raw_coord_stale_revision');
  const state = structuredClone(before); state.revision++;
  let result;
  const claim = () => owned(state, state.claims.find(row => row.token === command.ticket?.token), command.ticket);
  switch (command.type) {
    case 'claim': {
      const id = identity(command), references = coordinatedRawReferences(command.references);
      assert.ok(!state.claims.some(row => row.operationId === id.operationId || row.token === id.token), 'raw_coord_claim_already_exists');
      for (const ref of references) touch(state, ref);
      const row = {...id, grantRevision: state.revision, revision: state.revision, phase: 'writing', references};
      state.claims.push(row); result = ticket(state, row); break;
    }
    case 'extend': {
      const row = claim(); assert.equal(row.phase, 'writing', 'raw_coord_claim_sealed');
      row.references = coordinatedRawReferences([...row.references, ...command.references]);
      for (const ref of row.references) touch(state, ref);
      row.revision = state.revision; result = ticket(state, row); break;
    }
    case 'seal': {
      const row = claim(); assert.equal(row.phase, 'writing', 'raw_coord_claim_sealed');
      assert.equal(command.allWritesDrained, true, 'raw_coord_writes_not_drained');
      for (const ref of row.references) touch(state, ref);
      Object.assign(row, {phase: 'ready', revision: state.revision, releasePolicy: 'published_generation_references_or_terminal_abandon'});
      result = ticket(state, row); break;
    }
    case 'release': {
      const row = claim(); assert.equal(row.phase, 'ready', 'raw_coord_claim_not_ready');
      digest(command.terminalPinSha256, 'raw_coord_terminal_pin_proof');
      if (command.outcome === 'published') {
        const published = [state.catalog.current, state.catalog.previous].find(value => value.generationId === command.generationId);
        assert.ok(published, 'raw_coord_published_generation_missing');
        const refs = new Map(published.references.map(ref => [ref.root, ref]));
        assert.ok(row.references.every(ref => refs.has(ref.root) && (!ref.sha256 || refs.get(ref.root).sha256 === ref.sha256)), 'raw_coord_published_references_missing');
      } else {
        assert.equal(command.outcome, 'abandoned', 'raw_coord_release_outcome');
        digest(command.terminalWriterProofSha256, 'raw_coord_terminal_writer_proof');
      }
      for (const ref of row.references) touch(state, ref);
      state.claims = state.claims.filter(value => value !== row); result = {released: row.operationId}; break;
    }
    case 'register': {
      identity(command);
      for (const ref of coordinatedRawReferences(command.references)) touch(state, ref);
      result = {registered: command.references.length}; break;
    }
    case 'verify_coverage': {
      assertCoverageReport(command.report, state);
      state.coverage = {status: 'verified', revision: state.revision, proofSha256: rawDigest(command.report)};
      result = state.coverage; break;
    }
    case 'invalidate_coverage': {
      assert.match(command.reason || '', /^[a-z_]{1,100}$/, 'raw_coord_coverage_reason');
      state.coverage = {status: 'unknown', revision: state.revision, reason: command.reason, proofSha256: null};
      result = state.coverage; break;
    }
    case 'prove_root': {
      gcAllowed(state);
      const row = state.roots.find(value => value.root === command.root);
      assert.ok(row && row.state === 'live' && row.incarnation === command.incarnation && row.revision === command.rootRevision, 'raw_coord_root_changed');
      assert.ok(!state.claims.some(value => value.references.some(ref => ref.root === row.root)), 'raw_coord_root_has_claim');
      assert.equal(command.coverageProofSha256, state.coverage.proofSha256, 'raw_coord_root_proof_coverage_changed');
      for (const field of ['inventorySha256', 'receiptSha256', 'writerProofSha256']) digest(command[field], 'raw_coord_root_proof');
      row.proof = {inventorySha256: command.inventorySha256, receiptSha256: command.receiptSha256,
        writerProofSha256: command.writerProofSha256, coverageProofSha256: state.coverage.proofSha256, revision: state.revision};
      row.revision = state.revision; result = structuredClone(row); break;
    }
    case 'reserve_publication': {
      assert.equal(state.catalog.pending, null, 'raw_coord_publication_pending');
      assert.equal(command.catalogRevision, state.catalog.revision, 'raw_coord_catalog_changed');
      assert.ok(same(descriptor(command.base), state.catalog.current) && same(descriptor(command.previous), state.catalog.previous), 'raw_coord_publication_base_changed');
      const candidate = descriptor(command.candidate);
      assert.notEqual(candidate.generationId, state.catalog.current.generationId, 'raw_coord_publication_same_generation');
      for (const ref of candidate.references) touch(state, ref);
      state.catalog.pending = {...identity(command), grantRevision: state.revision, revision: state.revision,
        base: state.catalog.current, previous: state.catalog.previous, candidate};
      state.catalog.revision = state.revision; result = ticket(state, state.catalog.pending); break;
    }
    case 'reserve_pointer': {
      const pointer = state.pointers.find(row => row.id === command.id);
      assert.ok(pointer, 'raw_coord_pointer_scope');
      assert.equal(pointer.pending, null, 'raw_coord_pointer_pending');
      assert.equal(command.pointerRevision, pointer.revision, 'raw_coord_pointer_changed');
      assert.ok(same(pointerDescriptor(command.base, command.id), pointer.current), 'raw_coord_pointer_base_changed');
      const candidate = pointerDescriptor(command.candidate, command.id);
      for (const ref of candidate.references) touch(state, ref);
      pointer.pending = {...identity(command), grantRevision: state.revision, revision: state.revision, base: pointer.current, candidate};
      pointer.revision = state.revision; result = ticket(state, pointer.pending); break;
    }
    case 'commit_pointer': {
      const pointer = state.pointers.find(row => row.id === command.id);
      const pending = owned(state, pointer?.pending, command.ticket);
      assert.equal(rawDigest(command.observedValue), pending.candidate.sha256, 'raw_coord_pointer_not_committed');
      for (const ref of [...pointer.current.references, ...pending.candidate.references]) touch(state, ref);
      pointer.lastCommit = {...identity(pending), grantRevision: pending.grantRevision, revision: pending.revision,
        committedRevision: state.revision};
      pointer.current = pending.candidate; pointer.pending = null; pointer.revision = state.revision;
      result = {id: pointer.id, revision: pointer.revision}; break;
    }
    case 'abort_pointer': {
      const pointer = state.pointers.find(row => row.id === command.id);
      const pending = owned(state, pointer?.pending, command.ticket);
      assert.equal(command.allWritesDrained, true, 'raw_coord_pointer_writer_not_drained');
      digest(command.terminalWriterProofSha256, 'raw_coord_terminal_writer_proof');
      assert.equal(rawDigest(command.observedValue), pending.base.sha256, 'raw_coord_pointer_already_changed');
      for (const ref of pending.candidate.references) touch(state, ref);
      pointer.pending = null; pointer.revision = state.revision; result = {aborted: pending.operationId}; break;
    }
    case 'commit_publication': {
      const pending = owned(state, state.catalog.pending, command.ticket);
      assert.equal(rawDigest(command.observedManifest), pending.candidate.manifestSha256, 'raw_coord_manifest_not_committed');
      assert.equal(command.observedManifest?.generationId, pending.candidate.generationId, 'raw_coord_manifest_not_committed');
      assert.equal(rawDigest(command.observedPreviousManifest), pending.base.manifestSha256, 'raw_coord_previous_not_committed');
      for (const ref of allCatalogReferences(state)) touch(state, ref);
      state.catalog = {revision: state.revision, current: pending.candidate, previous: pending.base, pending: null,
        lastCommit: {operationId: pending.operationId, token: pending.token, grantRevision: pending.grantRevision}};
      result = {generationId: state.catalog.current.generationId}; break;
    }
    case 'abort_publication': {
      const pending = owned(state, state.catalog.pending, command.ticket);
      assert.equal(command.allWritesDrained, true, 'raw_coord_publication_writer_not_drained');
      digest(command.terminalWriterProofSha256, 'raw_coord_terminal_writer_proof');
      assert.equal(rawDigest(command.observedManifest), pending.base.manifestSha256, 'raw_coord_publication_already_changed');
      for (const ref of pending.candidate.references) touch(state, ref);
      state.catalog.pending = null; state.catalog.revision = state.revision; result = {aborted: pending.operationId}; break;
    }
    case 'claim_gc': {
      gcAllowed(state);
      assert.ok(!state.gc || state.gc.state === 'completed', 'raw_coord_gc_already_pending');
      const id = identity(command), plan = rawGcPlan(command.plan.groups);
      assert.equal(plan.sha256, command.planSha256, 'raw_coord_gc_plan_changed');
      for (const group of plan.plan.groups) {
        const row = state.roots.find(value => value.root === group.root);
        assert.ok(row && row.state === 'live' && row.incarnation === group.incarnation && row.revision === group.revision, 'raw_coord_gc_root_changed');
        assert.ok(!protectedRoot(state, row.root), 'raw_coord_gc_root_protected');
        assert.ok(row.proof && row.proof.inventorySha256 === group.inventorySha256
          && row.proof.receiptSha256 === group.receiptSha256, 'raw_coord_gc_root_unknown');
        assert.equal(row.proof.coverageProofSha256, state.coverage.proofSha256, 'raw_coord_gc_root_coverage_changed');
        Object.assign(row, {state: 'deleting', revision: state.revision,
          deletion: {operationId: id.operationId, token: id.token, planSha256: plan.sha256}});
      }
      state.gc = {...id, grantRevision: state.revision, revision: state.revision, state: 'deleting',
        planSha256: plan.sha256, planKey: plan.key, coverageProofSha256: state.coverage.proofSha256,
        groups: plan.plan.groups.map(({objects, ...row}) => row), batches: plan.batches,
        nextBatch: 0, inflight: null, acknowledgedObjects: 0, acknowledgedInventoryBytes: 0};
      result = ticket(state, state.gc); break;
    }
    case 'begin_gc_batch': {
      const gc = gcEntry(state, command.ticket); gcAllowed(state);
      assert.equal(gc.state, 'deleting', 'raw_coord_gc_completed');
      assert.equal(gc.coverageProofSha256, state.coverage.proofSha256, 'raw_coord_gc_coverage_changed');
      const plan = rawGcPlan(command.plan.groups);
      assert.equal(plan.sha256, gc.planSha256, 'raw_coord_gc_plan_changed');
      assert.ok(gc.nextBatch < gc.batches.length, 'raw_coord_gc_batches_complete');
      assert.ok(gc.inflight === null || gc.inflight.phase === 'paused', 'raw_coord_gc_batch_active');
      const objects = plan.objects.slice(gc.nextBatch * RAW_COORDINATION_LIMITS.batch, (gc.nextBatch + 1) * RAW_COORDINATION_LIMITS.batch);
      gc.inflight = {index: gc.nextBatch, attemptRevision: state.revision, phase: 'active', objects,
        absent: gc.inflight?.absent || [], error: null};
      gc.revision = state.revision; result = {ticket: ticket(state, gc), attempt: gcAttemptTicket(state, gc)}; break;
    }
    case 'record_gc_batch': {
      const gc = gcEntry(state, command.ticket);
      assert.ok(gc.inflight?.phase === 'active' && same(gcAttemptTicket(state, gc), command.attempt), 'raw_coord_gc_attempt_changed');
      assert.equal(command.requestSettled, true, 'raw_coord_gc_request_not_settled');
      list(command.absent, RAW_COORDINATION_LIMITS.batch, 'raw_coord_gc_result_limit');
      assert.ok(command.absent.every(index => integer(index) && index < gc.inflight.objects.length), 'raw_coord_gc_result_index');
      const confirmed = new Set(gc.inflight.absent);
      for (const index of command.absent) if (!confirmed.has(index)) {
        confirmed.add(index); gc.acknowledgedObjects++; gc.acknowledgedInventoryBytes += gc.inflight.objects[index].size;
      }
      gc.inflight.absent = [...confirmed].sort((a, b) => a - b);
      if (confirmed.size === gc.inflight.objects.length) { gc.nextBatch++; gc.inflight = null; }
      else {
        assert.ok(['delete_failed', 'unknown_result', 'cancelled'].includes(command.error), 'raw_coord_gc_partial_reason');
        Object.assign(gc.inflight, {phase: 'paused', error: command.error});
      }
      gc.revision = state.revision; result = ticket(state, gc); break;
    }
    case 'pause_gc_after_crash': {
      const gc = gcEntry(state, command.ticket);
      assert.ok(gc.inflight?.phase === 'active', 'raw_coord_gc_no_active_attempt');
      digest(command.terminalWriterProofSha256, 'raw_coord_terminal_writer_proof');
      assert.equal(command.allRequestsDrained, true, 'raw_coord_gc_request_not_settled');
      Object.assign(gc.inflight, {phase: 'paused', error: 'unknown_result'});
      gc.revision = state.revision; result = ticket(state, gc); break;
    }
    case 'complete_gc': {
      const gc = gcEntry(state, command.ticket); gcAllowed(state);
      assert.equal(gc.coverageProofSha256, state.coverage.proofSha256, 'raw_coord_gc_coverage_changed');
      assert.ok(gc.state === 'deleting' && gc.inflight === null && gc.nextBatch === gc.batches.length, 'raw_coord_gc_incomplete');
      list(command.emptyRoots, RAW_COORDINATION_LIMITS.groups, 'raw_coord_gc_empty_proof');
      assert.deepEqual(command.emptyRoots.map(row => row.root).sort(), gc.groups.map(row => row.root).sort(), 'raw_coord_gc_empty_proof');
      assert.ok(command.emptyRoots.every(row => row.complete === true && row.count === 0 && row.inventorySha256 === rawDigest([])), 'raw_coord_gc_root_not_empty');
      for (const group of gc.groups) {
        const row = state.roots.find(value => value.root === group.root);
        assert.equal(row.deletion.token, gc.token, 'raw_coord_gc_root_ownership');
        row.state = 'deleted'; row.revision = state.revision;
      }
      gc.state = 'completed'; gc.revision = state.revision; result = ticket(state, gc); break;
    }
    default: throw Error('raw_coord_unknown_transition');
  }
  state.roots.sort((a, b) => a.root.localeCompare(b.root));
  assertRawCoordination(state);
  return {state, result};
}

/** A permission check alone is not a write lock. The session must hold this
 * claim through completion of every PUT and drain its local queue before seal. */
export function assertRawWritePermit(state, supplied, key) {
  assertRawCoordination(state);
  const claim = owned(state, state.claims.find(row => row.token === supplied?.token), supplied);
  assert.equal(claim.phase, 'writing', 'raw_coord_write_after_seal');
  assert.ok(claim.references.some(row => {
    if (typeof key !== 'string' || !key.startsWith(row.root + '/')) return false;
    const leaf = key.slice(row.root.length + 1);
    return /^[a-zA-Z0-9_./-]{1,512}$/.test(leaf) && !leaf.split('/').some(part => !part || part === '.' || part === '..');
  }), 'raw_coord_write_outside_claim');
  return true;
}

/** Read-only ownership inspection for session/handoff recovery. It never
 * creates a fresh grant or adopts an operation merely by its friendly name. */
export function rawClaimForTicket(state, supplied) {
  assertRawCoordination(state);
  return owned(state, state.claims.find(row => row.token === supplied?.token), supplied);
}

export function rawReadyClaimForRecovery(state, supplied, references) {
  assertRawCoordination(state);
  const row = state.claims.find(value => value.token === supplied?.token);
  assert.ok(row && supplied.registryId === state.registryId
    && same(identity(row), identity(supplied)) && row.grantRevision === supplied.grantRevision
    && row.phase === 'ready' && row.revision >= supplied.revision
    && same(row.references, coordinatedRawReferences(references)), 'raw_coord_ready_recovery_changed');
  return ticket(state, row);
}

export function assertRawReadPermit(state, supplied, key) {
  const row = rawClaimForTicket(state, supplied);
  assert.ok(row.references.some(ref => typeof key === 'string' && key.startsWith(ref.root + '/')
    && /^[a-zA-Z0-9_./-]{1,512}$/.test(key.slice(ref.root.length + 1))
    && !key.slice(ref.root.length + 1).split('/').some(part => !part || part === '.' || part === '..')), 'raw_coord_read_outside_claim');
  return true;
}

/** Only this JSON key is mutated. Missing state never silently bootstraps a new
 * registry. On a conflict the intent is revalidated against the new whole state;
 * a stale owner/root/plan precondition fails instead of receiving a new token. */
export async function mutateRawCoordination({storage, command, maxAttempts = 5}) {
  assert.equal(storage.driver, 'object', 'raw_coord_requires_object_storage');
  assert.ok(Number.isInteger(maxAttempts) && maxAttempts > 0 && maxAttempts <= 8, 'raw_coord_cas_attempts');
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const meta = await storage.readJsonWithMeta(RAW_COORDINATION_KEY, null);
    assert.ok(meta.found && meta.etag, 'raw_coord_registry_missing');
    const result = transitionRawCoordination(meta.value, {...command, expectedRevision: meta.value.revision});
    try { await storage.writeJson(RAW_COORDINATION_KEY, result.state, {ifMatch: meta.etag}); return result; }
    catch (error) { if (error?.name !== 'StorageConflictError') throw error; }
  }
  throw Error('raw_coord_cas_conflict');
}
