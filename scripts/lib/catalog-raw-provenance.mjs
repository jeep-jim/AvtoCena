import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

const SHA = /^[a-f0-9]{64}$/;
const GENERATION = /^gen_\d+_[a-z0-9-]+$/;
const UUID = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
export const RAW_PREFIXES = Object.freeze({
  'che168-snapshot': 'catalog/provider-snapshots/che168/',
  'che168-replica': 'catalog/provider-replicas/che168/',
  'che168-journal': 'catalog/intake-working/che168-v1/',
  'encar-snapshot': 'catalog/intake-staging/encar/',
  'encar-reports': 'catalog/paid-encar-reports/v1/',
});
const ROOTS = {
  'che168-snapshot': /^[a-f0-9]{64}$/,
  'che168-replica': new RegExp('^' + UUID + '$'),
  'che168-journal': /^\d{1,20}$/,
  'encar-snapshot': /^\d{1,20}\/[1-9]\d{0,5}$/,
  'encar-reports': /^[1-9]\d{0,15}$/,
};
export const RAW_PIN_PREFIX = 'catalog/raw-feed-pins/v1/';
const RAW_HANDOFF_PREFIX = 'catalog/raw-feed-handoffs/v1/';
export const rawDigest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const bounded = (value, count, code) => assert.ok(Array.isArray(value) && value.length <= count, code);
const validTime = value => typeof value === 'string' && Number.isFinite(Date.parse(value));

export function rawRootKind(root) {
  if (typeof root !== 'string') return null;
  return Object.keys(RAW_PREFIXES).find(kind => root.startsWith(RAW_PREFIXES[kind])
    && ROOTS[kind].test(root.slice(RAW_PREFIXES[kind].length))) || null;
}

export function rawReferences(values) {
  bounded(values, 4096, 'raw_reference_limit');
  const roots = new Map();
  for (const row of values) {
    assert.ok(object(row) && rawRootKind(row.root) === row.kind, 'raw_reference_scope');
    assert.ok(row.sha256 === undefined || SHA.test(row.sha256), 'raw_reference_digest');
    const clean = {kind: row.kind, root: row.root, ...(row.sha256 ? {sha256: row.sha256} : {})};
    const previous = roots.get(row.root);
    if (previous?.sha256 && clean.sha256) assert.equal(previous.sha256, clean.sha256, 'raw_reference_conflict');
    roots.set(row.root, previous?.sha256 ? previous : clean);
  }
  return [...roots.values()].sort((a, b) => a.root.localeCompare(b.root));
}

/** Preserve only source identities, never provider URLs, credentials or raw errors. */
function producerEvidence(row, market, context = row) {
    const references = [], producers = [], unknownSources = [];
    assert.match(row?.sourceId || '', /^[a-z0-9_-]{1,100}$/i, 'raw_source_identity');
    if (row.provider === 'auto_api_che168') {
      assert.equal(market, 'china', 'raw_china_market');
      assert.ok(SHA.test(row.snapshotBinding), 'raw_china_snapshot');
      const replica = row.replica;
      assert.ok(rawRootKind(replica?.key) === 'che168-replica' && SHA.test(replica.sha256)
        && replica.binding === row.snapshotBinding && Number.isSafeInteger(row.cursor)
        && row.cursor >= 0 && replica.cursor === row.cursor, 'raw_china_replica');
      references.push({kind: 'che168-snapshot', root: RAW_PREFIXES['che168-snapshot'] + row.snapshotBinding},
        {kind: 'che168-replica', root: replica.key, sha256: replica.sha256});
      const producer = {sourceId: row.sourceId, provider: row.provider, snapshotBinding: row.snapshotBinding,
        cursor: row.cursor, replica: {key: replica.key, sha256: replica.sha256, binding: replica.binding, cursor: replica.cursor}};
      if (row.workingJournal) {
        assert.ok(rawRootKind(row.workingJournal.key) === 'che168-journal'
          && SHA.test(row.workingJournal.binding), 'raw_china_journal');
        producer.workingJournal = {key: row.workingJournal.key, binding: row.workingJournal.binding};
        references.push({kind: 'che168-journal', root: row.workingJournal.key});
      } else unknownSources.push(row.sourceId + ':journal');
      if (row.baseReplica) {
        assert.ok(rawRootKind(row.baseReplica.key) === 'che168-replica' && SHA.test(row.baseReplica.sha256), 'raw_china_base_replica');
        producer.baseReplica = {key: row.baseReplica.key, sha256: row.baseReplica.sha256};
        references.push({kind: 'che168-replica', root: row.baseReplica.key, sha256: row.baseReplica.sha256});
      }
      producers.push(producer);
    } else if (row.provider === 'auto_api_encar') {
      assert.equal(market, 'korea', 'raw_encar_market');
      assert.ok(validTime(context.completedAt), 'raw_encar_observation');
      const root = RAW_PREFIXES['encar-snapshot'] + context.snapshotRun + '/' + context.snapshotAttempt;
      assert.equal(rawRootKind(root), 'encar-snapshot', 'raw_encar_snapshot');
      references.push({kind: 'encar-snapshot', root});
      producers.push({sourceId: row.sourceId, provider: row.provider,
        snapshotRun: String(context.snapshotRun), snapshotAttempt: String(context.snapshotAttempt), completedAt: context.completedAt});
    } else throw Error('raw_producer_unknown');
    return {producers, references, unknownSources};
}

