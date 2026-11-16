import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {sourceContributionKey} from '../../apps/web/lib/catalog/source-contribution-reader.mjs';

export const contributionDigest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const bytesDigest = bytes => createHash('sha256').update(bytes).digest('hex');
export const signContribution = body => ({...body, checksum: contributionDigest(body)});

export function sourceContributionFixture({market = 'korea', sourceId = 'encar_direct'} = {}) {
  const hash = contributionDigest, generationId = 'gen_2000_contribution', at = '2026-11-16T12:00:00.000Z';
  const owner = {runId: '43870000000', attempt: '1', revision: 'a'.repeat(40)};
  const producer = {runId: owner.runId, attempt: owner.attempt, sourceSha: 'c'.repeat(40)};
  const rows = [1, 2].map(id => ({id: sourceId + '_' + id, sourceId, market, sourcePrice: 1000 + id, updatedAt: at,
    operational: {provider: market === 'korea' ? 'auto_api_encar' : 'auto_api_che168', lastSeenAt: at}}));
  const excluded = {id: sourceId + '_3', sourceId, market, sourcePrice: 0};
  const input = [...rows, excluded].map(row => [row.id, hash(row)]);
  const snapshotRoot = market === 'korea' ? 'catalog/intake-staging/encar/43570782014/1'
    : 'catalog/provider-snapshots/che168/' + 'd'.repeat(64);
  const snapshot = {version: 1, pages: 1, count: 3, completedAt: at};
  const witness = signContribution({version: 1, kind: market === 'korea' ? 'independent_paid_encar_snapshot_v1' : 'independent_che168_snapshot_v1',
    sourceId, producer, snapshot: {root: snapshotRoot, completeSha256: hash(snapshot), pages: 1,
      pagesSha256: hash([[1, hash(rows), 3]]), rows: 3, completedAt: at},
    normalized: {rows: 3, idsSha256: hash(input.map(([id]) => id)), rowsSha256: hash(input)}});
  const witnessField = market === 'korea' ? 'paidInputWitness' : 'sourceInputWitness';
  const report = {version: 1, market, completed: true, sources: [{sourceId}], [witnessField]: witness};
  const root = `catalog/nonjp-intake/v1/${market}/${owner.runId}/${owner.attempt}`;
  const objects = new Map(), reads = []; let pending = 0, maximumPending = 0;
  function archiveFile(name, bytes) {
    const sha256 = bytesDigest(bytes), key = `${root}/files/${name}/0-${sha256}.json`;
    const part = {key, bytes: bytes.length, sha256};
    objects.set(key, {version: 1, encoding: 'gzip-base64', bytes: bytes.length, sha256, payload: gzipSync(bytes).toString('base64')});
    return {name, bytes: bytes.length, sha256, parts: [part]};
  }
  const files = [archiveFile('report.json', Buffer.from(JSON.stringify(report))),
    archiveFile(sourceId + '-000001.jsonl', Buffer.from([...rows, excluded].map(offer => JSON.stringify({offer})).join('\n') + '\n'))];
  const archive = {version: 1, kind: 'nonjp-intake', market, owner, reportDigest: hash(report),
    collection: {complete: true, qualityStatus: 'complete'}, files, totalBytes: files.reduce((sum, row) => sum + row.bytes, 0)};
  objects.set(root + '/complete.json', archive);
  objects.set(snapshotRoot + (market === 'korea' ? '/complete.json' : '/manifest.json'), snapshot);
  const internalKey = `catalog/internal/offers/${sourceId}/${generationId}-chunk-0001.json`;
  const publicKey = `catalog/generations/${generationId}/offers/${market}/chunk-0001.json`;
  const internalManifest = {generationId, sources: {[sourceId]: {count: 2, chunks: [internalKey], updatedAt: at}}};
  const publicManifest = {version: 2, generationId, markets: {[market]: {count: 2, chunks: ['chunk-0001']}}};
  objects.set(internalKey, rows); objects.set(publicKey, rows);
  const partKey = sourceContributionKey(generationId, sourceId).replace('/internal.json', '/rows/0000.json');
  const part = {version: 1, generationId, sourceId, rows: input.map(([id, inputSha256], index) => ({id, inputSha256,
    normalizedSha256: index < 2 ? hash(rows[index]) : null, publicSha256: index < 2 ? hash(rows[index]) : null}))};
  objects.set(partKey, part);
  const references = [{kind: market === 'korea' ? 'encar-snapshot' : 'che168-snapshot', root: snapshotRoot},
    {kind: 'nonjp-intake', root, sha256: hash(archive)}];
  const reportRoot = `catalog/paid-encar-reports/v1/${Date.parse(at)}`;
  if (market === 'korea') {
    const complete = {version: 1, provider: 'auto_api_encar', observedAtMs: Date.parse(at), observedAt: at,
      sourceRunId: '43570782014', sourceRunAttempt: '1'};
    objects.set(reportRoot + '/complete.json', complete); references.push({kind: 'encar-reports', root: reportRoot, sha256: hash(complete)});
  }
  references.sort((a, b) => a.root.localeCompare(b.root));
  const chunk = key => ({key, sha256: hash(rows), bytes: Buffer.byteLength(JSON.stringify(rows)), rows: 2,
    idsSha256: hash(rows.map(row => row.id).sort())});
  const proof = signContribution({version: 1, kind: 'independent_source_snapshot_v1', producerKind: witness.kind,
    stage: 'internal', generationId, sourceId, market, producer,
    input: {snapshotRoot, completeSha256: hash(snapshot), pages: 1, pagesSha256: witness.snapshot.pagesSha256, rawRows: 3,
      archiveRoot: root, archiveManifestSha256: hash(archive), archiveReportSha256: hash(report), witnessField,
      witnessSha256: hash(witness), normalizedRows: 3, normalizedIdsSha256: witness.normalized.idsSha256,
      normalizedRowsSha256: witness.normalized.rowsSha256},
    materialization: {sourceSha: 'e'.repeat(40), calculationVersion: 'f'.repeat(64), rows: 3, normalizedRows: 2, publicRows: 2,
      idsSha256: witness.normalized.idsSha256, parts: [{key: partKey, sha256: hash(part), bytes: Buffer.byteLength(JSON.stringify(part)),
        rows: 3, idsSha256: hash(part.rows.map(row => row.id))}]},
    output: {internal: {manifestSha256: hash(internalManifest), sourceId, sourceSha256: hash(internalManifest.sources[sourceId]), count: 2, chunks: [chunk(internalKey)]}},
    references});
  const key = sourceContributionKey(generationId, sourceId), reference = {key, sha256: hash(proof)};
  objects.set(key, proof);
  const {checksum, ...body} = proof;
  const publicProof = signContribution({...body, stage: 'public', internalReceipt: reference,
    output: {...body.output, public: {manifestSha256: hash(publicManifest), count: 2, chunks: [chunk(publicKey)]}}});
  const publicReference = {key: sourceContributionKey(generationId, sourceId, 'public'), sha256: hash(publicProof)};
  objects.set(publicReference.key, publicProof);
  const storage = {driver: 'object', async readJsonBounded(key, maxBytes) {
    reads.push(key); pending++; maximumPending = Math.max(maximumPending, pending);
    try {
      await Promise.resolve();
      const value = objects.has(key) ? structuredClone(objects.get(key)) : null;
      const bytes = value === null ? 0 : Buffer.byteLength(JSON.stringify(value));
      assert.ok(bytes <= maxBytes, 'fixture_read_bound'); return {found: value !== null, value, bytes};
    } finally {pending--;}
  }};
  return {storage, objects, reads, rows, proof, publicProof, reference, publicReference, internalManifest, publicManifest,
    internalKey, publicKey, partKey, archive, archiveRoot: root, witness, reportRoot, snapshotRoot,
    maximumPending: () => maximumPending};
}
