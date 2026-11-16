import assert from 'node:assert/strict';
import test from 'node:test';
import {rawDigest, buildRawGenerationProvenance} from '../scripts/lib/catalog-raw-provenance.mjs';
import {RAW_COORDINATION_KEY, RAW_COORDINATION_LIMITS, RAW_COORDINATED_WRITERS, RAW_COORDINATED_POINTERS, coordinatedRawRootKind,
  coordinatedRawReferences, rawCatalogDescriptor, createRawCoordination, assertRawCoordination,
  rawPointerDescriptor, rawCoordinationCapacity, rawGcPlan, transitionRawCoordination, assertRawWritePermit,
  mutateRawCoordination} from '../scripts/lib/catalog-raw-coordination.mjs';

const sha = n => Number(n).toString(16).padStart(64, '0');
const token = n => Number(n).toString(16).padStart(32, '0');
const owner = {runId: '43870000000', attempt: '1', sourceSha: 'a'.repeat(40)};
const source = n => ({operationId: 'operation_' + n, owner, token: token(n)});
const root = n => 'catalog/provider-replicas/che168/00000000-0000-4000-8000-' + n.toString(16).padStart(12, '0');
const ref = n => ({kind: 'che168-replica', root: root(n)});
const manifest = n => ({version: 2, generationId: `gen_${1000 + n}_abcdef${n}`, markets: {}});
const generation = (n, references = []) => ({generationId: manifest(n).generationId, manifestSha256: rawDigest(manifest(n)),
  provenanceSha256: sha(n + 100), complete: true, references});
const emptyPointers = () => RAW_COORDINATED_POINTERS.map(id => ({id, current: rawPointerDescriptor(null, [], {complete: true})}));
const initial = () => createRawCoordination({registryId: token(999), current: generation(1), previous: generation(0), pointers: emptyPointers()});
const step = (state, command) => transitionRawCoordination(state, {...command, expectedRevision: state.revision});
const coverage = state => ({version: 1, complete: true, registryId: state.registryId, atRevision: state.revision,
  currentSha256: rawDigest(state.catalog.current), previousSha256: rawDigest(state.catalog.previous),
  pointersSha256: rawDigest(state.pointers),
  writerInventorySha256: sha(21), pinInventorySha256: sha(22), objectInventorySha256: sha(23),
  writers: RAW_COORDINATED_WRITERS.map(id => ({id, sourceSha: owner.sourceSha, mode: 'coordinated', protocolVersion: 1})),
  legacyJobsComplete: true, legacyJobs: []});
const objects = (n, count = 3) => Array.from({length: count}, (_, index) => ({key: root(n) + '/' + index + '.gz',
  size: (index + 1) * 10, lastModified: '2026-01-01T00:00:00Z'})).sort((a, b) => a.key.localeCompare(b.key));

function prove(state, n, count = 3) {
  if (!state.roots.some(row => row.root === root(n))) state = step(state, {type: 'register', ...source(n + 1000), references: [ref(n)]}).state;
  const old = state.roots.find(row => row.root === root(n)), rows = objects(n, count);
  const output = step(state, {type: 'prove_root', root: root(n), incarnation: old.incarnation, rootRevision: old.revision,
    inventorySha256: rawDigest(rows), receiptSha256: sha(n + 500), writerProofSha256: sha(700), coverageProofSha256: state.coverage.proofSha256});
  const row = output.result;
  return {state: output.state, group: {...ref(n), incarnation: row.incarnation, revision: row.revision,
    receiptSha256: row.proof.receiptSha256, objects: rows}};
}

function prepared(n = 10, count = 3) {
  let state = initial(); state = step(state, {type: 'verify_coverage', report: coverage(state)}).state;
  const proof = prove(state, n, count), plan = rawGcPlan([proof.group]);
  return {...proof, plan};
}

const claimGc = (state, plan) => step(state, {type: 'claim_gc', ...source(900), plan: plan.plan, planSha256: plan.sha256});
const seal = (state, ticket) => step(state, {type: 'seal', ticket, allWritesDrained: true});
const abandon = (state, ticket) => step(state, {type: 'release', ticket, outcome: 'abandoned',
  terminalPinSha256: sha(900), terminalWriterProofSha256: sha(901)});

