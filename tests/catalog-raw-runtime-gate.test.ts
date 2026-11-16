import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {getJsonStorage, resetJsonStorageForTests} from '../apps/web/lib/data';
import {persistCatalogOffers, persistInternalCatalog, isCatalogProductionRefreshAllowed} from '../apps/web/lib/catalog/storage';
import {RAW_COORDINATION_POLICY_KEY,readRawCoordinationPolicy,assertRawPublicationReservation,
  assertRawInternalReservation} from '../apps/web/lib/catalog/raw-coordination-gate.mjs';
import {buildRawInternalProvenance, rawInternalPointerDescriptor, rawInternalProvenanceKey,
  RAW_INTERNAL_MANIFEST_KEY} from '../apps/web/lib/catalog/raw-internal-provenance.mjs';

test('the actual runtime persist entry point blocks legacy writers before catalogue reads or writes when coordination is required', async () => {
  const oldDriver = process.env.JSON_STORAGE_DRIVER, oldInventory = process.env.CATALOG_SELLER_INVENTORY;
  process.env.JSON_STORAGE_DRIVER = 'object'; process.env.CATALOG_SELLER_INVENTORY = '1';
  resetJsonStorageForTests();
  const storage = getJsonStorage(), registryId = 'f'.repeat(32), reads = [], writes = [];
  storage.readJson = async (key, fallback) => {
    reads.push(key);
    if (key === RAW_COORDINATION_POLICY_KEY) return {version: 1, mode: 'required', protocolVersion: 1, registryId} as any;
    if (key === 'catalog/raw-feed-coordination/v1/state.json') return {version: 1, scope: 'nonjp_raw_lifecycle_v1', registryId} as any;
    throw Error('unexpected_catalogue_or_source_read:' + key);
  };
  storage.writeJson = async key => {writes.push(key); throw Error('unexpected_write');};
  const allowed = {productionRefreshMarket: 'uae' as const,
    preservePublicOffersByMarket: {china: [], korea: [], japan: [], europe: [], georgia: []},
    beforePersistValidate: async () => {}, beforePublishValidate: async () => {}};
  try {
    assert.equal(isCatalogProductionRefreshAllowed(allowed), true, 'the existing freeze gate admits this ordinary refresh');
    await assert.rejects(persistCatalogOffers([], allowed), /raw_coord_publication_reservation_required/);
    await assert.rejects(persistCatalogOffers([], {...allowed, rawCoordinationTicket: () => null}), /raw_coord_publication_reservation_required/);
    await assert.rejects(persistCatalogOffers([], {...allowed, rawCoordinationTicket: () => null,
      beforePreparedGeneration: async () => async () => {}}), /raw_coord_internal_reservation_required/);
    assert.ok(reads.every(key => key === RAW_COORDINATION_POLICY_KEY || key === 'catalog/raw-feed-coordination/v1/state.json'));
    assert.deepEqual(writes, []);
  } finally {
    if (oldDriver === undefined) delete process.env.JSON_STORAGE_DRIVER; else process.env.JSON_STORAGE_DRIVER = oldDriver;
    if (oldInventory === undefined) delete process.env.CATALOG_SELLER_INVENTORY; else process.env.CATALOG_SELLER_INVENTORY = oldInventory;
    resetJsonStorageForTests();
  }
});

async function actualInternalRuntime(run) {
  const oldDriver = process.env.JSON_STORAGE_DRIVER;
  process.env.JSON_STORAGE_DRIVER = 'object'; resetJsonStorageForTests();
  const f = pendingFixture(), storage = getJsonStorage(), writes = [];
  const baseManifest = {generationId: 'gen_1000_internalbase', sources: {}};
  f.values.set(RAW_INTERNAL_MANIFEST_KEY, baseManifest);
  f.state.pointers = [{id: 'internal_catalog', current: rawInternalPointerDescriptor(baseManifest), pending: null}];
  storage.readJson = async (key, fallback) => structuredClone(f.values.get(key) ?? fallback);
  storage.readJsonWithMeta = async (key, fallback) => ({found: f.values.has(key), etag: f.values.has(key) ? 'original' : null,
    value: await storage.readJson(key, fallback)});
  storage.writeJson = async (key, value) => {writes.push(key); f.values.set(key, structuredClone(value));};
  try {await run({...f, storage, writes, baseManifest});}
  finally {
    if (oldDriver === undefined) delete process.env.JSON_STORAGE_DRIVER; else process.env.JSON_STORAGE_DRIVER = oldDriver;
    resetJsonStorageForTests();
  }
}

