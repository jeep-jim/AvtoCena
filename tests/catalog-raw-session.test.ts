import assert from 'node:assert/strict';
import test from 'node:test';
import {rawDigest, buildRawGenerationProvenance, rawGenerationKey, openRawFeedPin, intakeRawReferences} from '../scripts/lib/catalog-raw-provenance.mjs';
import {RAW_COORDINATION_KEY, createRawCoordination, rawCatalogDescriptor, rawPointerDescriptor, RAW_COORDINATED_POINTERS} from '../scripts/lib/catalog-raw-coordination.mjs';
import {RAW_COORDINATION_POLICY_KEY, readRawCoordinationPolicy, assertRawPublicationReservation,
  assertLegacyRawWriterDisabled} from '../apps/web/lib/catalog/raw-coordination-gate.mjs';
import {openRawProducerSession, reserveRawPublication, reconcileRawPublication, recordRawPublicationWritesSettled,
  commitRawPointer, withRawReadProtection} from '../scripts/lib/catalog-raw-session.mjs';
import {prepareRawPublication, finishRawPublication, rawPublicationSessionKey} from '../scripts/lib/catalog-raw-publication.mjs';
import {commitCoordinatedIntakeCursor} from '../scripts/lib/catalog-raw-cursor.mjs';
import {publishedIntakeCheckpoint} from '../scripts/lib/catalog-intake-checkpoint.mjs';
import {rawInternalPointerDescriptor, rawInternalProvenanceKey, RAW_INTERNAL_MANIFEST_KEY} from '../apps/web/lib/catalog/raw-internal-provenance.mjs';
import {prepareRawInternalPublication, reconcileRawInternalPublication} from '../scripts/lib/catalog-raw-internal-publication.mjs';
import {commitChe168RawConfig, CHE168_RAW_CONFIG_KEY} from '../scripts/lib/che168-raw-config.mjs';
import {activateVerifiedGeneration} from '../scripts/lib/catalog-activate-verified-generation.mjs';

const owner = {runId: '43870000000', attempt: '1', revision: 'a'.repeat(40)};
const root = 'catalog/nonjp-intake/v1/uae/43870000000/1';
const ref = {kind: 'nonjp-intake', root};
const registryId = 'f'.repeat(32);
const manifest = n => ({version: 2, generationId: `gen_${1000 + n}_abcdef`, markets: {}});
const provenance = value => buildRawGenerationProvenance({manifest: value, paidReports: {
  generationId: value.generationId, manifestSha256: rawDigest(value), market: 'korea', count: 0,
  paidCount: 0, chunkProofs: [], observations: [], references: []}});
const deferred = () => {let resolve; const promise = new Promise<void>(done => {resolve = done;}); return {promise, resolve};};

class MemoryStorage {
  driver = 'object'; values = new Map(); versions = new Map(); writes = []; beforeWrite = null;
  seed(key, value) {this.values.set(key, structuredClone(value)); this.versions.set(key, (this.versions.get(key) || 0) + 1);}
  async readJson(key, fallback) {return this.values.has(key) ? structuredClone(this.values.get(key)) : fallback;}
  async readJsonWithMeta(key, fallback) {return {found: this.values.has(key), value: await this.readJson(key, fallback),
    etag: this.values.has(key) ? String(this.versions.get(key)) : null};}
  async writeJson(key, value, condition = {}) {
    await this.beforeWrite?.(key, value);
    if ((condition.ifNoneMatch === '*' && this.values.has(key)) || (condition.ifMatch && condition.ifMatch !== String(this.versions.get(key)))) {
      const error = new Error('conflict'); error.name = 'StorageConflictError'; throw error;
    }
    this.seed(key, value); this.writes.push({key, value: structuredClone(value)});
  }
  async putBinary(key, value) {return this.writeJson(key, [...value]);}
}

function fixture() {
  const storage = new MemoryStorage(), current = manifest(1), previous = manifest(0);
  for (const value of [current, previous]) storage.seed(rawGenerationKey(value.generationId), provenance(value));
  storage.seed('catalog/manifest.json', current); storage.seed('catalog/previous-manifest.json', previous);
  storage.seed(RAW_COORDINATION_KEY, createRawCoordination({registryId,
    current: rawCatalogDescriptor(current, provenance(current)), previous: rawCatalogDescriptor(previous, provenance(previous)),
    pointers: RAW_COORDINATED_POINTERS.map(id => ({id, current: id === 'internal_catalog'
      ? rawInternalPointerDescriptor(null) : rawPointerDescriptor(null, [], {complete: true})}))}));
  storage.seed(RAW_COORDINATION_POLICY_KEY, {version: 1, mode: 'required', protocolVersion: 1, registryId});
  return {storage, current, previous};
}