test('bootstrap remains unknown, reports tombstone capacity, and never admits Japan or arbitrary storage prefixes', () => {
  const state = initial();
  assert.equal(state.coverage.status, 'unknown');
  assert.deepEqual(rawCoordinationCapacity(state).limits, RAW_COORDINATION_LIMITS);
  for (const market of ['china', 'korea', 'uae', 'europe', 'georgia']) {
    const key = `catalog/nonjp-intake/v1/${market}/43870000000/1`;
    assert.equal(coordinatedRawRootKind(key), 'nonjp-intake');
  }
  for (const key of ['catalog/nonjp-intake/v1/japan/43870000000/1', 'catalog/nonjp-intake/v1/usa/1/1',
    'crm/clients', root(1) + '/..', 'catalog/nonjp-intake/v1/korea/1/0']) {
    assert.equal(coordinatedRawRootKind(key), null);
    assert.throws(() => coordinatedRawReferences([{kind: 'nonjp-intake', root: key}]), /scope/);
  }
  assert.throws(() => coordinatedRawReferences([{...ref(1), sha256: sha(1)}, {...ref(1), sha256: sha(2)}]), /conflict/);
});

test('unknown legacy generation cannot become complete without provenance or authorize a GC proof', () => {
  const unknown = rawCatalogDescriptor(manifest(1));
  assert.equal(unknown.complete, false);
  assert.throws(() => createRawCoordination({registryId: token(1), current: {...unknown, complete: true}, previous: generation(0)}), /without_provenance/);
  let state = createRawCoordination({registryId: token(1), current: unknown, previous: generation(0)});
  state = step(state, {type: 'verify_coverage', report: coverage(state)}).state;
  assert.throws(() => prove(state, 10), /generation_unknown/);
  assert.equal(rawCatalogDescriptor(null).generationId, 'empty');
  const legacyManifest = {...manifest(2), markets: {uae: {count: 1, chunks: ['chunk-1']}}};
  const legacy = buildRawGenerationProvenance({manifest: legacyManifest, schemaVersion: 1,
    paidReports: {generationId: legacyManifest.generationId, manifestSha256: rawDigest(legacyManifest), market: 'korea',
      count: 0, paidCount: 0, chunkProofs: [], observations: [], references: []}});
  assert.equal(legacy.complete, true, 'old schema represented only China and Korea');
  assert.equal(rawCatalogDescriptor(legacyManifest, legacy).complete, false, 'missing UAE origin remains protected');
});

test('coverage demands all guarded writer paths and actual terminal evidence for every legacy job', () => {
  const state = initial(), valid = coverage(state);
  for (const edit of [row => { row.writers.pop(); }, row => { row.legacyJobsComplete = false; },
    row => { row.legacyJobs = [{...owner, status: 'in_progress', terminalEvidenceSha256: sha(1)}]; },
    row => { row.legacyJobs = [{...owner, status: 'completed'}]; },
    row => { row.writers[0].mode = 'assumed'; }, row => { row.objectInventorySha256 = ''; }]) {
    const report = structuredClone(valid); edit(report);
    assert.throws(() => step(state, {type: 'verify_coverage', report}), /raw_coord_/);
  }
  const report = structuredClone(valid);
  report.legacyJobs = [{...owner, status: 'completed', terminalEvidenceSha256: sha(18)}];
  assert.equal(step(state, {type: 'verify_coverage', report}).state.coverage.status, 'verified');
});

test('producer claim wins against an inventory prepared before its write, even when it later releases', () => {
  const fixture = prepared();
  let result = step(fixture.state, {type: 'claim', ...source(50), references: [ref(10)]});
  assert.throws(() => claimGc(result.state, fixture.plan), /root_changed/);
  const ready = seal(result.state, result.result);
  const released = abandon(ready.state, ready.result);
  assert.throws(() => claimGc(released.state, fixture.plan), /root_changed/);
  assert.equal(released.state.roots.find(row => row.root === root(10)).proof, null);
});

