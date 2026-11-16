import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {readOwnedJsonBounded} from './owned-bounded-json.mjs';

export const CONTRIBUTION_SOURCE_MARKETS = Object.freeze({encar_direct: 'korea', kcar_korea_open: 'korea',
  autohome_used_china_open: 'china', autohome_new_china_open: 'china', dubizzle_uae_open: 'uae',
  dubicars_uae_exact: 'uae', carswitch_uae_open: 'uae', mobile_de_open: 'europe', autoscout_europe_open: 'europe',
  myauto_georgia_list: 'georgia', autopapa_georgia_open: 'georgia'});
export const SOURCE_CONTRIBUTION_LIMITS = Object.freeze({rows: 500000, parts: 2000, partRows: 500,
  partBytes: 4 * 1024 ** 2, chunkRows: 5000, chunkBytes: 32 * 1024 ** 2, chunks: 10000,
  totalBytes: 2 * 1024 ** 3, reportBytes: 4 * 1024 ** 2, archivePartBytes: 2 * 1024 ** 2, workMs: 300000});
const SHA = /^[a-f0-9]{64}$/, COMMIT = /^[a-f0-9]{40}$/, GENERATION = /^gen_\d+_[a-z0-9-]+$/;
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const bytesDigest = value => createHash('sha256').update(value).digest('hex');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const integer = (value, maximum, minimum = 0) => Number.isSafeInteger(value) && value >= minimum && value <= maximum;
const ascii = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const identity = owner => object(owner) && /^\d{1,20}$/.test(owner.runId || '')
  && /^[1-9]\d{0,5}$/.test(owner.attempt || '') && COMMIT.test(owner.sourceSha || '');

export function sourceContributionKey(generationId, sourceId, stage = 'internal') {
  assert.ok(GENERATION.test(generationId) && Object.hasOwn(CONTRIBUTION_SOURCE_MARKETS, sourceId)
    && ['internal', 'public'].includes(stage), 'contribution_scope');
  return `catalog/raw-feed-coordination/v1/contributions/${generationId}/${sourceId}/${stage === 'internal' ? 'internal' : 'manifest'}.json`;
}

export function sourceContributionReference(value, stage = 'internal') {
  const match = typeof value?.key === 'string' && value.key.match(/^catalog\/raw-feed-coordination\/v1\/contributions\/(gen_\d+_[a-z0-9-]+)\/([a-zA-Z0-9_-]+)\/(internal|manifest)\.json$/);
  assert.ok(match && SHA.test(value.sha256 || '') && value.key === sourceContributionKey(match[1], match[2], stage), 'contribution_reference');
  return {key: value.key, sha256: value.sha256, generationId: match[1], sourceId: match[2]};
}

function signed(value, code) {
  assert.ok(object(value) && SHA.test(value.checksum || ''), code);
  const {checksum, ...body} = value; assert.equal(digest(body), checksum, code); return value;
}