test('the exported actual internal writer rejects a missing hook before writes and a fake callback before its manifest CAS', async () => {
  await actualInternalRuntime(async f => {
    await assert.rejects(persistInternalCatalog(f.storage, 'gen_2000_internal', []), /internal_reservation_required/);
    let called = false;
    await assert.rejects(persistInternalCatalog(f.storage, 'gen_2000_internal', [], undefined, new Set(), {
      beforePreparedInternalManifest: async () => {called = true; return {ticket: f.ticket,
        verifyBeforeCommit: async () => {}, afterCommit: async () => {}};},
    }), /internal_reservation_missing/);
    assert.equal(called, true); assert.deepEqual(f.writes, []);
    assert.deepEqual(f.values.get(RAW_INTERNAL_MANIFEST_KEY), f.baseManifest);
  });
});

test('an interrupted actual internal CAS never calls the settled hook and leaves the exact pending reservation', async () => {
  await actualInternalRuntime(async f => {
    let afterCommitCalled = false;
    f.storage.writeJson = async (key, value) => {
      f.values.set(key, structuredClone(value)); f.writes.push(key);
      if (key === RAW_INTERNAL_MANIFEST_KEY) throw Error('put_response_lost');
    };
    await assert.rejects(persistInternalCatalog(f.storage, 'gen_2000_internal', [], undefined, new Set(), {
      beforePreparedInternalManifest: async ({manifest, baseManifest}) => {
        const proof = buildRawInternalProvenance({manifest});
        f.values.set(rawInternalProvenanceKey(manifest.generationId), proof);
        f.state.pointers[0].pending = {...f.ticket, base: rawInternalPointerDescriptor(baseManifest),
          candidate: rawInternalPointerDescriptor(manifest, proof)};
        return {ticket: f.ticket, verifyBeforeCommit: async () => {}, afterCommit: async () => {afterCommitCalled = true;}};
      },
    }), /put_response_lost/);
    assert.equal(afterCommitCalled, false);
    assert.deepEqual(f.writes, [RAW_INTERNAL_MANIFEST_KEY]);
    assert.equal(f.state.pointers[0].pending.token, f.ticket.token);
    assert.equal(f.values.get(RAW_INTERNAL_MANIFEST_KEY).generationId, 'gen_2000_internal');
    assert.equal([...f.values.keys()].some(key => key.includes('/pointer-receipts/')), false);
  });
});