test('GC claim wins atomically: new producer or publication cannot pin or write the deleting root', () => {
  const fixture = prepared(), gc = claimGc(fixture.state, fixture.plan);
  assert.throws(() => step(gc.state, {type: 'claim', ...source(50), references: [ref(10)]}), /deleting_or_deleted/);
  assert.throws(() => step(gc.state, {type: 'register', ...source(51), references: [ref(10)]}), /deleting_or_deleted/);
  assert.throws(() => step(gc.state, {type: 'reserve_publication', ...source(52), catalogRevision: gc.state.catalog.revision,
    base: gc.state.catalog.current, previous: gc.state.catalog.previous, candidate: generation(2, [ref(10)])}), /deleting_or_deleted/);
  assert.throws(() => assertRawWritePermit(gc.state, {...source(50), registryId: gc.state.registryId, grantRevision: 2, revision: 2}, root(10) + '/later.gz'), /ownership/);
});

test('current, previous, and reserved candidate roots all prevent deletion without time-based expiry', () => {
  for (const slot of ['current', 'previous', 'pending']) {
    let state = createRawCoordination({registryId: token(999), current: generation(1, slot === 'current' ? [ref(10)] : []),
      previous: generation(0, slot === 'previous' ? [ref(10)] : []), pointers: emptyPointers()});
    state = step(state, {type: 'register', ...source(15), references: [ref(10)]}).state;
    state = step(state, {type: 'verify_coverage', report: coverage(state)}).state;
    if (slot === 'pending') state = step(state, {type: 'reserve_publication', ...source(20), catalogRevision: state.catalog.revision,
      base: state.catalog.current, previous: state.catalog.previous, candidate: generation(2, [ref(10)])}).state;
    const proof = prove(state, 10), plan = rawGcPlan([proof.group]);
    assert.throws(() => claimGc(proof.state, plan), /root_protected/);
    assert.ok(proof.state.catalog[slot === 'pending' ? 'pending' : slot]);
  }
});

test('publication crash retains old current, old previous and candidate until exact manifest readback', () => {
  let state = createRawCoordination({registryId: token(1), current: generation(1, [ref(1)]), previous: generation(0, [ref(2)])});
  const reserved = step(state, {type: 'reserve_publication', ...source(55), catalogRevision: state.catalog.revision,
    base: state.catalog.current, previous: state.catalog.previous, candidate: generation(2, [ref(3)])});
  state = structuredClone(reserved.state); // A fresh process sees the same durable reservation.
  assert.deepEqual(state.roots.map(row => row.root), [root(1), root(2), root(3)]);
  assert.throws(() => step(state, {type: 'commit_publication', ticket: reserved.result,
    observedManifest: manifest(1), observedPreviousManifest: manifest(0)}), /not_committed/);
  assert.throws(() => step(state, {type: 'commit_publication', ticket: reserved.result,
    observedManifest: manifest(2), observedPreviousManifest: manifest(0)}), /previous_not_committed/);
  const committed = step(state, {type: 'commit_publication', ticket: reserved.result,
    observedManifest: manifest(2), observedPreviousManifest: manifest(1)});
  assert.equal(committed.state.catalog.current.generationId, manifest(2).generationId);
  assert.equal(committed.state.catalog.previous.generationId, manifest(1).generationId);
  assert.equal(committed.state.catalog.pending, null);
  assert.throws(() => step(committed.state, {type: 'commit_publication', ticket: reserved.result,
    observedManifest: manifest(2), observedPreviousManifest: manifest(1)}), /ownership/);
});

test('publication cancellation requires a drained writer and the actual unchanged base', () => {
  const state = initial(), pending = step(state, {type: 'reserve_publication', ...source(51), catalogRevision: state.catalog.revision,
    base: state.catalog.current, previous: state.catalog.previous, candidate: generation(2, [ref(10)])});
  const command = {type: 'abort_publication', ticket: pending.result, allWritesDrained: true,
    terminalWriterProofSha256: sha(50), observedManifest: manifest(1)};
  assert.throws(() => step(pending.state, {...command, allWritesDrained: false}), /not_drained/);
  assert.throws(() => step(pending.state, {...command, observedManifest: manifest(2)}), /already_changed/);
  assert.equal(step(pending.state, command).state.catalog.pending, null);
});