export function intakeRawReferences(intake) {
  assert.ok(intake?.completed === true && validTime(intake.completedAt), 'raw_intake_incomplete');
  bounded(intake.sources, 100, 'raw_intake_sources');
  const references = [], producers = [], unknownSources = [];
  for (const row of intake.sources) {
    assert.match(row?.sourceId || '', /^[a-z0-9_-]{1,100}$/i, 'raw_source_identity');
    if (!['auto_api_che168', 'auto_api_encar'].includes(row.provider)) { unknownSources.push(row.sourceId); continue; }
    if (row.provider === 'auto_api_che168' && row.snapshotBinding === undefined && row.replica === undefined) {
      unknownSources.push(row.sourceId + ':legacy'); continue;
    }
    if (row.provider === 'auto_api_che168') assert.equal(row.completeInventory, true, 'raw_china_snapshot_incomplete');
    const evidence = producerEvidence(row, intake.market, intake);
    references.push(...evidence.references); producers.push(...evidence.producers); unknownSources.push(...evidence.unknownSources);
  }
  return {complete: unknownSources.length === 0 && producers.length > 0, producers,
    references: rawReferences(references), unknownSources};
}

export function rawGenerationKey(generationId) {
  assert.match(generationId || '', GENERATION, 'raw_generation_identity');
  return `catalog/generations/${generationId}/raw-provenance-v1.json`;
}

function manifestIdentity(manifest) {
  rawGenerationKey(manifest?.generationId);
  assert.ok(object(manifest.markets), 'raw_manifest_markets');
  for (const [market, row] of Object.entries(manifest.markets)) {
    assert.match(market, /^[a-z]+$/);
    assert.ok(Number.isSafeInteger(row?.count) && row.count >= 0, 'raw_manifest_count');
    bounded(row.chunks, 10000, 'raw_manifest_chunk_limit');
    assert.ok(row.count === 0 || row.chunks.length > 0, 'raw_manifest_chunks_missing');
  }
  return {generationId: manifest.generationId, manifestSha256: rawDigest(manifest)};
}

function offerChunkKey(manifest, market, chunk) {
  const key = String(chunk).startsWith('catalog/') ? chunk
    : `catalog/generations/${manifest.generationId}/offers/${market}/${chunk}.json`;
  assert.ok(typeof key === 'string' && new RegExp('^catalog/generations/gen_\\d+_[a-z0-9-]+/offers/' + market + '/[a-z0-9-]+\\.json$').test(key), 'raw_public_chunk_scope');
  return key;
}