test('coordination stays disabled without policy or registry; partial removal and hard-required mode fail closed', async () => {
  const storage = new MemoryStorage();
  assert.equal(await readRawCoordinationPolicy(storage), null);
  const session = await openRawProducerSession({storage, owner, operationId: 'disabled', references: [ref]});
  assert.equal(session.storage, storage); assert.equal(session.required, false);
  assert.equal(storage.writes.length, 0);
  await assert.rejects(readRawCoordinationPolicy(storage, {required: true}), /policy_missing/);
  const live = fixture().storage;
  await assert.rejects(assertLegacyRawWriterDisabled(live), /legacy_writer_blocked/);
  live.values.delete(RAW_COORDINATION_POLICY_KEY);
  await assert.rejects(readRawCoordinationPolicy(live), /policy_missing/);
});

test('disabled producer sessions do not read policy or registry for any raw page PUT', async () => {
  const storage = new MemoryStorage(), reads = [], originalRead = storage.readJson.bind(storage);
  storage.readJson = async (key, fallback) => {reads.push(key); return originalRead(key, fallback);};
  const session = await openRawProducerSession({storage, owner, operationId: 'disabled-pages', references: [ref]});
  assert.equal(session.storage, storage);
  for (let index = 0; index < 100; index++) await session.storage.writeJson(root + '/page-' + index + '.json', {page: index});
  await session.extend([ref]); await session.seal();
  assert.deepEqual(reads, [RAW_COORDINATION_POLICY_KEY, RAW_COORDINATION_KEY]);
  assert.equal(storage.writes.length, 100);
});

const internalManifest = () => ({generationId: 'gen_2000_internal', sources: {dubicars_uae_open: {count: 1,
  chunks: ['catalog/internal/offers/dubicars_uae_open/gen_2000_internal-chunk-0001.json']}}});
async function prepareInternalFixture() {
  const {storage} = fixture(), manifest = internalManifest();
  const pin = await openRawFeedPin({storage, owner, operationId: 'internal-input', references: [ref]});
  const handoff = await pin.handoff();
  const intake = {completed: true, market: 'uae', completedAt: '2026-11-16T12:00:00Z',
    sources: [{sourceId: 'dubicars_uae_open', provider: 'legacy'}], rawStoragePins: [handoff]};
  const args = {storage, owner, operationId: 'internal-publication', manifest, baseManifest: null, intake};
  const prepared = await prepareRawInternalPublication(args);
  return {storage, manifest, prepared, args};
}

test('internal publication settles the actual manifest before releasing its pointer pending state, keeping unknown row lineage and producer protection', async () => {
  const {storage, manifest, prepared} = await prepareInternalFixture();
  await prepared.verifyBeforeCommit();
  let state = storage.values.get(RAW_COORDINATION_KEY), pointer = state.pointers.find(row => row.id === 'internal_catalog');
  assert.equal(pointer.pending.token, prepared.ticket.token);
  assert.deepEqual(pointer.pending.candidate.references, [ref]);
  await storage.writeJson(RAW_INTERNAL_MANIFEST_KEY, manifest, {ifNoneMatch: '*'});
  await prepared.afterCommit();
  state = storage.values.get(RAW_COORDINATION_KEY); pointer = state.pointers.find(row => row.id === 'internal_catalog');
  assert.equal(pointer.pending, null); assert.equal(pointer.lastCommit.token, prepared.ticket.token);
  assert.equal(pointer.current.complete, false);
  assert.equal(pointer.current.provenanceSha256, rawDigest(storage.values.get(rawInternalProvenanceKey(manifest.generationId))));
  assert.equal(state.claims.length, 1, 'source pin is still ready until public manifest and cursor handoff');
  await reconcileRawInternalPublication({storage, binding: prepared.binding, manifest});
});