test('missing cursor/config inventory stays unknown even with a complete public generation', () => {
  let state = createRawCoordination({registryId: token(1), current: generation(1), previous: generation(0)});
  assert.ok(state.pointers.every(row => row.current.complete === false));
  state = step(state, {type: 'verify_coverage', report: coverage(state)}).state;
  assert.throws(() => prove(state, 10), /pointer_unknown/);
});

test('cursor and config pointers reserve both old and new roots before their own write and readback', () => {
  const pointerId = 'intake_cursor:china', oldValue = {replica: root(1)}, newValue = {replica: root(10)};
  const pointers = emptyPointers();
  pointers.find(row => row.id === pointerId).current = rawPointerDescriptor(oldValue, [ref(1)], {complete: true});
  let state = createRawCoordination({registryId: token(1), current: generation(1), previous: generation(0), pointers});
  state = step(state, {type: 'verify_coverage', report: coverage(state)}).state;
  const pointer = state.pointers.find(row => row.id === pointerId);
  const reserved = step(state, {type: 'reserve_pointer', ...source(60), id: pointerId, pointerRevision: pointer.revision,
    base: pointer.current, candidate: rawPointerDescriptor(newValue, [ref(10)], {complete: true})});
  for (const n of [1, 10]) {
    const proven = prove(reserved.state, n);
    assert.throws(() => claimGc(proven.state, rawGcPlan([proven.group])), /root_protected/);
  }
  assert.throws(() => step(reserved.state, {type: 'commit_pointer', id: pointerId, ticket: reserved.result, observedValue: oldValue}), /not_committed/);
  const committed = step(reserved.state, {type: 'commit_pointer', id: pointerId, ticket: reserved.result, observedValue: newValue});
  assert.deepEqual(committed.state.pointers.find(row => row.id === pointerId).current.references, [ref(10)]);
  assert.throws(() => step(committed.state, {type: 'commit_pointer', id: pointerId, ticket: reserved.result, observedValue: newValue}), /ownership/);
});

test('pointer reservation cannot resurrect a deletion claim and cancellation cannot race its in-flight PUT', () => {
  const fixture = prepared(), claimed = claimGc(fixture.state, fixture.plan), id = 'che168_snapshot_config';
  const pointer = claimed.state.pointers.find(row => row.id === id), candidate = {binding: root(10)};
  assert.throws(() => step(claimed.state, {type: 'reserve_pointer', ...source(61), id, pointerRevision: pointer.revision,
    base: pointer.current, candidate: rawPointerDescriptor(candidate, [ref(10)], {complete: true})}), /deleting_or_deleted/);
  const state = initial(), original = state.pointers.find(row => row.id === id);
  const reserved = step(state, {type: 'reserve_pointer', ...source(61), id, pointerRevision: original.revision,
    base: original.current, candidate: rawPointerDescriptor(candidate, [ref(10)], {complete: true})});
  const abort = {type: 'abort_pointer', id, ticket: reserved.result, allWritesDrained: true,
    terminalWriterProofSha256: sha(11), observedValue: null};
  assert.throws(() => step(reserved.state, {...abort, allWritesDrained: false}), /not_drained/);
  assert.throws(() => step(reserved.state, {...abort, observedValue: candidate}), /already_changed/);
  const cancelled = step(reserved.state, abort);
  assert.equal(cancelled.state.pointers.find(row => row.id === id).pending, null);
  assert.throws(() => step(cancelled.state, {type: 'reserve_pointer', ...source(62), id, pointerRevision: original.revision,
    base: original.current, candidate: rawPointerDescriptor(candidate, [ref(10)], {complete: true})}), /pointer_changed/);
});