/** Read every referenced Korea chunk, including chunks borrowed from an older generation. */
export async function collectPaidReportReferences({storage, manifest, maxRows = 500000}) {
  const identity = manifestIdentity(manifest), market = manifest.markets.korea;
  assert.ok(Number.isSafeInteger(maxRows) && maxRows > 0 && maxRows <= 1000000, 'raw_report_row_limit');
  const roots = new Map(), seen = new Set(), chunkProofs = [];
  let count = 0, paidCount = 0;
  for (const chunk of market?.chunks || []) {
    const key = offerChunkKey(manifest, 'korea', chunk), beforePaid = paidCount;
    const rows = await storage.readJson(key, null);
    bounded(rows, 5000, 'raw_public_chunk_rows');
    assert.ok(Buffer.byteLength(JSON.stringify(rows)) <= 32 * 1024 * 1024, 'raw_public_chunk_bytes');
    for (const offer of rows) {
      assert.ok(offer?.market === 'korea' && typeof offer.id === 'string' && !seen.has(offer.id), 'raw_public_offer_identity');
      seen.add(offer.id); count++;
      assert.ok(count <= maxRows, 'raw_report_row_limit');
      const paid = offer.sourceId === 'encar_direct' && offer.operational?.provider === 'auto_api_encar';
      if (market.provider === 'auto_api_encar') assert.ok(paid, 'raw_paid_provider_mismatch');
      if (!paid) continue;
      paidCount++;
      const at = Date.parse(offer.operational?.lastSeenAt || offer.updatedAt || offer.operational?.sourcePublishedAt || offer.firstSeenAt || '');
      assert.ok(Number.isSafeInteger(at) && at > 0, 'raw_paid_observation_missing');
      const root = RAW_PREFIXES['encar-reports'] + at;
      if (!roots.has(root)) {
        assert.ok(roots.size < 1024, 'raw_paid_root_limit');
        const complete = await storage.readJson(root + '/complete.json', null);
        assert.ok(complete?.version === 1 && complete.provider === 'auto_api_encar'
          && complete.observedAtMs === at && Date.parse(complete.observedAt) === at
          && rawRootKind(RAW_PREFIXES['encar-snapshot'] + complete.sourceRunId + '/' + complete.sourceRunAttempt) === 'encar-snapshot', 'raw_paid_complete_missing');
        roots.set(root, {complete, count: 0});
      }
      const observation = roots.get(root), complete = observation.complete, explicit = offer.operational?.paidEncarReportSnapshot;
      observation.count++;
      if (explicit !== undefined) assert.ok(object(explicit) && explicit.run === complete.sourceRunId
        && explicit.attempt === complete.sourceRunAttempt && Date.parse(explicit.observedAt) === at, 'raw_paid_explicit_identity');
    }
    chunkProofs.push({key, count: rows.length, paidCount: paidCount - beforePaid, sha256: rawDigest(rows)});
  }
  assert.equal(count, market?.count || 0, 'raw_report_coverage_incomplete');
  const observations = [...roots.values()].map(({complete, count}) => ({observedAtMs: complete.observedAtMs,
    sourceRunId: complete.sourceRunId, sourceRunAttempt: complete.sourceRunAttempt, count, sha256: rawDigest(complete)}));
  return paidReportProof(manifest, {...identity, market: 'korea', count, paidCount, chunkProofs, observations});
}

function paidReportProof(manifest, proof) {
  const identity = manifestIdentity(manifest), count = manifest.markets.korea?.count || 0;
  assert.ok(proof && proof.manifestSha256 === identity.manifestSha256 && proof.generationId === identity.generationId
    && proof.market === 'korea' && proof.count === count && Number.isSafeInteger(proof.paidCount)
    && proof.paidCount >= 0 && proof.paidCount <= count, 'raw_report_proof_missing');
  bounded(proof.chunkProofs, 10000, 'raw_report_chunk_proof'); bounded(proof.observations, 1024, 'raw_report_observations');
  const expectedKeys = (manifest.markets.korea?.chunks || []).map(chunk => offerChunkKey(manifest, 'korea', chunk));
  assert.deepEqual(proof.chunkProofs.map(row => row.key), expectedKeys, 'raw_report_chunk_proof');
  let rows = 0, paid = 0;
  const chunkProofs = proof.chunkProofs.map(row => {
    assert.ok(Number.isSafeInteger(row.count) && row.count >= 0 && row.count <= 5000
      && Number.isSafeInteger(row.paidCount) && row.paidCount >= 0 && row.paidCount <= row.count && SHA.test(row.sha256), 'raw_report_chunk_proof');
    rows += row.count; paid += row.paidCount;
    return {key: row.key, count: row.count, paidCount: row.paidCount, sha256: row.sha256};
  });
  assert.ok(rows === count && paid === proof.paidCount, 'raw_report_chunk_coverage');
  const seen = new Set(), references = [];
  const observations = proof.observations.map(row => {
    assert.ok(Number.isSafeInteger(row.observedAtMs) && row.observedAtMs > 0 && Number.isFinite(new Date(row.observedAtMs).getTime())
      && Number.isSafeInteger(row.count) && row.count > 0 && SHA.test(row.sha256) && !seen.has(row.observedAtMs), 'raw_report_observation');
    const sourceRoot = RAW_PREFIXES['encar-snapshot'] + row.sourceRunId + '/' + row.sourceRunAttempt;
    assert.equal(rawRootKind(sourceRoot), 'encar-snapshot', 'raw_report_producer'); seen.add(row.observedAtMs);
    references.push({kind: 'encar-reports', root: RAW_PREFIXES['encar-reports'] + row.observedAtMs, sha256: row.sha256},
      {kind: 'encar-snapshot', root: sourceRoot});
    return {observedAtMs: row.observedAtMs, sourceRunId: row.sourceRunId, sourceRunAttempt: row.sourceRunAttempt, count: row.count, sha256: row.sha256};
  });
  assert.equal(observations.reduce((sum, row) => sum + row.count, 0), paid, 'raw_report_observation_coverage');
  return {...identity, market: 'korea', count, paidCount: paid, chunkProofs, observations, references: rawReferences(references)};
}

