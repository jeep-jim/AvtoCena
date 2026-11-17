import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {rawDigest, rawReferences, intakeRawReferences} from './catalog-raw-provenance.mjs';
import {readIntakeArchiveManifest} from './nonjp-intake-archive.mjs';
import {withRawReadProtection} from './catalog-raw-session.mjs';
import {CONTRIBUTION_SOURCE_MARKETS} from '../publisher-runtime83/source-contribution-reader.mjs';

const SHA = /^[a-f0-9]{64}$/, REVISION = /^[a-f0-9]{40}$/;
const MAX_ROWS = 500000, MAX_CHUNKS = 10000, MAX_PART_ROWS = 500, MAX_PART_BYTES = 4 * 1024 * 1024;
const ARCHIVE_PART_BYTES = 2 * 1024 * 1024, MAX_REPORT_BYTES = 4 * 1024 * 1024;
const byteDigest = value => createHash('sha256').update(value).digest('hex');
const clone = value => JSON.parse(JSON.stringify(value));
const sortedPairs = values => [...values].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
const rowId = row => typeof row?.id === 'string' && /^[a-zA-Z0-9_-]{1,200}$/.test(row.id) ? row.id : null;
const signed = value => ({...value, checksum: rawDigest(value)});

/** Each audited source owns its input validator and row identity. The shared
 * stages observe existing processing without changing catalogue rows. */