test('ABA does not release a new claim even if operation, owner and caller token are reused', () => {
  const first = step(initial(), {type: 'claim', ...source(9), references: [ref(10)]});
  const oldReady = seal(first.state, first.result), released = abandon(oldReady.state, oldReady.result);
  const second = step(released.state, {type: 'claim', ...source(9), references: [ref(10)]});
  const nextReady = seal(second.state, second.result);
  assert.notEqual(oldReady.result.grantRevision, nextReady.result.grantRevision);
  assert.throws(() => abandon(nextReady.state, oldReady.result), /ownership/);
  assert.equal(nextReady.state.claims.length, 1);
  const differentRegistry = structuredClone(nextReady.state); differentRegistry.registryId = token(88);
  assert.throws(() => abandon(differentRegistry, nextReady.result), /ownership/);
});

test('a writing claim cannot close, release its queue early, extend after ready, or write outside its roots', () => {
  const claim = step(initial(), {type: 'claim', ...source(1), references: [ref(10)]});
  assertRawWritePermit(claim.state, claim.result, root(10) + '/manifest.json');
  assert.throws(() => assertRawWritePermit(claim.state, claim.result, root(11) + '/manifest.json'), /outside_claim/);
  assert.throws(() => assertRawWritePermit(claim.state, claim.result, root(10) + '/../escape.json'), /outside_claim/);
  assert.throws(() => abandon(claim.state, claim.result), /not_ready/);
  assert.throws(() => step(claim.state, {type: 'seal', ticket: claim.result, allWritesDrained: false}), /not_drained/);
  const extended = step(claim.state, {type: 'extend', ticket: claim.result, references: [ref(11)]});
  assert.throws(() => seal(extended.state, claim.result), /ownership/);
  const ready = seal(extended.state, extended.result);
  assert.throws(() => assertRawWritePermit(ready.state, ready.result, root(10) + '/manifest.json'), /write_after_seal/);
  assert.throws(() => step(ready.state, {type: 'extend', ticket: ready.result, references: [ref(12)]}), /sealed/);
});

test('published release requires terminal pin proof and matching reference digest, keeping failed cleanup protected', () => {
  let state = createRawCoordination({registryId: token(1), current: generation(1, [{...ref(10), sha256: sha(1)}]), previous: generation(0)});
  const claim = step(state, {type: 'claim', ...source(7), references: [{...ref(10), sha256: sha(2)}]});
  const ready = seal(claim.state, claim.result);
  const command = {type: 'release', ticket: ready.result, outcome: 'published', generationId: manifest(1).generationId, terminalPinSha256: sha(3)};
  assert.throws(() => step(ready.state, command), /references_missing/);
  assert.equal(ready.state.claims[0].phase, 'ready');
  const good = step(state, {type: 'claim', ...source(8), references: [{...ref(10), sha256: sha(1)}]});
  const readyGood = seal(good.state, good.result);
  assert.throws(() => step(readyGood.state, {...command, ticket: readyGood.result, terminalPinSha256: undefined}), /terminal_pin_proof/);
  assert.equal(step(readyGood.state, {...command, ticket: readyGood.result}).state.claims.length, 0);
});

test('an old raw group remains unknown until reviewed inventory and terminal-writer proof are bound to its exact incarnation', () => {
  let state = initial(); state = step(state, {type: 'verify_coverage', report: coverage(state)}).state;
  state = step(state, {type: 'register', ...source(3), references: [ref(10)]}).state;
  const row = state.roots[0], plan = rawGcPlan([{...ref(10), incarnation: row.incarnation, revision: row.revision,
    receiptSha256: sha(510), objects: objects(10)}]);
  assert.throws(() => claimGc(state, plan), /root_unknown/);
  assert.throws(() => step(state, {type: 'prove_root', root: root(10), incarnation: row.incarnation + 1, rootRevision: row.revision,
    inventorySha256: plan.plan.groups[0].inventorySha256, receiptSha256: sha(510), writerProofSha256: sha(1)}), /root_changed/);
  assert.equal(claimGc(prove(state, 10).state, rawGcPlan([prove(state, 10).group])).state.gc.state, 'deleting');
});