test('observing a written internal manifest after a lost PUT response does not invent a drained-writer receipt or adopt its grant', async () => {
  const {storage, manifest, prepared, args} = await prepareInternalFixture();
  await prepared.verifyBeforeCommit();
  storage.seed(RAW_INTERNAL_MANIFEST_KEY, manifest);
  await assert.rejects(reconcileRawInternalPublication({storage, binding: prepared.binding, manifest}), /writer_not_settled/);
  await assert.rejects(prepareRawInternalPublication(args), /prior_writer_pending/);
  const pointer = storage.values.get(RAW_COORDINATION_KEY).pointers.find(row => row.id === 'internal_catalog');
  assert.equal(pointer.pending.token, prepared.ticket.token);
  assert.deepEqual(pointer.pending.candidate.references, [ref]);
});

test('an internal commit crash after the immutable settled receipt recovers only the same ticket', async () => {
  const {storage, manifest, prepared} = await prepareInternalFixture();
  await storage.writeJson(RAW_INTERNAL_MANIFEST_KEY, manifest, {ifNoneMatch: '*'});
  storage.beforeWrite = async (key, value) => {
    if (key === RAW_COORDINATION_KEY && value.pointers.find(row => row.id === 'internal_catalog').pending === null) throw Error('commit_unavailable');
  };
  await assert.rejects(prepared.afterCommit(), /commit_unavailable/);
  assert.ok(storage.values.has('catalog/raw-feed-coordination/v1/pointer-receipts/' + prepared.ticket.token + '.json'));
  storage.beforeWrite = null;
  await assert.rejects(reconcileRawInternalPublication({storage, manifest, binding: {...prepared.binding,
    ticket: {...prepared.ticket, token: 'c'.repeat(32)}}}), /writer_not_settled/);
  await reconcileRawInternalPublication({storage, binding: prepared.binding, manifest});
  const pointer = storage.values.get(RAW_COORDINATION_KEY).pointers.find(row => row.id === 'internal_catalog');
  assert.equal(pointer.pending, null); assert.equal(pointer.lastCommit.token, prepared.ticket.token);
});

test('internal base drift and premature afterCommit both preserve the pending input roots', async () => {
  const {storage, manifest, prepared} = await prepareInternalFixture();
  await assert.rejects(prepared.afterCommit(), /readback_changed/);
  storage.seed(RAW_INTERNAL_MANIFEST_KEY, {...manifest, generationId: 'gen_2001_other'});
  await assert.rejects(prepared.verifyBeforeCommit(), /base_changed/);
  assert.equal(storage.values.get(RAW_COORDINATION_KEY).pointers.find(row => row.id === 'internal_catalog').pending.token, prepared.ticket.token);
});

test('seal waits for an unawaited PUT and denies new PUTs before waiting', async () => {
  const {storage} = fixture(), entered = deferred(), allow = deferred();
  storage.beforeWrite = async key => {if (key === root + '/part.json') {entered.resolve(); await allow.promise;}};
  const session = await openRawProducerSession({storage, owner, operationId: 'producer', references: [ref]});
  const put = session.storage.writeJson(root + '/part.json', {saved: true});
  await entered.promise;
  let sealed = false;
  const closing = session.seal().then(value => {sealed = true; return value;});
  assert.throws(() => session.storage.writeJson(root + '/late.json', {}), /session_closed/);
  await Promise.resolve();
  assert.equal(sealed, false);
  assert.equal(storage.values.get(RAW_COORDINATION_KEY).claims[0].phase, 'writing');
  allow.resolve(); await put;
  const binding = await closing;
  assert.equal(storage.values.get(RAW_COORDINATION_KEY).claims[0].phase, 'ready');
  assert.equal(binding.ticket.token, session.binding().ticket.token);
});

test('failed or out-of-root writes never create a ready claim and no delete capability is exposed', async () => {
  const {storage} = fixture();
  const session = await openRawProducerSession({storage, owner, operationId: 'bad-writer', references: [ref]});
  await assert.rejects(session.storage.writeJson('catalog/nonjp-intake/v1/japan/1/1/part.json', {}), /outside_claim/);
  assert.throws(() => session.storage.deleteObject(root + '/part.json'), /delete_forbidden/);
  await assert.rejects(session.seal(), /io_failed/);
  assert.equal(storage.values.get(RAW_COORDINATION_KEY).claims[0].phase, 'writing');
});