/** Unknown historic source provenance stays explicit and blocks raw cleanup. */
export function buildRawGenerationProvenance({manifest, marketSources = {}, paidReports}) {
  const identity = manifestIdentity(manifest), markets = {};
  const reports = paidReportProof(manifest, paidReports);
  for (const market of ['china', 'korea']) {
    const count = manifest.markets[market]?.count || 0, source = marketSources[market];
    let evidence = [];
    if (source) {
      bounded(source.producers, 100, 'raw_producer_limit');
      bounded(source.unknownSources, 100, 'raw_unknown_source_limit');
      assert.ok(source.unknownSources.every(value => typeof value === 'string' && /^[a-z0-9_:-]{1,150}$/i.test(value)), 'raw_unknown_source_identity');
      if (source.complete === true && count > 0) assert.ok(source.producers.length > 0 && source.unknownSources.length === 0, 'raw_source_completeness');
      evidence = source.producers.map(row => producerEvidence(row, market));
      if (source.complete === true) assert.ok(evidence.every(row => row.unknownSources.length === 0), 'raw_producer_incomplete');
    }
    markets[market] = {count, complete: count === 0 || source?.complete === true,
      producers: evidence.flatMap(row => row.producers), unknownSources: source?.unknownSources || (count ? ['historic_provenance_missing'] : []),
      references: rawReferences([...(source?.references || []), ...evidence.flatMap(row => row.references), ...(market === 'korea' ? reports.references : [])])};
  }
  const value = {version: 1, scope: 'che168_and_paid_encar_raw_v1', ...identity, markets,
    complete: Object.values(markets).every(row => row.complete), paidReportCoverage: reports};
  assert.ok(Buffer.byteLength(JSON.stringify(value)) <= 2 * 1024 * 1024, 'raw_provenance_bytes');
  return value;
}

export function assertRawGenerationProvenance(value, manifest, {requireComplete = true} = {}) {
  const identity = manifestIdentity(manifest);
  assert.ok(value?.version === 1 && value.scope === 'che168_and_paid_encar_raw_v1'
    && value.generationId === identity.generationId && value.manifestSha256 === identity.manifestSha256
    && typeof value.complete === 'boolean' && (!requireComplete || value.complete === true), 'raw_generation_provenance_missing_or_unknown');
  const rebuilt = buildRawGenerationProvenance({manifest, marketSources: value.markets, paidReports: value.paidReportCoverage});
  assert.equal(rawDigest(value), rawDigest(rebuilt), 'raw_generation_provenance_inconsistent');
  return rawReferences(Object.values(value.markets).flatMap(row => row.references));
}

export async function stageRawGenerationProvenance({storage, manifest, marketSources, paidReports}) {
  assert.equal(storage.driver, 'object', 'raw_metadata_requires_object_storage');
  const value = buildRawGenerationProvenance({manifest, marketSources, paidReports});
  const key = rawGenerationKey(value.generationId), expected = rawDigest(value);
  try { await storage.writeJson(key, value, {ifNoneMatch: '*'}); }
  catch (error) { if (error?.name !== 'StorageConflictError') throw error; }
  const verify = async () => assert.equal(rawDigest(await storage.readJson(key, null)), expected, 'raw_immutable_provenance_changed');
  await verify();
  return verify;
}