test('partial delete result is durable, resumes only the same owner, and does not double-count replayed acknowledgements', () => {
  const fixture = prepared(), claimed = claimGc(fixture.state, fixture.plan);
  let batch = step(claimed.state, {type: 'begin_gc_batch', ticket: claimed.result, plan: fixture.plan.plan});
  assert.throws(() => step(batch.state, {type: 'begin_gc_batch', ticket: batch.result.ticket, plan: fixture.plan.plan}), /batch_active/);
  const partial = step(batch.state, {type: 'record_gc_batch', ticket: batch.result.ticket, attempt: batch.result.attempt,
    requestSettled: true, absent: [0], error: 'delete_failed'});
  assert.equal(partial.state.gc.inflight.phase, 'paused');
  assert.equal(partial.state.gc.acknowledgedObjects, 1); assert.equal(partial.state.gc.acknowledgedInventoryBytes, 10);
  assert.throws(() => step(partial.state, {type: 'begin_gc_batch', ticket: {...partial.result, token: token(9)}, plan: fixture.plan.plan}), /ownership/);
  const resumed = step(structuredClone(partial.state), {type: 'begin_gc_batch', ticket: partial.result, plan: fixture.plan.plan});
  assert.throws(() => step(resumed.state, {type: 'record_gc_batch', ticket: resumed.result.ticket, attempt: batch.result.attempt,
    requestSettled: true, absent: [0, 1, 2]}), /attempt_changed/);
  const complete = step(resumed.state, {type: 'record_gc_batch', ticket: resumed.result.ticket, attempt: resumed.result.attempt,
    requestSettled: true, absent: [0, 1, 2]});
  assert.equal(complete.state.gc.acknowledgedObjects, 3); assert.equal(complete.state.gc.acknowledgedInventoryBytes, 60);
  assert.equal(complete.state.gc.inflight, null); assert.equal(complete.state.roots[0].state, 'deleting');
  assert.throws(() => step(complete.state, {type: 'complete_gc', ticket: complete.result,
    emptyRoots: [{root: root(10), complete: true, count: 1, inventorySha256: sha(1)}]}), /not_empty/);
  const finished = step(complete.state, {type: 'complete_gc', ticket: complete.result,
    emptyRoots: [{root: root(10), complete: true, count: 0, inventorySha256: rawDigest([])}]});
  assert.equal(finished.state.roots[0].state, 'deleted');
  assert.equal(rawCoordinationCapacity(finished.state).tombstones, 1);
  assert.throws(() => step(finished.state, {type: 'claim', ...source(91), references: [ref(10)]}), /deleting_or_deleted/);
  assert.throws(() => claimGc(finished.state, fixture.plan), /root_changed/);
});

test('crash with an ambiguous active DELETE stays fenced until the same owner proves all requests settled', () => {
  const fixture = prepared(), claimed = claimGc(fixture.state, fixture.plan);
  const batch = step(claimed.state, {type: 'begin_gc_batch', ticket: claimed.result, plan: fixture.plan.plan});
  const command = {type: 'pause_gc_after_crash', ticket: batch.result.ticket, allRequestsDrained: true, terminalWriterProofSha256: sha(800)};
  assert.throws(() => step(batch.state, {...command, allRequestsDrained: false}), /not_settled/);
  assert.throws(() => step(batch.state, {...command, terminalWriterProofSha256: ''}), /terminal_writer/);
  const paused = step(batch.state, command);
  assert.equal(paused.state.gc.inflight.error, 'unknown_result');
  assert.equal(paused.state.roots[0].state, 'deleting');
  const changed = structuredClone(fixture.plan.plan); changed.groups[0].objects[0].size++;
  assert.throws(() => step(paused.state, {type: 'begin_gc_batch', ticket: paused.result, plan: changed}), /plan_changed/);
  assert.equal(step(paused.state, {type: 'begin_gc_batch', ticket: paused.result, plan: fixture.plan.plan}).state.gc.inflight.phase, 'active');
});