test('a second process cannot resume a writing claim; ready recovery requires the exact token and refs', async () => {
  const {storage} = fixture();
  const input = {storage, owner, operationId: 'producer', references: [ref]};
  const session = await openRawProducerSession(input), writing = session.binding();
  await assert.rejects(openRawProducerSession({...input, binding: writing, existingPin: true}), /ready_recovery_changed/);
  await session.seal();
  const recovered = await openRawProducerSession({...input, binding: writing, existingPin: true});
  assert.equal((await recovered.seal()).ticket.token, writing.ticket.token);
  assert.throws(() => recovered.storage.writeJson(root + '/late.json', {}), /session_closed/);
  await assert.rejects(openRawProducerSession({...input, binding: {...writing,
    ticket: {...writing.ticket, token: 'e'.repeat(32)}}, existingPin: true}), /ready_recovery_changed/);
});

test('pin handoff drains real storage and persists the exact ready coordinator grant', async () => {
  const {storage} = fixture(), entered = deferred(), allow = deferred();
  const pin = await openRawFeedPin({storage, owner, operationId: 'pin-producer', references: [ref]});
  storage.beforeWrite = async key => {if (key === root + '/part.json') {entered.resolve(); await allow.promise;}};
  const put = pin.storage.writeJson(root + '/part.json', {}); await entered.promise;
  const handoff = pin.handoff();
  await assert.rejects(pin.add([]), /already_terminal/);
  allow.resolve(); await put;
  const value = await handoff, saved = storage.values.get(pin.key);
  assert.equal(saved.state, 'ready'); assert.deepEqual(saved.coordination, value.coordination);
  const claim = storage.values.get(RAW_COORDINATION_KEY).claims[0];
  assert.equal(claim.phase, 'ready'); assert.equal(claim.revision, value.coordination.ticket.revision);
});

test('crash after coordinator seal but before pin ready leaves protection and supports exact read-only recovery', async () => {
  const {storage} = fixture();
  const input = {storage, owner, operationId: 'pin-crash', references: [ref]};
  const pin = await openRawFeedPin(input);
  storage.beforeWrite = async (key, value) => {if (key === pin.key && value.state === 'ready') throw Error('simulated_pin_failure');};
  await assert.rejects(pin.handoff(), /simulated_pin_failure/);
  assert.equal(storage.values.get(RAW_COORDINATION_KEY).claims[0].phase, 'ready');
  assert.equal(storage.values.get(pin.key).state, 'loading');
  storage.beforeWrite = null;
  const recovered = await openRawFeedPin(input), handoff = await recovered.handoff();
  assert.equal(handoff.coordination.ticket.revision, storage.values.get(RAW_COORDINATION_KEY).claims[0].revision);
  assert.equal(storage.values.get(pin.key).state, 'ready');
});

test('runtime refuses arbitrary prepared callbacks without exact pending manifest and provenance', async () => {
  const {storage, current, previous} = fixture(), next = manifest(2);
  storage.seed(rawGenerationKey(next.generationId), provenance(next));
  const policy = await readRawCoordinationPolicy(storage);
  await assert.rejects(assertRawPublicationReservation({storage, policy, manifest: next, expectedBaseGenerationId: current.generationId}), /ticket_invalid/);
  const binding = await reserveRawPublication({storage, baseline: current, previous, manifest: next, owner, operationId: 'publish'});
  const args = {storage, policy, ticket: binding.ticket, manifest: next, expectedBaseGenerationId: current.generationId};
  await assertRawPublicationReservation(args);
  await assert.rejects(assertRawPublicationReservation({...args, manifest: {...next, updatedAt: 'changed'}}), /binding_changed/);
  storage.seed(rawGenerationKey(next.generationId), {...provenance(next), updatedAt: 'changed'});
  await assert.rejects(assertRawPublicationReservation(args), /provenance_changed/);
});

test('manifest readback reconciles pending publication after a crash and never expires it by age', async () => {
  const {storage, current, previous} = fixture(), next = manifest(2);
  storage.seed(rawGenerationKey(next.generationId), provenance(next));
  const binding = await reserveRawPublication({storage, baseline: current, previous, manifest: next, owner, operationId: 'publish'});
  await assert.rejects(reconcileRawPublication({storage, binding, manifest: next}), /readback_changed/);
  assert.ok(storage.values.get(RAW_COORDINATION_KEY).catalog.pending);
  storage.seed('catalog/previous-manifest.json', current); storage.seed('catalog/manifest.json', next);
  await assert.rejects(reconcileRawPublication({storage, binding, manifest: next}), /writer_not_settled/);
  await recordRawPublicationWritesSettled({storage, binding, manifest: next});
  assert.equal((await reconcileRawPublication({storage, binding, manifest: next})).status, 'committed');
  assert.equal((await reconcileRawPublication({storage, binding, manifest: next})).status, 'committed');
  assert.equal(storage.values.get(RAW_COORDINATION_KEY).catalog.pending, null);
});