function pinIdentity(operationId, owner) {
  assert.match(operationId || '', /^[a-z0-9][a-z0-9_-]{0,119}$/i, 'raw_pin_operation');
  assert.ok(object(owner) && typeof owner.runId === 'string' && /^\d{1,20}$/.test(owner.runId)
    && typeof owner.attempt === 'string' && /^[1-9]\d{0,5}$/.test(owner.attempt)
    && typeof owner.revision === 'string' && /^[a-f0-9]{40}$/.test(owner.revision), 'raw_pin_owner');
  return {operationId, owner: {runId: owner.runId, attempt: owner.attempt, revision: owner.revision}};
}

export function assertRawPin(pin) {
  pinIdentity(pin?.operationId, pin?.owner);
  assert.ok(pin.version === 1 && ['loading', 'ready', 'published', 'abandoned'].includes(pin.state)
    && validTime(pin.createdAt) && validTime(pin.updatedAt) && Date.parse(pin.updatedAt) >= Date.parse(pin.createdAt), 'raw_pin_invalid');
  rawReferences(pin.references);
  if (['published', 'abandoned'].includes(pin.state)) assert.ok(validTime(pin.terminalAt) && pin.terminalAt === pin.updatedAt, 'raw_pin_terminal_missing');
  if (pin.state === 'ready' || pin.readyAt !== undefined) assert.ok(validTime(pin.readyAt)
    && pin.releasePolicy === 'published_generation_references', 'raw_pin_handoff_missing');
  if (pin.state === 'published') rawGenerationKey(pin.generationId);
  if (pin.state === 'abandoned') assert.match(pin.reason || '', /^[a-z_]{3,64}$/, 'raw_pin_reason');
  return pin;
}

export function rawProducerOwner(env = process.env) {
  const owner = {runId: env.GITHUB_RUN_ID, attempt: env.GITHUB_RUN_ATTEMPT, revision: env.GITHUB_SHA};
  pinIdentity('owner', owner); return owner;
}

function handoffDescriptor(pin) {
  assertRawPin(pin);
  assert.ok(['ready', 'published'].includes(pin.state) && pin.readyAt, 'raw_pin_not_ready');
  return {version: 1, key: RAW_PIN_PREFIX + pin.operationId + '.json', operationId: pin.operationId,
    owner: pin.owner, readyAt: pin.readyAt, references: rawReferences(pin.references), referencesSha256: rawDigest(rawReferences(pin.references))};
}

export function assertRawHandoff(handoff) {
  pinIdentity(handoff?.operationId, handoff?.owner);
  assert.ok(handoff.version === 1 && handoff.key === RAW_PIN_PREFIX + handoff.operationId + '.json'
    && validTime(handoff.readyAt) && rawDigest(rawReferences(handoff.references)) === handoff.referencesSha256, 'raw_handoff_invalid');
  return handoff;
}

function handoffMappingKey(root) {
  const kind = rawRootKind(root); assert.ok(kind, 'raw_handoff_root');
  return RAW_HANDOFF_PREFIX + kind + '/' + rawDigest(root) + '.json';
}

export async function readRawRootHandoff(storage, root, receipt) {
  const value = await storage.readJson(handoffMappingKey(root), null);
  if (value === null) return null;
  assert.ok(value.version === 1 && value.root === root && value.receiptSha256 === rawDigest(receipt), 'raw_handoff_receipt_changed');
  return assertRawHandoff(value.handoff);
}

export async function writeRawRootHandoff(storage, root, receipt, handoff) {
  assertRawHandoff(handoff);
  assert.ok(handoff.references.some(row => row.root === root), 'raw_handoff_root_missing');
  const key = handoffMappingKey(root), value = {version: 1, root, receiptSha256: rawDigest(receipt), handoff};
  try { await storage.writeJson(key, value, {ifNoneMatch: '*'}); }
  catch (error) { if (error?.name !== 'StorageConflictError') throw error; }
  assert.equal(rawDigest(await storage.readJson(key, null)), rawDigest(value), 'raw_handoff_mapping_changed');
  return handoff;
}