test('coverage invalidation stops further GC batches without releasing a deleting root or hiding completed requests', () => {
  const fixture = prepared(), claimed = claimGc(fixture.state, fixture.plan);
  const batch = step(claimed.state, {type: 'begin_gc_batch', ticket: claimed.result, plan: fixture.plan.plan});
  const invalid = step(batch.state, {type: 'invalidate_coverage', reason: 'uncoordinated_writer_detected'});
  const recorded = step(invalid.state, {type: 'record_gc_batch', ticket: batch.result.ticket, attempt: batch.result.attempt,
    requestSettled: true, absent: [0], error: 'cancelled'});
  assert.equal(recorded.state.gc.acknowledgedObjects, 1);
  assert.throws(() => step(recorded.state, {type: 'begin_gc_batch', ticket: recorded.result, plan: fixture.plan.plan}), /coverage_unknown/);
  const reverified = step(recorded.state, {type: 'verify_coverage', report: coverage(recorded.state)});
  assert.throws(() => step(reverified.state, {type: 'begin_gc_batch', ticket: recorded.result, plan: fixture.plan.plan}), /coverage_changed/);
  assert.equal(reverified.state.roots[0].state, 'deleting');
});

test('new coverage evidence invalidates a prior root inventory proof even if the old root revision did not move', () => {
  const fixture = prepared();
  const invalid = step(fixture.state, {type: 'invalidate_coverage', reason: 'uncoordinated_writer_detected'});
  const report = {...coverage(invalid.state), writerInventorySha256: sha(201), objectInventorySha256: sha(202)};
  const verified = step(invalid.state, {type: 'verify_coverage', report});
  assert.equal(verified.state.roots[0].revision, fixture.state.roots[0].revision);
  assert.throws(() => claimGc(verified.state, fixture.plan), /root_coverage_changed/);
  const fresh = prove(verified.state, 10);
  assert.equal(claimGc(fresh.state, rawGcPlan([fresh.group])).state.gc.state, 'deleting');
});

test('bounded batches preserve a durable cursor across more than one object-store request', () => {
  const fixture = prepared(10, 1001), claimed = claimGc(fixture.state, fixture.plan);
  assert.deepEqual(claimed.state.gc.batches.map(row => row.count), [1000, 1]);
  const first = step(claimed.state, {type: 'begin_gc_batch', ticket: claimed.result, plan: fixture.plan.plan});
  const acknowledged = step(first.state, {type: 'record_gc_batch', ticket: first.result.ticket, attempt: first.result.attempt,
    requestSettled: true, absent: Array.from({length: 1000}, (_, index) => index)});
  assert.equal(acknowledged.state.gc.nextBatch, 1);
  assert.throws(() => step(acknowledged.state, {type: 'complete_gc', ticket: acknowledged.result, emptyRoots: []}), /incomplete/);
  const second = step(acknowledged.state, {type: 'begin_gc_batch', ticket: acknowledged.result, plan: fixture.plan.plan});
  assert.equal(second.state.gc.inflight.objects.length, 1);
  const tampered = structuredClone(second.state); tampered.gc.acknowledgedObjects++;
  assert.throws(() => assertRawCoordination(tampered), /progress_mismatch/);
});

test('capacity and revision exhaustion fail closed instead of evicting claims or tombstones', () => {
  const state = initial(), tooMany = structuredClone(state);
  tooMany.roots = Array.from({length: RAW_COORDINATION_LIMITS.roots + 1}, (_, n) => ({...ref(n), incarnation: 1, revision: 1, state: 'live', proof: null}));
  assert.throws(() => assertRawCoordination(tooMany), /root_capacity/);
  const bytes = structuredClone(state); bytes.extra = 'x'.repeat(RAW_COORDINATION_LIMITS.bytes);
  assert.throws(() => assertRawCoordination(bytes), /byte_capacity/);
  assert.throws(() => transitionRawCoordination(state, {type: 'invalidate_coverage', expectedRevision: 0, reason: 'fixture'}), /stale_revision/);
  const exhausted = {...state, revision: Number.MAX_SAFE_INTEGER - 1};
  assert.throws(() => step(exhausted, {type: 'invalidate_coverage', reason: 'fixture'}), /revision/);
});