test('cursor crash after PUT preserves pending refs and recovers the same reservation without another PUT', async () => {
  const {storage} = fixture(), key = 'catalog/intake-cursors/v1/uae.json', value = {version: 1, market: 'uae'};
  const args = {storage, id: 'intake_cursor:uae', key, value, references: [ref], complete: true, owner, operationId: 'cursor'};
  let fail = true;
  storage.beforeWrite = async (key, value) => {
    if (fail && key === RAW_COORDINATION_KEY && value.pointers.find(row => row.id === args.id).current.sha256 === rawDigest(args.value)) throw Error('crash_after_pointer_put');
  };
  await assert.rejects(commitRawPointer(args), /crash_after_pointer_put/);
  const pending = storage.values.get(RAW_COORDINATION_KEY).pointers.find(row => row.id === args.id).pending;
  assert.ok(pending); assert.equal(storage.writes.filter(row => row.key === key).length, 1);
  fail = false;
  await commitRawPointer(args);
  assert.equal(storage.writes.filter(row => row.key === key).length, 1);
  assert.equal(storage.values.get(RAW_COORDINATION_KEY).pointers.find(row => row.id === args.id).pending, null);
});

test('read-only verification holds a claim through an unawaited object read and releases only after drain', async () => {
  const {storage} = fixture(), entered = deferred(), allow = deferred();
  const originalRead = storage.readJson.bind(storage);
  storage.readJson = async (key, fallback) => {
    if (key === root + '/part.json') {entered.resolve(); await allow.promise;}
    return originalRead(key, fallback);
  };
  const reading = withRawReadProtection({storage, owner, references: [ref], read: scoped => {
    assert.throws(() => scoped.writeJson(root + '/bad.json', {}), /read_session_write_forbidden/);
    scoped.readJson(root + '/part.json', null);
    return 'read-result';
  }});
  await entered.promise;
  assert.equal(storage.values.get(RAW_COORDINATION_KEY).claims.length, 1);
  allow.resolve(); assert.equal(await reading, 'read-result');
  assert.equal(storage.values.get(RAW_COORDINATION_KEY).claims.length, 0);
  const pin = storage.writes.find(row => row.key.startsWith('catalog/raw-feed-pins/') && row.value.state === 'abandoned').value;
  assert.equal(pin.reason, 'read_complete'); assert.equal(pin.mode, 'read_only');
});

test('read-only failure may close its drained reader but a failed PUT remains protected', async () => {
  const {storage} = fixture();
  await assert.rejects(withRawReadProtection({storage, owner, references: [ref], read: async scoped => {
    await scoped.readJson(root + '/missing.json', null); throw Error('invalid_receipt');
  }}), /invalid_receipt/);
  assert.equal(storage.values.get(RAW_COORDINATION_KEY).claims.length, 0);
});

const config = {version: 1, host: 'https://autobase-barrett.auto-api.com', date: '2026-11-01', filename: 'active_offer.csv',
  delimiter: '|', initialCursor: 100, bytes: 1024, etag: '"fixture"', modifiedAt: '2026-11-01T00:00:00Z'};
function chinaIntake() {
  const binding = rawDigest(config), replica = 'catalog/provider-replicas/che168/00000000-0000-4000-8000-000000000001';
  return {market: 'china', completed: true, completedAt: '2026-11-16T12:00:00Z', sources: [{sourceId: 'autohome_new_china_open',
    provider: 'auto_api_che168', completeInventory: true, snapshotBinding: binding, cursor: 100, stopReason: 'source_finished',
    replica: {key: replica, sha256: 'b'.repeat(64), binding, cursor: 100},
    workingJournal: {key: 'catalog/intake-working/che168-v1/100', binding: 'c'.repeat(64)}}]};
}