function rawKind(root) {
  if (typeof root !== 'string') return null;
  if (/^catalog\/intake-staging\/encar\/\d{1,20}\/[1-9]\d{0,5}$/.test(root)) return 'encar-snapshot';
  if (/^catalog\/paid-encar-reports\/v1\/[1-9]\d{0,15}$/.test(root)) return 'encar-reports';
  if (/^catalog\/provider-snapshots\/che168\/[a-f0-9]{64}$/.test(root)) return 'che168-snapshot';
  if (/^catalog\/provider-replicas\/che168\/[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(root)) return 'che168-replica';
  if (/^catalog\/intake-working\/che168-v1\/\d{1,20}$/.test(root)) return 'che168-journal';
  if (/^catalog\/nonjp-intake\/v1\/(china|korea|uae|europe|georgia)\/\d{1,20}\/[1-9]\d{0,5}$/.test(root)) return 'nonjp-intake';
  return null;
}
function refs(values) {
  assert.ok(Array.isArray(values) && values.length <= 4096, 'contribution_reference_limit');
  const byRoot = new Map();
  for (const row of values) {
    assert.ok(object(row) && rawKind(row.root) === row.kind && row.kind
      && (row.sha256 === undefined || SHA.test(row.sha256)), 'contribution_raw_scope');
    const clean = {kind: row.kind, root: row.root, ...(row.sha256 ? {sha256: row.sha256} : {})}, old = byRoot.get(row.root);
    if (old?.sha256 && clean.sha256) assert.equal(old.sha256, clean.sha256, 'contribution_reference_conflict');
    byRoot.set(clean.root, old?.sha256 ? old : clean);
  }
  return [...byRoot.values()].sort((a, b) => a.root.localeCompare(b.root));
}
function requireReferences(actual, expected) {
  const byRoot = new Map(actual.map(row => [row.root, row]));
  for (const row of expected) assert.ok(byRoot.get(row.root)?.kind === row.kind
    && (!row.sha256 || byRoot.get(row.root).sha256 === row.sha256), 'contribution_source_closure_missing');
}

/** Only the control document is read here. The runtime independently checks
 * the full witness under the persisted pending pointer before its actual CAS. */
export async function readSourceContributionDescriptor({storage, key, sha256, internalManifest, deadline}) {
  const reference = sourceContributionReference({key, sha256});
  const result = await readOwnedJsonBounded({storage, key, maxBytes: SOURCE_CONTRIBUTION_LIMITS.partBytes, deadline});
  assert.ok(result?.found, 'contribution_object_missing');
  const proof = signed(result.value, 'contribution_checksum'), source = internalManifest?.sources?.[reference.sourceId];
  assert.ok(digest(proof) === sha256 && proof.version === 1 && proof.kind === 'independent_source_snapshot_v1'
    && proof.stage === 'internal' && proof.sourceId === reference.sourceId && proof.generationId === reference.generationId
    && proof.market === CONTRIBUTION_SOURCE_MARKETS[proof.sourceId] && source?.count > 0
    && proof.output?.internal?.sourceId === proof.sourceId && proof.output.internal.count === source.count
    && proof.output.internal.sourceSha256 === digest(source)
    && digest(proof.output.internal.chunks?.map(row => row.key)) === digest(source.chunks), 'contribution_internal_source_changed');
  return {sourceId: proof.sourceId, key, sha256, sourceSha256: digest(source), count: source.count, references: refs(proof.references)};
}

async function readArchiveWitness(read, proof) {
  const input = proof.input, root = input.archiveRoot;
  assert.match(root || '', new RegExp(`^catalog/nonjp-intake/v1/${proof.market}/\\d{1,20}/[1-9]\\d{0,5}$`), 'contribution_archive_root');
  const archive = await read(root + '/complete.json', 2 * 1024 ** 2);
  assert.ok(archive?.version === 1 && archive.kind === 'nonjp-intake' && archive.market === proof.market
    && root === `catalog/nonjp-intake/v1/${archive.market}/${archive.owner?.runId}/${archive.owner?.attempt}`
    && COMMIT.test(archive.owner?.revision || '') && digest(archive) === input.archiveManifestSha256
    && SHA.test(archive.reportDigest || '') && archive.reportDigest === input.archiveReportSha256
    && Array.isArray(archive.files) && archive.files.length > 0 && archive.files.length <= 20000, 'contribution_archive_identity');
  const names = new Set(); let total = 0;
  for (const file of archive.files) {
    assert.ok((file?.name === 'report.json' || /^[a-z0-9_-]+-\d{6}\.jsonl$/i.test(file?.name || ''))
      && !names.has(file.name) && SHA.test(file.sha256 || '') && integer(file.bytes, 32 * 1024 ** 2)
      && Array.isArray(file.parts) && file.parts.length === Math.ceil(file.bytes / SOURCE_CONTRIBUTION_LIMITS.archivePartBytes), 'contribution_archive_file');
    names.add(file.name); total += file.bytes;
    for (const [index, part] of file.parts.entries()) assert.ok(SHA.test(part?.sha256 || '')
      && part.key === `${root}/files/${file.name}/${index}-${part.sha256}.json`
      && part.bytes === Math.min(SOURCE_CONTRIBUTION_LIMITS.archivePartBytes, file.bytes - index * SOURCE_CONTRIBUTION_LIMITS.archivePartBytes), 'contribution_archive_part');
  }
  assert.ok(names.has('report.json') && total === archive.totalBytes && total <= 128 * 1024 ** 3, 'contribution_archive_total');
  const file = archive.files.find(row => row.name === 'report.json');
  assert.ok(integer(file.bytes, SOURCE_CONTRIBUTION_LIMITS.reportBytes, 1) && file.parts.length <= 2, 'contribution_report_bound');
  const buffers = [];
  for (const part of file.parts) {
    const wire = await read(part.key, SOURCE_CONTRIBUTION_LIMITS.partBytes);
    assert.ok(wire?.version === 1 && wire.encoding === 'gzip-base64' && wire.bytes === part.bytes
      && wire.sha256 === part.sha256 && typeof wire.payload === 'string'
      && wire.payload.length <= (SOURCE_CONTRIBUTION_LIMITS.archivePartBytes + 65536) * 2, 'contribution_report_wire');
    const compressed = Buffer.from(wire.payload, 'base64');
    assert.equal(compressed.toString('base64'), wire.payload, 'contribution_report_base64');
    const bytes = gunzipSync(compressed, {maxOutputLength: SOURCE_CONTRIBUTION_LIMITS.archivePartBytes});
    assert.ok(bytes.length === part.bytes && bytesDigest(bytes) === part.sha256, 'contribution_report_part_hash'); buffers.push(bytes);
  }
  const bytes = Buffer.concat(buffers);
  assert.ok(bytes.length === file.bytes && bytesDigest(bytes) === file.sha256, 'contribution_report_file_hash');
  const report = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
  assert.ok(digest(report) === archive.reportDigest && report.market === proof.market
    && !['saved_snapshot_technical_repair', 'technical_repair'].includes(report.mode)
    && !(report.rawArchiveDependencies?.length), 'contribution_report_identity');
  assert.ok(['paidInputWitness', 'sourceInputWitness'].includes(input.witnessField), 'contribution_witness_field');
  const witness = signed(report[input.witnessField], 'contribution_witness_checksum');
  assert.ok(witness.version === 1 && witness.kind === proof.producerKind && witness.sourceId === proof.sourceId
    && digest(witness) === input.witnessSha256 && identity(witness.producer)
    && digest(witness.producer) === digest(proof.producer), 'contribution_witness_identity');
  const snapshot = witness.snapshot, normalized = witness.normalized;
  assert.ok(object(snapshot) && snapshot.root === input.snapshotRoot && rawKind(snapshot.root)
    && !['encar-reports', 'che168-journal'].includes(rawKind(snapshot.root))
    && snapshot.completeSha256 === input.completeSha256 && SHA.test(snapshot.completeSha256 || '')
    && snapshot.pages === input.pages && integer(snapshot.pages, 100000, 1)
    && snapshot.pagesSha256 === input.pagesSha256 && SHA.test(snapshot.pagesSha256 || '')
    && snapshot.rows === input.rawRows && integer(snapshot.rows, 1000000, 1)
    && Number.isFinite(Date.parse(snapshot.completedAt)), 'contribution_snapshot_identity');
  assert.ok(normalized?.rows === input.normalizedRows && integer(normalized.rows, SOURCE_CONTRIBUTION_LIMITS.rows, 1)
    && normalized.rows <= snapshot.rows && normalized.idsSha256 === input.normalizedIdsSha256
    && SHA.test(normalized.idsSha256 || '') && normalized.rowsSha256 === input.normalizedRowsSha256
    && SHA.test(normalized.rowsSha256 || ''), 'contribution_normalized_identity');
  const kind = rawKind(snapshot.root), defaultLeaf = kind.startsWith('che168-') ? 'manifest.json' : 'complete.json';
  assert.ok(kind === 'nonjp-intake' ? snapshot.root.startsWith(`catalog/nonjp-intake/v1/${proof.market}/`)
    : kind === 'encar-snapshot' ? proof.market === 'korea' && proof.sourceId === 'encar_direct'
      && proof.producerKind === 'independent_paid_encar_snapshot_v1'
    : proof.market === 'china' && proof.sourceId === 'autohome_used_china_open', 'contribution_snapshot_market');
  const receiptKey = snapshot.receiptKey || snapshot.root + '/' + defaultLeaf;
  assert.ok(receiptKey === snapshot.root + '/' + defaultLeaf
    || kind === 'nonjp-intake' && receiptKey === snapshot.root + '/source-input.json', 'contribution_snapshot_receipt_scope');
  assert.equal(input.snapshotReceiptKey || receiptKey, receiptKey, 'contribution_snapshot_receipt_changed');
  const complete = await read(receiptKey, 2 * 1024 ** 2);
  assert.equal(digest(complete), snapshot.completeSha256, 'contribution_snapshot_changed');
  if (kind === 'encar-snapshot') assert.ok(complete?.pages === snapshot.pages && complete.count === snapshot.rows
    && complete.completedAt === snapshot.completedAt, 'contribution_snapshot_count');
  else assert.ok(object(complete) && complete.version === 1, 'contribution_snapshot_receipt');
  return {witness, requiredReferences: [{kind, root: snapshot.root},
    {kind: 'nonjp-intake', root, sha256: input.archiveManifestSha256}]};
}

/** Read the persisted input witness and every actual materialized chunk. No
 * caller completeness flag or provider request is used. Unknown source IDs
 * are rejected before their proof or internal chunks are downloaded. */
export async function verifySourceContribution({storage, key, sha256, internalManifest, publicManifest,
  stage = 'internal', deadline = Date.now() + SOURCE_CONTRIBUTION_LIMITS.workMs}) {
  const reference = sourceContributionReference({key, sha256}, stage), limits = SOURCE_CONTRIBUTION_LIMITS;
  assert.ok(deadline > Date.now() && deadline <= Date.now() + limits.workMs, 'contribution_deadline');
  let readBytes = 0, reads = 0;
  const read = async (path, maxBytes) => {
    assert.ok(Date.now() < deadline && ++reads <= 15000, 'contribution_work_bound');
    const result = await readOwnedJsonBounded({storage, key: path, maxBytes, deadline});
    assert.ok(result?.found === true && integer(result.bytes, maxBytes, 1), 'contribution_object_missing');
    readBytes += result.bytes; assert.ok(readBytes <= limits.totalBytes, 'contribution_total_bytes'); return result.value;
  };
  const proof = signed(await read(key, limits.partBytes), 'contribution_checksum');
  assert.ok(digest(proof) === sha256 && proof.version === 1 && proof.kind === 'independent_source_snapshot_v1'
    && /^independent_[a-z0-9_]+_v1$/.test(proof.producerKind || '') && proof.stage === stage
    && proof.sourceId === reference.sourceId && proof.generationId === reference.generationId
    && proof.market === CONTRIBUTION_SOURCE_MARKETS[proof.sourceId] && identity(proof.producer), 'contribution_identity');
  const {witness, requiredReferences} = await readArchiveWitness(read, proof);
  const materialization = proof.materialization;
  assert.ok(COMMIT.test(materialization?.sourceSha || '') && SHA.test(materialization.calculationVersion || '')
    && materialization.rows === witness.normalized.rows && integer(materialization.rows, limits.rows, 1)
    && integer(materialization.normalizedRows, materialization.rows, 1)
    && integer(materialization.publicRows, materialization.normalizedRows)
    && materialization.idsSha256 === witness.normalized.idsSha256
    && Array.isArray(materialization.parts) && materialization.parts.length > 0
    && materialization.parts.length <= limits.parts, 'contribution_materialization');
  const normalized = new Map(), published = new Map(), inputHash = createHash('sha256').update('['), idsHash = createHash('sha256').update('[');
  let count = 0, previousId = '';
  for (const [index, part] of materialization.parts.entries()) {
    const partKey = sourceContributionKey(proof.generationId, proof.sourceId).replace('/internal.json', `/rows/${String(index).padStart(4, '0')}.json`);
    assert.ok(part?.key === partKey && SHA.test(part.sha256 || '') && SHA.test(part.idsSha256 || '')
      && integer(part.bytes, limits.partBytes, 1) && integer(part.rows, limits.partRows, 1), 'contribution_part_descriptor');
    const value = await read(part.key, limits.partBytes);
    assert.ok(value?.version === 1 && value.generationId === proof.generationId && value.sourceId === proof.sourceId
      && Array.isArray(value.rows) && value.rows.length === part.rows && digest(value) === part.sha256
      && Buffer.byteLength(JSON.stringify(value)) === part.bytes
      && digest(value.rows.map(row => row.id)) === part.idsSha256, 'contribution_part_changed');
    for (const row of value.rows) {
      assert.ok(typeof row?.id === 'string' && /^[a-zA-Z0-9_-]{1,200}$/.test(row.id) && row.id > previousId
        && SHA.test(row.inputSha256 || '') && (row.normalizedSha256 === null || SHA.test(row.normalizedSha256 || ''))
        && (row.publicSha256 === null || SHA.test(row.publicSha256 || ''))
        && (row.publicSha256 === null || row.normalizedSha256 !== null), 'contribution_row_witness');
      if (count) {inputHash.update(','); idsHash.update(',');}
      inputHash.update(JSON.stringify([row.id, row.inputSha256])); idsHash.update(JSON.stringify(row.id));
      previousId = row.id; count++;
      assert.ok(count <= limits.rows, 'contribution_rows_bound');
      if (row.normalizedSha256) normalized.set(row.id, row.normalizedSha256);
      if (row.publicSha256) published.set(row.id, row.publicSha256);
    }
  }
  assert.ok(count === materialization.rows && inputHash.update(']').digest('hex') === witness.normalized.rowsSha256
    && idsHash.update(']').digest('hex') === witness.normalized.idsSha256
    && normalized.size === materialization.normalizedRows && published.size === materialization.publicRows, 'contribution_input_coverage');
  const referenceMap = new Map(refs(proof.references).map(row => [row.root, row]));
  const reports = new Map();
  async function outputChunks(output, expected, keys, isInternal) {
    assert.ok(output && Array.isArray(output.chunks) && output.chunks.length > 0 && output.chunks.length <= limits.chunks
      && digest(output.chunks.map(row => row.key)) === digest(keys) && new Set(keys).size === keys.length
      && output.count === expected.size, 'contribution_output_coverage');
    const seen = new Set();
    for (const part of output.chunks) {
      const prefix = isInternal ? `catalog/internal/offers/${proof.sourceId}/${proof.generationId}-`
        : `catalog/generations/${proof.generationId}/offers/${proof.market}/`;
      assert.ok(part.key.startsWith(prefix) && part.key.endsWith('.json') && SHA.test(part.sha256 || '')
        && SHA.test(part.idsSha256 || '') && integer(part.bytes, limits.chunkBytes, 1)
        && integer(part.rows, limits.chunkRows, 1), 'contribution_chunk_descriptor');
      const rows = await read(part.key, limits.chunkBytes);
      assert.ok(Array.isArray(rows) && rows.length === part.rows && digest(rows) === part.sha256
        && Buffer.byteLength(JSON.stringify(rows)) === part.bytes
        && digest(rows.map(row => row.id).sort(ascii)) === part.idsSha256, 'contribution_chunk_changed');
      for (const row of rows) {
        assert.ok(row && row.sourceId === proof.sourceId && row.market === proof.market && typeof row.id === 'string'
          && !seen.has(row.id) && expected.get(row.id) === digest(row), 'contribution_output_row_changed');
        if (proof.producerKind === 'independent_paid_encar_snapshot_v1') assert.equal(row.operational?.provider,
          'auto_api_encar', 'contribution_paid_provider_missing');
        seen.add(row.id);
        if (row.operational?.provider === 'auto_api_encar') {
          assert.ok(proof.sourceId === 'encar_direct' && proof.market === 'korea', 'contribution_paid_source');
          const at = Date.parse(row.operational?.lastSeenAt || row.updatedAt || row.operational?.sourcePublishedAt || row.firstSeenAt || '');
          assert.ok(Number.isFinite(at) && at > 0 && at === Date.parse(witness.snapshot.completedAt), 'contribution_report_observation');
          const root = `catalog/paid-encar-reports/v1/${at}`;
          if (!reports.has(root)) {
            const complete = await read(root + '/complete.json', 2 * 1024 ** 2);
            assert.ok(complete?.version === 1 && complete.provider === 'auto_api_encar' && complete.observedAtMs === at
              && Date.parse(complete.observedAt) === at
              && `catalog/intake-staging/encar/${complete.sourceRunId}/${complete.sourceRunAttempt}` === witness.snapshot.root,
            'contribution_report_identity');
            const ref = {kind: 'encar-reports', root, sha256: digest(complete)}; reports.set(root, ref);
          }
          const explicit = row.operational.paidEncarReportSnapshot;
          if (explicit !== undefined) assert.ok(explicit && Date.parse(explicit.observedAt) === at
            && `catalog/intake-staging/encar/${explicit.run}/${explicit.attempt}` === witness.snapshot.root, 'contribution_report_explicit');
        }
      }
    }
    assert.equal(seen.size, expected.size, 'contribution_output_missing_row');
  }
  const source = internalManifest?.sources?.[proof.sourceId], internal = proof.output?.internal;
  assert.ok(source && internal?.sourceId === proof.sourceId && internal.count === source.count
    && internal.sourceSha256 === digest(source), 'contribution_internal_source_changed');
  if (internalManifest.generationId === proof.generationId) assert.equal(internal.manifestSha256, digest(internalManifest), 'contribution_internal_manifest_changed');
  else assert.ok(GENERATION.test(internalManifest.generationId) && SHA.test(internal.manifestSha256 || ''), 'contribution_carried_source');
  await outputChunks(internal, normalized, source.chunks, true);
  if (stage === 'public') {
    assert.ok(publicManifest?.generationId === proof.generationId && proof.output.public?.manifestSha256 === digest(publicManifest), 'contribution_public_manifest_changed');
    const key = sourceContributionKey(proof.generationId, proof.sourceId), old = signed(await read(key, limits.partBytes), 'contribution_internal_checksum');
    assert.ok(proof.internalReceipt?.key === key && proof.internalReceipt.sha256 === digest(old), 'contribution_internal_receipt_changed');
    const {checksum: _oldChecksum, ...oldBody} = old, {checksum: _checksum, internalReceipt: _receipt, ...body} = proof;
    assert.ok(digest({...body, stage: 'internal', output: {internal: body.output.internal}, references: old.references}) === digest(oldBody), 'contribution_phase_changed');
    const market = publicManifest.markets?.[proof.market];
    assert.ok(market?.count === proof.output.public.count, 'contribution_public_count');
    await outputChunks(proof.output.public, published, market.chunks.map(chunk => String(chunk).startsWith('catalog/')
      ? chunk : `catalog/generations/${proof.generationId}/offers/${proof.market}/${chunk}.json`), false);
  }
  const required = [...requiredReferences, ...reports.values()]; requireReferences([...referenceMap.values()], required);
  const primary = referenceMap.get(witness.snapshot.root);
  assert.ok(!primary.sha256 || primary.sha256 === witness.snapshot.completeSha256, 'contribution_snapshot_reference_changed');
  return {sourceId: proof.sourceId, market: proof.market, key, sha256, generationId: proof.generationId,
    sourceSha256: digest(source), count: source.count, references: [...referenceMap.values()], readBytes, reads};
}