class MemoryStorage {
  driver = 'object'; revision = 1; value; writes = []; interfere = null;
  constructor(value) { this.value = structuredClone(value); }
  async readJsonWithMeta(key, fallback) {
    assert.equal(key, RAW_COORDINATION_KEY);
    return this.value === null ? {found: false, value: fallback} : {found: true, etag: String(this.revision), value: structuredClone(this.value)};
  }
  async writeJson(key, value, condition) {
    assert.equal(key, RAW_COORDINATION_KEY);
    if (this.interfere) { const fn = this.interfere; this.interfere = null; fn(this); }
    if (condition?.ifMatch !== String(this.revision)) { const error = Error('conflict'); error.name = 'StorageConflictError'; throw error; }
    this.value = structuredClone(value); this.revision++; this.writes.push({key, condition});
  }
  apply(command) { this.value = step(this.value, command).state; this.revision++; }
}

test('real CAS conflict: producer wins and stale GC intent is revalidated, never written over the new claim', async () => {
  const fixture = prepared(), storage = new MemoryStorage(fixture.state);
  storage.interfere = store => store.apply({type: 'claim', ...source(52), references: [ref(10)]});
  await assert.rejects(mutateRawCoordination({storage, command: {type: 'claim_gc', ...source(900),
    plan: fixture.plan.plan, planSha256: fixture.plan.sha256}}), /root_changed/);
  assert.equal(storage.value.gc, null); assert.equal(storage.value.claims.length, 1); assert.equal(storage.writes.length, 0);
});

test('real CAS conflict: refreshed coverage cannot silently relabel an old root proof with the new coverage hash', async () => {
  const fixture = prepared(), storage = new MemoryStorage(fixture.state), row = fixture.state.roots[0];
  const command = {type: 'prove_root', root: row.root, incarnation: row.incarnation, rootRevision: row.revision,
    inventorySha256: row.proof.inventorySha256, receiptSha256: row.proof.receiptSha256,
    writerProofSha256: row.proof.writerProofSha256, coverageProofSha256: fixture.state.coverage.proofSha256};
  storage.interfere = store => store.apply({type: 'verify_coverage', report: {...coverage(store.value), objectInventorySha256: sha(997)}});
  await assert.rejects(mutateRawCoordination({storage, command}), /root_proof_coverage_changed/);
  assert.equal(storage.writes.length, 0);
  const fresh = await mutateRawCoordination({storage, command: {...command,
    coverageProofSha256: storage.value.coverage.proofSha256, writerProofSha256: sha(998)}});
  assert.equal(fresh.result.proof.coverageProofSha256, storage.value.coverage.proofSha256);
});

test('real CAS conflict: GC wins and the producer cannot retry its stale write permission into a deleting root', async () => {
  const fixture = prepared(), storage = new MemoryStorage(fixture.state);
  storage.interfere = store => store.apply({type: 'claim_gc', ...source(900), plan: fixture.plan.plan, planSha256: fixture.plan.sha256});
  await assert.rejects(mutateRawCoordination({storage, command: {type: 'claim', ...source(52), references: [ref(10)]}}), /deleting_or_deleted/);
  assert.equal(storage.value.claims.length, 0); assert.equal(storage.value.gc.state, 'deleting'); assert.equal(storage.writes.length, 0);
});

test('unrelated concurrent claim is preserved when the complete logical intent is revalidated on CAS retry', async () => {
  const storage = new MemoryStorage(initial());
  storage.interfere = store => store.apply({type: 'claim', ...source(52), references: [ref(11)]});
  const output = await mutateRawCoordination({storage, command: {type: 'claim', ...source(53), references: [ref(12)]}});
  assert.equal(output.state.claims.length, 2); assert.equal(output.state.revision, 3);
  assert.equal(storage.writes.length, 1); assert.equal(storage.writes[0].condition.ifMatch, '2');
  assertRawWritePermit(storage.value, output.result, root(12) + '/manifest.json');
});

test('a missing registry never silently recreates lost ownership and storage errors are not treated as CAS conflicts', async () => {
  const command = {type: 'claim', ...source(52), references: [ref(10)]};
  await assert.rejects(mutateRawCoordination({storage: new MemoryStorage(null), command}), /registry_missing/);
  const storage = new MemoryStorage(initial());
  storage.writeJson = async () => { throw Error('network_result_unknown'); };
  await assert.rejects(mutateRawCoordination({storage, command}), /network_result_unknown/);
});