test('internal runtime gate binds the immutable proof, actual base, candidate, owner and live raw roots', async () => {
  const make = () => {
    const f = pendingFixture(), baseManifest = {generationId: 'gen_1000_internalbase', sources: {}};
    const manifest = {generationId: 'gen_2000_internal', sources: {encar_direct: {count: 1,
      chunks: ['catalog/internal/offers/encar_direct/gen_2000_internal-chunk-0001.json']}}};
    const ref = {kind: 'nonjp-intake', root: 'catalog/nonjp-intake/v1/uae/43870000000/1'};
    const provenance = buildRawInternalProvenance({manifest, references: [ref]});
    const key = rawInternalProvenanceKey(manifest.generationId);
    f.values.set(RAW_INTERNAL_MANIFEST_KEY, baseManifest); f.values.set(key, provenance);
    f.state.pointers = [{id: 'internal_catalog', current: rawInternalPointerDescriptor(baseManifest), pending: {
      ...f.ticket, base: rawInternalPointerDescriptor(baseManifest), candidate: rawInternalPointerDescriptor(manifest, provenance)}}];
    return {...f, key, provenance, args: {storage: f.storage, policy: f.args.policy, ticket: f.ticket, manifest, baseManifest}};
  };
  await assertRawInternalReservation(make().args);
  for (const [edit, message] of [
    [f => {f.args.ticket = {...f.ticket, token: 'd'.repeat(32)};}, /ownership_changed/],
    [f => {f.values.set(RAW_INTERNAL_MANIFEST_KEY, null);}, /base_changed/],
    [f => {f.args.manifest = {...f.args.manifest, updatedAt: 'other'};}, /provenance_changed/],
    [f => {f.values.set(f.key, {...f.provenance, references: []});}, /internal_provenance_changed/],
    [f => {f.state.roots[0].state = 'deleting';}, /internal_root_changed/],
  ] as any) {
    const f = make(); edit(f); await assert.rejects(assertRawInternalReservation(f.args), message);
  }
});

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const stateKey = 'catalog/raw-feed-coordination/v1/state.json';
function pendingFixture() {
  const registryId = 'f'.repeat(32), policy = {version: 1, mode: 'required', protocolVersion: 1, registryId};
  const baseline = {version: 2, generationId: 'gen_1000_base', markets: {}};
  const manifest = {version: 2, generationId: 'gen_1001_candidate', markets: {}};
  const provenance = {version: 2, generationId: manifest.generationId, complete: true, markets: {}};
  const ticket = {registryId, operationId: 'publication', token: 'e'.repeat(32), grantRevision: 2, revision: 2,
    owner: {runId: '43870000000', attempt: '1', sourceSha: 'a'.repeat(40)}};
  const ref = {kind: 'nonjp-intake', root: 'catalog/nonjp-intake/v1/uae/43870000000/1'};
  const state = {version: 1, scope: 'nonjp_raw_lifecycle_v1', registryId, roots: [{...ref, state: 'live'}], catalog: {pending: {
    ...ticket, base: {generationId: baseline.generationId, manifestSha256: digest(baseline)},
    candidate: {generationId: manifest.generationId, manifestSha256: digest(manifest),
      provenanceSha256: digest(provenance), references: [ref]}}}};
  const provenanceKey = `catalog/generations/${manifest.generationId}/raw-provenance-v1.json`;
  const values = new Map([[RAW_COORDINATION_POLICY_KEY, policy], [stateKey, state], ['catalog/manifest.json', baseline], [provenanceKey, provenance]]);
  const storage = {driver: 'object', readJson: async (key, fallback) => structuredClone(values.get(key) ?? fallback)};
  return {storage, values, state, manifest, provenance, provenanceKey, policy, ticket,
    args: {storage, policy: {version: 1, registryId, policySha256: digest(policy)}, ticket, manifest, expectedBaseGenerationId: baseline.generationId}};
}

test('missing policy and registry stay disabled; removing only one never bypasses the gate', async () => {
  const values = new Map(), storage = {driver: 'object', readJson: async (key, fallback) => values.get(key) ?? fallback};
  assert.equal(await readRawCoordinationPolicy(storage), null);
  values.set(stateKey, pendingFixture().state);
  await assert.rejects(readRawCoordinationPolicy(storage), /policy_missing/);
  values.clear(); values.set(RAW_COORDINATION_POLICY_KEY, pendingFixture().policy);
  await assert.rejects(readRawCoordinationPolicy(storage), /registry_changed/);
});

test('gate accepts only the exact persisted pending reservation and live roots', async () => {
  const f = pendingFixture();
  await assertRawPublicationReservation(f.args);
  await assert.rejects(assertRawPublicationReservation({...f.args, ticket: undefined}), /ticket_invalid/);
  await assert.rejects(assertRawPublicationReservation({...f.args, ticket: {...f.ticket, token: 'd'.repeat(32)}}), /ownership_changed/);
});

test('changed base, candidate, provenance, root state or policy stops publication before a manifest CAS', async () => {
  const edits = [
    [f => {f.values.set('catalog/manifest.json', {...f.values.get('catalog/manifest.json'), generationId: 'gen_999_other'});}, /base_changed/],
    [f => {f.args.manifest = {...f.manifest, updatedAt: 'changed'};}, /binding_changed/],
    [f => {f.values.set(f.provenanceKey, {...f.provenance, complete: false});}, /provenance_changed/],
    [f => {f.state.roots[0].state = 'deleting';}, /root_changed/],
    [f => {f.policy.protocolVersion = 2;}, /policy_invalid/],
  ];
  for (const [edit, expected] of edits as any) {
    const f = pendingFixture(); edit(f);
    await assert.rejects(assertRawPublicationReservation(f.args), expected);
  }
});