async function preparedPublication() {
  const {storage, current, previous} = fixture(), intake = chinaIntake();
  const pin = await openRawFeedPin({storage, owner, operationId: 'intake-producer', references: intakeRawReferences(intake).references});
  intake.rawStoragePins = [await pin.handoff()];
  const next = {...manifest(2), markets: {china: {count: 1, chunks: ['chunk-00001']}}};
  const staged = await prepareRawPublication({storage, manifest: next, expectedBaseGenerationId: current.generationId,
    market: 'china', intake, owner, operationId: 'publication'});
  await staged.verify();
  const publication = {published: true, generationId: next.generationId, market: 'china', rawCoordination: staged.binding};
  return {storage, current, previous, next, intake, pin, staged, publication};
}

test('actual publisher keeps pins until both manifest and cursor coordination are committed', async () => {
  const {storage, current, next, intake, pin, staged, publication} = await preparedPublication();
  assert.ok(storage.values.has(rawPublicationSessionKey(next.generationId)), 'durable recovery receipt exists before cutover');
  storage.seed('catalog/previous-manifest.json', current); storage.seed('catalog/manifest.json', next);
  assert.equal((await staged.afterCommit()).status, 'awaiting_cursor');
  assert.equal(storage.values.get(pin.key).state, 'ready');
  assert.equal(storage.values.get(RAW_COORDINATION_KEY).claims.length, 1);
  await assert.rejects(finishRawPublication({storage, manifest: next, binding: staged.binding}), /waiting_for_cursor/);
  const checkpoint = publishedIntakeCheckpoint(intake, publication);
  const result = await commitCoordinatedIntakeCursor({storage, intake, publication, checkpoint, owner});
  assert.equal(result.cursorCommitted, true); assert.equal(result.rawPinRelease.status, 'pins_released');
  assert.equal(storage.values.get(pin.key).state, 'published');
  assert.equal(storage.values.get(RAW_COORDINATION_KEY).claims.length, 0);
  const pointer = storage.values.get(RAW_COORDINATION_KEY).pointers.find(row => row.id === 'intake_cursor:china');
  assert.equal(pointer.current.sha256, rawDigest(checkpoint)); assert.equal(pointer.pending, null);
});

test('post-manifest coordinator failure leaves a durable pending receipt, then cursor step reconciles it', async () => {
  const {storage, current, next, intake, pin, staged, publication} = await preparedPublication();
  storage.seed('catalog/previous-manifest.json', current); storage.seed('catalog/manifest.json', next);
  storage.beforeWrite = async (key, value) => {
    if (key === RAW_COORDINATION_KEY && value.catalog.pending === null) throw Error('coordinator_unavailable');
  };
  assert.equal((await staged.afterCommit()).status, 'cleanup_pending');
  assert.equal(storage.values.get(pin.key).state, 'ready');
  assert.ok(storage.values.get(RAW_COORDINATION_KEY).catalog.pending);
  assert.equal(storage.values.get('catalog/manifest.json').generationId, next.generationId);
  const cleanupKey = rawPublicationSessionKey(next.generationId).replace('/session.json', '/cleanup.json');
  assert.equal(storage.values.get(cleanupKey).status, 'cleanup_pending');
  storage.beforeWrite = null;
  const result = await commitCoordinatedIntakeCursor({storage, intake, publication,
    checkpoint: publishedIntakeCheckpoint(intake, publication), owner});
  assert.equal(result.rawPinRelease.status, 'pins_released');
  assert.equal(storage.values.get(cleanupKey).status, 'pins_released');
});

test('a pin CAS error after publication and cursor retains the ready claim and is explicitly cleanup_pending', async () => {
  const {storage, current, next, intake, pin, staged, publication} = await preparedPublication();
  storage.seed('catalog/previous-manifest.json', current); storage.seed('catalog/manifest.json', next);
  await staged.afterCommit();
  storage.beforeWrite = async (key, value) => {if (key === pin.key && value.state === 'published') throw Error('pin_unavailable');};
  const result = await commitCoordinatedIntakeCursor({storage, intake, publication,
    checkpoint: publishedIntakeCheckpoint(intake, publication), owner});
  assert.equal(result.cursorCommitted, true); assert.equal(result.rawPinRelease.status, 'cleanup_pending');
  assert.equal(storage.values.get(pin.key).state, 'ready');
  assert.equal(storage.values.get(RAW_COORDINATION_KEY).claims.length, 1);
  storage.beforeWrite = null;
  const recovered = await finishRawPublication({storage, manifest: next, binding: staged.binding, cursorCommitted: true});
  assert.equal(recovered.status, 'pins_released');
});