export function createSourceContributionProtocol({sourceId,market,producerKind,witnessField,snapshotKind,snapshotReceiptLeaf,
  sourceRow,assertWitness,validateInput,defaultReusableSourceIds,errorPrefix='source_contribution',allowIndependentRetained=false,freshOnlyMerge}) {
  assert.ok(CONTRIBUTION_SOURCE_MARKETS[sourceId]===market && /^independent_[a-z0-9_]+_v1$/.test(producerKind)
    && ['paidInputWitness','sourceInputWitness'].includes(witnessField),'source_contribution_profile');
  const internalCapabilities=new WeakMap(),publicCapabilities=new WeakMap(),stateReaders=new WeakMap(),error=suffix=>errorPrefix+'_'+suffix;
  const requiredReusableSources=[...defaultReusableSourceIds];
/** This capability observes the existing merge/normalization calls. It never
 * changes a row and cannot be reconstructed from a report's complete flag. */
function createPublicationContributions({intake, freshOffers, sellerInventory, compactPublic,
  sourceSha = process.env.GITHUB_SHA, calculationVersion = process.env.AVTOCENA_CALCULATION_VERSION}) {
  let witness;
  try {
    witness = clone(validateInput(intake, freshOffers, sellerInventory));intake=clone(intake);
    assert.ok(REVISION.test(sourceSha || '') && SHA.test(calculationVersion || ''), error('runtime_identity'));
  } catch {return null;}
  const input = new Map(freshOffers.map(row => [row.id, rawDigest(row)]));
  const merged = new Map(), audited = new Map(), selectionFields = new Map(), selected = new Map(), normalized = new Map(), published = new Map();
  let reason = null, selectedCaptured = false, normalizedCaptured = false, publicCaptured = false;
  const observe = fn => {if (reason) return; try {fn();} catch (error) {reason = error.message;}};
  const rowMap = (rows, expected, output, transform = row => row) => {
    for (const row of rows) {
      assert.ok(sourceRow(row) && expected.has(row.id) && !output.has(row.id), error('transition_identity'));
      output.set(row.id, rawDigest(transform(row)));
    }
  };
  const readState = () => {
    if (reason || !selectedCaptured || !normalizedCaptured || !publicCaptured || !normalized.size || !published.size) return null;
    return {witness: clone(witness), intake: clone(intake), sourceSha, calculationVersion,
      rows: sortedPairs(input).map(([id, inputSha256]) => ({id, inputSha256,
        normalizedSha256: normalized.get(id) || null, publicSha256: published.get(id) || null}))};
  };
  const tracker = {
    get reason() {return reason;},
    observeMerge(primary, retained, result, {phase='fresh'}={}) {observe(() => {
      // Old candidates may be overwritten by a fresh exact source row later.
      // Their audit/selection still fails unless that independent merge was observed.
      if(allowIndependentRetained && phase==='retained')return;
      assert.ok(sourceRow(primary) && input.get(primary.id) === rawDigest(primary) && !merged.has(primary.id), error('merge_input'));
      assert.ok(sourceRow(result) && result.id === primary.id, error('merge_identity'));
      if(retained!==undefined && retained!==null) {
        assert.ok(allowIndependentRetained && typeof freshOnlyMerge==='function',error('borrowed_merge'));
        assert.equal(rawDigest(result),rawDigest(freshOnlyMerge(primary)),error('borrowed_merge'));
      }
      merged.set(result.id, rawDigest(result));
    });},
    recordAudited(before, after) {observe(() => {
      assert.ok(sourceRow(before) && merged.get(before.id) === rawDigest(before) && sourceRow(after) && after.id === before.id
        && !audited.has(after.id), error('audit_input'));
      audited.set(after.id, rawDigest(after));
      const {images, bodyType, ...rest} = after;
      selectionFields.set(after.id, {rest: rawDigest(rest), bodyType, images: (images || []).map(rawDigest)});
    });},
    captureSelected(rows) {observe(() => {
      assert.equal(selectedCaptured, false, error('selected_repeat')); selectedCaptured = true;
      for (const row of rows) {
        const previous = selectionFields.get(row.id), {images, bodyType, ...rest} = row;
        // Existing selection can remove duplicate photos and clear a known
        // contradictory body default. It cannot add or borrow other fields.
        assert.ok(previous && rawDigest(rest) === previous.rest
          && (bodyType === previous.bodyType || bodyType === undefined), error('selected_bytes'));
        let position = 0;
        for (const image of images || []) {
          const found = previous.images.indexOf(rawDigest(image), position);
          assert.ok(found >= 0, error('selected_images')); position = found + 1;
        }
      }
      rowMap(rows, audited, selected);
    });},
    captureNormalized(rows) {observe(() => {
      assert.ok(selectedCaptured && !normalizedCaptured, error('normalization_order')); normalizedCaptured = true;
      rowMap(rows, selected, normalized);
    });},
    captureFinal(rows) {observe(() => {
      assert.ok(normalizedCaptured && !publicCaptured, error('publication_order')); publicCaptured = true;
      rowMap(rows, normalized, published, compactPublic);
    });},
    snapshot: readState,
  };
  stateReaders.set(tracker,readState);return tracker;
}

function contributionKey(generationId, stage = 'public') {
  assert.match(generationId || '', /^gen_\d+_[a-z0-9-]+$/, error('generation'));
  assert.ok(stage === 'public' || stage === 'internal', error('stage'));
  return `catalog/raw-feed-coordination/v1/contributions/${generationId}/${sourceId}/${stage === 'internal' ? 'internal' : 'manifest'}.json`;
}

async function immutable(storage, key, value) {
  try {await storage.writeJson(key, value, {ifNoneMatch: '*'});}
  catch (error) {if (error?.name !== 'StorageConflictError' && error?.message !== 'storage_conflict') throw error;}
  assert.equal(rawDigest(await storage.readJson(key, null)), rawDigest(value), error('immutable_changed'));
}

/** Only the report is inflated here; the archive's ordinary verifier already
 * checks its complete intake. Exact file/part/report hashes bind the witness. */
async function readInputArchive({storage, intake}) {
  const witness = assertWitness(intake[witnessField]);
  return withRawReadProtection({storage, references: [
    {kind: 'nonjp-intake', root: intake.durableIntakeArchive.root, sha256: intake.durableIntakeArchive.manifestSha256},
    {kind: snapshotKind, root: witness.snapshot.root}], read: scoped => readInputArchiveScoped({storage: scoped, intake})});
}

async function readInputArchiveScoped({storage, intake}) {
  const receipt = intake.durableIntakeArchive;
  const manifest = await readIntakeArchiveManifest({storage, receipt});
  const file = manifest.files.find(row => row.name === 'report.json');
  assert.ok(file && file.bytes > 0 && file.bytes <= MAX_REPORT_BYTES && file.parts.length <= 2, error('report_bound'));
  const buffers = [];
  for (const part of file.parts) {
    const value = await storage.readJson(part.key, null);
    assert.ok(value?.version === 1 && value.encoding === 'gzip-base64' && value.bytes === part.bytes
      && value.sha256 === part.sha256 && typeof value.payload === 'string'
      && value.payload.length <= (ARCHIVE_PART_BYTES + 65536) * 2, error('report_part'));
    const encoded = Buffer.from(value.payload, 'base64');
    assert.equal(encoded.toString('base64'), value.payload, error('report_base64'));
    const bytes = gunzipSync(encoded, {maxOutputLength: ARCHIVE_PART_BYTES});
    assert.ok(bytes.length === part.bytes && byteDigest(bytes) === part.sha256, error('report_part_hash'));
    buffers.push(bytes);
  }
  const bytes = Buffer.concat(buffers);
  assert.ok(bytes.length === file.bytes && byteDigest(bytes) === file.sha256, error('report_file_hash'));
  const report = JSON.parse(bytes.toString('utf8'));
  assert.equal(rawDigest(report), manifest.reportDigest, error('report_hash'));
  assert.equal(rawDigest(report[witnessField]), rawDigest(intake[witnessField]), error('archived_witness_changed'));
  assertWitness(report[witnessField]);
  assert.equal(rawDigest(await storage.readJson(report[witnessField].snapshot.root + '/' + snapshotReceiptLeaf, null)),
    report[witnessField].snapshot.completeSha256, error('saved_source_changed'));
  return {manifest, report};
}

function contributionRows(state) {
  assert.ok(state && Array.isArray(state.rows) && state.rows.length > 0 && state.rows.length <= MAX_ROWS,
    error('materialization_rows'));
  const ids = new Set(), pairs = [], normalized = new Map(), published = new Map();
  let previous = '';
  for (const row of state.rows) {
    assert.ok(rowId(row) && !ids.has(row.id) && row.id > previous && SHA.test(row.inputSha256 || '')
      && (row.normalizedSha256 === null || SHA.test(row.normalizedSha256 || ''))
      && (row.publicSha256 === null || SHA.test(row.publicSha256 || ''))
      && (row.publicSha256 === null || row.normalizedSha256 !== null), error('materialization_row'));
    previous = row.id; ids.add(row.id); pairs.push([row.id, row.inputSha256]);
    if (row.normalizedSha256) normalized.set(row.id, row.normalizedSha256);
    if (row.publicSha256) published.set(row.id, row.publicSha256);
  }
  assert.equal(rawDigest({rows: pairs.length, idsSha256: rawDigest(pairs.map(([id]) => id)), rowsSha256: rawDigest(pairs)}),
    rawDigest(assertWitness(state.witness).normalized), error('materialization_input'));
  assert.ok(normalized.size > 0 && published.size > 0, error('materialization_empty'));
  return {normalized, published};
}

async function verifiedOutputChunks({storage, keys, expected, generationId, stage, witness}) {
  assert.ok(keys.length > 0 && keys.length <= MAX_CHUNKS && new Set(keys).size === keys.length,
    error('output_chunks'));
  const seen = new Set(), chunks = [], reportRoots = new Map();
  for (const key of keys) {
    assert.ok(stage === 'internal'
      ? new RegExp(`^catalog/internal/offers/${sourceId}/${generationId}-[a-z0-9-]+\\.json$`).test(key)
      : new RegExp(`^catalog/generations/${generationId}/offers/${market}/[a-z0-9-]+\\.json$`).test(key),
    error('output_scope'));
    const rows = await storage.readJson(key, null);
    assert.ok(Array.isArray(rows) && rows.length > 0 && rows.length <= 5000, error('output_rows'));
    const bytes = Buffer.byteLength(JSON.stringify(rows));
    assert.ok(bytes <= 32 * 1024 * 1024, error('output_bytes'));
    for (const row of rows) {
      assert.ok(sourceRow(row) && !seen.has(row.id) && expected.get(row.id) === rawDigest(row),
        error('output_row_bytes'));
      seen.add(row.id);
      const at = Date.parse(row.operational?.lastSeenAt || row.updatedAt || row.operational?.sourcePublishedAt || row.firstSeenAt || '');
      assert.equal(at, Date.parse(witness.snapshot.completedAt), error('observation_changed'));
      if (producerKind !== 'independent_paid_encar_snapshot_v1') continue;
      const root = `catalog/paid-encar-reports/v1/${at}`;
      if (!reportRoots.has(root)) {
        const complete = await storage.readJson(root + '/complete.json', null);
        assert.ok(complete?.version === 1 && complete.provider === 'auto_api_encar' && complete.observedAtMs === at
          && Date.parse(complete.observedAt) === at
          && `catalog/intake-staging/encar/${complete.sourceRunId}/${complete.sourceRunAttempt}` === witness.snapshot.root,
        error('report_identity'));
        reportRoots.set(root, {kind: 'encar-reports', root, sha256: rawDigest(complete)});
      }
      const explicit = row.operational?.paidEncarReportSnapshot;
      if (explicit !== undefined) assert.ok(explicit && Date.parse(explicit.observedAt) === at
        && `catalog/intake-staging/encar/${explicit.run}/${explicit.attempt}` === witness.snapshot.root,
      error('explicit_report_identity'));
    }
    chunks.push({key, sha256: rawDigest(rows), bytes, rows: rows.length,
      idsSha256: rawDigest(rows.map(row => row.id).sort())});
  }
  assert.equal(seen.size, expected.size, error('output_coverage'));
  return {chunks, references: [...reportRoots.values()]};
}

function materializationParts(generationId, state) {
  const root = contributionKey(generationId).replace('/manifest.json', ''), objects = [];
  for (let offset = 0; offset < state.rows.length; offset += MAX_PART_ROWS) {
    const value = {version: 1, generationId, sourceId, rows: state.rows.slice(offset, offset + MAX_PART_ROWS)};
    const bytes = Buffer.byteLength(JSON.stringify(value));
    assert.ok(bytes <= MAX_PART_BYTES, error('part_bytes'));
    objects.push({key: `${root}/rows/${String(objects.length).padStart(4, '0')}.json`, value,
      sha256: rawDigest(value), bytes, rows: value.rows.length, idsSha256: rawDigest(value.rows.map(row => row.id))});
  }
  return objects;
}

/** Optional evidence: every rejection before immutable writes means retain the
 * old safe dependency union. Once emitted, any changed proof is a hard stop. */
async function prepareInternalContribution({storage, manifest, contributions,
  reusableSourceIds = defaultReusableSourceIds}) {
  const readState=stateReaders.get(contributions),state=readState?.();
  if (!state) return null;
  manifest=clone(manifest);const stateSha256=rawDigest(state);
  let proof, objects;
  try {
    const {normalized, published} = contributionRows(state), source = manifest?.sources?.[sourceId];
    contributionKey(manifest?.generationId, 'internal');
    assert.ok(Array.isArray(reusableSourceIds) && reusableSourceIds.length<=100
      && reusableSourceIds.every(id=>CONTRIBUTION_SOURCE_MARKETS[id]===market),error('reusable_internal_scope'));
    assert.ok(source?.count === normalized.size && source.count > 0 && Array.isArray(source.chunks)
      && [...requiredReusableSources,...reusableSourceIds].every(id => id === sourceId || !manifest.sources[id]?.count),
    error('reusable_internal_coverage'));
    const archived = await readInputArchive({storage, intake: state.intake});
    const output = await verifiedOutputChunks({storage, keys: source.chunks, expected: normalized,
      generationId: manifest.generationId, stage: 'internal', witness: state.witness});
    const sourceRefs = intakeRawReferences(state.intake);
    assert.ok(sourceRefs.complete && sourceRefs.unknownSources.length === 0, error('unknown_input'));
    const references = rawReferences([...sourceRefs.references, ...output.references]);
    objects = materializationParts(manifest.generationId, state);
    const w = state.witness, receipt = state.intake.durableIntakeArchive;
    proof = signed({version: 1, kind: 'independent_source_snapshot_v1', producerKind,
      stage: 'internal', sourceId, market, generationId: manifest.generationId,
      producer: w.producer,
      input: {snapshotRoot: w.snapshot.root, completeSha256: w.snapshot.completeSha256, pages: w.snapshot.pages,
        pagesSha256: w.snapshot.pagesSha256, rawRows: w.snapshot.rows, archiveRoot: receipt.root,
        archiveManifestSha256: receipt.manifestSha256, archiveReportSha256: archived.manifest.reportDigest,
        witnessField, witnessSha256: rawDigest(w), normalizedRows: w.normalized.rows,
        normalizedIdsSha256: w.normalized.idsSha256, normalizedRowsSha256: w.normalized.rowsSha256},
      materialization: {sourceSha: state.sourceSha, calculationVersion: state.calculationVersion,
        rows: state.rows.length, normalizedRows: normalized.size, publicRows: published.size,
        idsSha256: w.normalized.idsSha256, parts: objects.map(({value, ...descriptor}) => descriptor)},
      output: {internal: {manifestSha256: rawDigest(manifest), sourceId, sourceSha256: rawDigest(source),
        count: source.count, chunks: output.chunks}},
      references});
  } catch {return null;}
  for (const object of objects) await immutable(storage, object.key, object.value);
  const key = contributionKey(manifest.generationId, 'internal');
  await immutable(storage, key, proof);
  const reference = {key, sha256: rawDigest(proof)};
  const verify = async () => {
      assert.equal(rawDigest(readState()),stateSha256,error('tracker_changed'));
      assert.equal(rawDigest(await storage.readJson(key, null)), reference.sha256, error('internal_changed'));
      await readInputArchive({storage, intake: state.intake});
      const output = await verifiedOutputChunks({storage, keys: proof.output.internal.chunks.map(row => row.key),
        expected: contributionRows(state).normalized, generationId: manifest.generationId, stage: 'internal', witness: state.witness});
      assert.equal(rawDigest(output.chunks), rawDigest(proof.output.internal.chunks), error('internal_chunks_changed'));
      for (const object of objects) assert.equal(rawDigest(await storage.readJson(object.key, null)), object.sha256,
        error('materialization_changed'));
    };
  const capability = {reference:clone(reference),proof:clone(proof),manifest:clone(manifest),verify};
  internalCapabilities.set(capability,{tracker:contributions,stateSha256,reference,proof,manifest,verify,intakeSha256:rawDigest(state.intake)});
  return capability;
}

/** Only a full public AND reusable-internal byte witness can replace the old
 * market union. Missing projection remains an ordinary publication blocker. */
async function preparePublicContribution({storage, manifest, contributions, internal, readProjectionBatches}) {
  const state=stateReaders.get(contributions)?.(),original=internalCapabilities.get(internal);
  if (!state || !original || original.tracker!==contributions || original.stateSha256!==rawDigest(state)) return null;
  manifest=clone(manifest);internal=original;
  let proof;
  try {
    assert.equal(manifest.generationId, internal.proof.generationId, error('generation_changed'));
    const {published} = contributionRows(state), marketEntry = manifest.markets?.[market];
    assert.ok(marketEntry?.count === published.size && marketEntry.count > 0 && Array.isArray(marketEntry.chunks),
      error('public_count'));
    assert.equal(rawDigest(await storage.readJson('catalog/internal/manifest.json', null)), rawDigest(internal.manifest),
      error('internal_manifest_changed'));
    await internal.verify();
    const keys = marketEntry.chunks.map(chunk => String(chunk).startsWith('catalog/') ? chunk
      : `catalog/generations/${manifest.generationId}/offers/${market}/${chunk}.json`);
    const output = await verifiedOutputChunks({storage, keys, expected: published,
      generationId: manifest.generationId, stage: 'public', witness: state.witness});
    const projectionKey = `catalog/generations/${manifest.generationId}/indexes/projection/${market}.json`;
    assert.equal(typeof readProjectionBatches, 'function', error('projection_reader_missing'));
    const seen = new Set();
    for await (const batch of readProjectionBatches(storage, projectionKey)) {
      assert.equal(batch.generationId, manifest.generationId, error('projection_generation'));
      assert.ok(Array.isArray(batch.items) && batch.items.length <= MAX_ROWS, error('projection_rows'));
      for (const row of batch.items) {
        assert.ok(rowId(row) && published.has(row.id) && !seen.has(row.id), error('projection_identity'));
        seen.add(row.id);
      }
    }
    assert.equal(seen.size, published.size, error('projection_coverage'));
    const {checksum, ...body} = internal.proof;
    proof = signed({...body, stage: 'public', internalReceipt: internal.reference,
      output: {...body.output, public: {manifestSha256: rawDigest(manifest), count: marketEntry.count, chunks: output.chunks}},
      references: rawReferences([...body.references, ...output.references])});
  } catch {return null;}
  const key = contributionKey(manifest.generationId);
  await immutable(storage, key, proof);
  const reference={key,sha256:rawDigest(proof)},verify=async () => {
      assert.equal(rawDigest(await storage.readJson(key, null)), rawDigest(proof), error('public_changed'));
      assert.equal(rawDigest(await storage.readJson('catalog/internal/manifest.json', null)), rawDigest(internal.manifest),
        error('internal_manifest_changed'));
      await internal.verify();
      const output = await verifiedOutputChunks({storage, keys: proof.output.public.chunks.map(row => row.key),
        expected: contributionRows(state).published, generationId: manifest.generationId, stage: 'public', witness: state.witness});
      assert.equal(rawDigest(output.chunks), rawDigest(proof.output.public.chunks), error('public_chunks_changed'));
    };
  const capability={reference:clone(reference),proof:clone(proof),verify};
  publicCapabilities.set(capability, {market,sourceId,reference,proof,verify,
    manifestSha256:rawDigest(manifest),intakeSha256:rawDigest(state.intake)});
  return capability;
}


/** New internal references also require this exact audited instance. A
 * caller-supplied immutable reference is evidence, never source authority. */
async function verifyInternalContribution({contributions,manifest,intake,market:actualMarket=intake?.market}) {
  const authority=internalCapabilities.get(contributions);
  assert.ok(authority && market===actualMarket && rawDigest(authority.manifest)===rawDigest(manifest)
    && authority.intakeSha256===rawDigest(intake),'source_contribution_internal_authority');
  await authority.verify();
  return {reference:clone(authority.reference),proof:clone(authority.proof),market,sourceId};
}

/** This verifier trusts only this exact protocol instance. The public
 * source dispatcher never registers arbitrary factory products. */
async function verifyPublicContribution({contributions,manifest,intake,market:actualMarket=intake?.market}) {
  const authority=publicCapabilities.get(contributions);
  assert.ok(authority && authority.market===actualMarket && authority.manifestSha256===rawDigest(manifest)
    && authority.intakeSha256===rawDigest(intake),'source_contribution_public_authority');
  await authority.verify();return {reference:clone(authority.reference),proof:clone(authority.proof),market:authority.market,sourceId:authority.sourceId};
}
  return {createPublicationContributions,prepareInternalContribution,preparePublicContribution,readInputArchive,contributionKey,verifyPublicContribution,verifyInternalContribution};
}