/** The producer explicitly authorizes this one CAS transition by freezing a ready handoff. */
export async function releaseRawHandoff({storage, handoff, manifest, clock = Date.now}) {
  assertRawHandoff(handoff);
  const actual = await storage.readJson('catalog/manifest.json', null);
  assert.equal(rawDigest(actual), rawDigest(manifest), 'raw_handoff_publication_changed');
  const references = assertRawGenerationProvenance(await storage.readJson(rawGenerationKey(manifest.generationId), null), manifest, {requireComplete: false});
  const roots = new Map(references.map(row => [row.root, row]));
  assert.ok(handoff.references.every(row => roots.has(row.root) && (!row.sha256 || roots.get(row.root).sha256 === row.sha256)), 'raw_handoff_generation_refs_missing');
  const meta = await storage.readJsonWithMeta(handoff.key, null);
  assert.ok(meta.found && meta.etag && rawDigest(handoffDescriptor(meta.value)) === rawDigest(handoff), 'raw_handoff_ownership_changed');
  if (meta.value.state === 'published') return;
  const at = new Date(clock()).toISOString();
  assert.ok(Date.parse(at) >= Date.parse(meta.value.updatedAt), 'raw_handoff_clock_regressed');
  await storage.writeJson(handoff.key, {...meta.value, state: 'published', generationId: manifest.generationId,
    updatedAt: at, terminalAt: at}, {ifMatch: meta.etag});
  const saved = await storage.readJson(handoff.key, null);
  assert.ok(saved?.state === 'published' && saved.generationId === manifest.generationId
    && rawDigest(handoffDescriptor(saved)) === rawDigest(handoff), 'raw_handoff_release_readback');
}

/** Producer-owned pin, separate from the publication lease; age never releases it. */
export async function openRawFeedPin({storage, operationId, owner, references, clock = Date.now}) {
  assert.equal(storage.driver, 'object', 'raw_pin_requires_object_storage');
  const identity = pinIdentity(operationId, owner), key = RAW_PIN_PREFIX + operationId + '.json';
  let meta = await storage.readJsonWithMeta(key, null), sequence = Promise.resolve();
  async function save(value) {
    await storage.writeJson(key, assertRawPin(value), meta.found ? {ifMatch: meta.etag} : {ifNoneMatch: '*'});
    const next = await storage.readJsonWithMeta(key, null);
    assert.ok(next.found && next.etag && rawDigest(next.value) === rawDigest(value), 'raw_pin_readback_mismatch');
    meta = next;
  }
  const roots = rawReferences(references);
  if (meta.found) {
    assertRawPin(meta.value);
    assert.ok(meta.etag && rawDigest(meta.value.owner) === rawDigest(identity.owner)
      && meta.value.operationId === operationId && ['loading', 'ready'].includes(meta.value.state), 'raw_pin_not_owned');
  } else {
    const at = new Date(clock()).toISOString();
    await save({version: 1, ...identity, state: 'loading', createdAt: at, updatedAt: at, references: roots});
  }
  const change = update => (sequence = sequence.then(async () => {
    assert.equal(meta.value.state, 'loading', 'raw_pin_already_terminal');
    const fresh = await storage.readJsonWithMeta(key, null);
    assert.ok(fresh.found && fresh.etag === meta.etag && rawDigest(fresh.value) === rawDigest(meta.value), 'raw_pin_ownership_lost');
    const at = new Date(clock()).toISOString();
    await save(await update(meta.value, at));
    return meta.value;
  }));
  const add = values => change((current, at) => ({...current, updatedAt: at,
    references: rawReferences([...current.references, ...values])}));
  // An interrupted producer may resume only its own pin; references only grow.
  if (rawDigest(rawReferences([...meta.value.references, ...roots])) !== rawDigest(meta.value.references)) await add(roots);
  return {
    key, add,
    handoff: async () => {
      if (meta.value.state === 'ready') return handoffDescriptor(meta.value);
      const saved = await change((current, at) => ({...current, state: 'ready', updatedAt: at,
        readyAt: at, releasePolicy: 'published_generation_references'}));
      return handoffDescriptor(saved);
    },
    published: generationId => change(async (current, at) => {
      const manifest = await storage.readJson('catalog/manifest.json', null);
      assert.equal(manifest?.generationId, generationId, 'raw_pin_generation_not_published');
      const provenance = await storage.readJson(rawGenerationKey(generationId), null);
      const protectedRoots = new Map(assertRawGenerationProvenance(provenance, manifest).map(row => [row.root, row]));
      assert.ok(current.references.every(row => protectedRoots.has(row.root)
        && (!row.sha256 || protectedRoots.get(row.root).sha256 === row.sha256)), 'raw_pin_generation_refs_missing');
      return {...current, state: 'published', updatedAt: at, terminalAt: at, generationId};
    }),
    abandoned: reason => change((current, at) => ({...current, state: 'abandoned', updatedAt: at, terminalAt: at, reason})),
  };
}