test('repo CSV config gets a coordinated pointer only with required policy and exact file binding', async () => {
  const disabled = new MemoryStorage();
  assert.equal((await commitChe168RawConfig({storage: disabled, config, owner})).status, 'disabled');
  assert.equal(disabled.writes.length, 0);
  const {storage} = fixture();
  await commitChe168RawConfig({storage, config, owner});
  const saved = storage.values.get(CHE168_RAW_CONFIG_KEY), state = storage.values.get(RAW_COORDINATION_KEY);
  assert.equal(saved.binding, rawDigest(config));
  const pointer = state.pointers.find(row => row.id === 'che168_snapshot_config');
  assert.equal(pointer.current.sha256, rawDigest(saved));
  assert.deepEqual(pointer.current.references, [{kind: 'che168-snapshot', root: 'catalog/provider-snapshots/che168/' + saved.binding}]);
});

test('legacy direct activation fails before acquiring a writer lock in required mode', async () => {
  const {storage} = fixture();
  await assert.rejects(activateVerifiedGeneration(storage, {}, {}), /legacy_writer_blocked/);
  assert.equal(storage.writes.length, 0);
});

test('no restore, producer claim or PUT can revive a permanently deleted raw root', async () => {
  const {storage} = fixture(), state = storage.values.get(RAW_COORDINATION_KEY);
  state.roots.push({...ref, incarnation: 1, revision: 1, state: 'deleted', proof: null,
    deletion: {operationId: 'gc', token: 'e'.repeat(32), planSha256: 'd'.repeat(64)}});
  storage.seed(RAW_COORDINATION_KEY, state);
  let read = false;
  await assert.rejects(withRawReadProtection({storage, owner, references: [ref], read: async () => {read = true;}}), /deleting_or_deleted/);
  assert.equal(read, false);
  await assert.rejects(openRawProducerSession({storage, owner, operationId: 'too-late', references: [ref]}), /deleting_or_deleted/);
  assert.equal(storage.writes.length, 0);
});

test('changing the policy denies new real writes while the old claim remains protected', async () => {
  const {storage} = fixture();
  const session = await openRawProducerSession({storage, owner, operationId: 'policy-fence', references: [ref]});
  storage.seed(RAW_COORDINATION_POLICY_KEY, {version: 1, mode: 'required', protocolVersion: 1, registryId, changed: true});
  await assert.rejects(session.storage.writeJson(root + '/part.json', {}), /policy_changed/);
  assert.ok(!storage.values.has(root + '/part.json'));
  assert.equal(storage.values.get(RAW_COORDINATION_KEY).claims.length, 1);
});

test('a cursor observed after PUT cannot recover without its exact settled writer receipt', async () => {
  const {storage} = fixture(), key = 'catalog/intake-cursors/v1/uae.json';
  const args = {storage, id: 'intake_cursor:uae', key, value: {market: 'uae'}, references: [ref], complete: true, owner, operationId: 'pointer-crash'};
  storage.beforeWrite = async path => {if (path.includes('/pointer-receipts/')) throw Error('crash_before_settled_receipt');};
  await assert.rejects(commitRawPointer(args), /crash_before_settled_receipt/);
  assert.deepEqual(storage.values.get(key), args.value);
  storage.beforeWrite = null;
  await assert.rejects(commitRawPointer(args), /writer_not_settled/);
  assert.ok(storage.values.get(RAW_COORDINATION_KEY).pointers.find(row => row.id === args.id).pending);
});

test('known PUT failure is fully settled but retains writing claim and prevents handoff', async () => {
  const {storage} = fixture();
  const pin = await openRawFeedPin({storage, owner, operationId: 'failed-put', references: [ref]});
  storage.beforeWrite = async key => {if (key === root + '/part.json') throw Error('put_network_unknown');};
  await assert.rejects(pin.storage.writeJson(root + '/part.json', {}), /put_network_unknown/);
  await assert.rejects(pin.handoff(), /io_failed/);
  assert.equal(storage.values.get(pin.key).state, 'loading');
  assert.equal(storage.values.get(RAW_COORDINATION_KEY).claims[0].phase, 'writing');
});
