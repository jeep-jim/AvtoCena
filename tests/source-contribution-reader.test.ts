import assert from 'node:assert/strict';
import test from 'node:test';
import {gzipSync} from 'node:zlib';
import {verifySourceContribution, sourceContributionKey, CONTRIBUTION_SOURCE_MARKETS} from '../apps/web/lib/catalog/source-contribution-reader.mjs';
import {buildRawInternalProvenance, verifiedRawInternalPointerDescriptor} from '../apps/web/lib/catalog/raw-internal-provenance.mjs';
import {REQUIRED_CATALOG_SOURCES, isAllowedCatalogSourceId} from '../apps/web/lib/catalog/required-catalog-sources';
import {sourceContributionFixture, contributionDigest as hash, signContribution} from './helpers/source-contribution-fixture.mjs';

const verify = f => verifySourceContribution({storage: f.storage, ...f.reference, internalManifest: f.internalManifest});
function replaceProof(f, value) {const {checksum, ...body} = value; f.proof = signContribution(body); f.objects.set(f.reference.key, f.proof); f.reference.sha256 = hash(f.proof);}

test('generic reader verifies both immutable phases, all input IDs, exact actual row bytes and report closure with one bounded read at a time', async () => {
  const f = sourceContributionFixture(), result = await verify(f);
  assert.equal(result.count, 2); assert.equal(result.sourceId, 'encar_direct');
  assert.deepEqual(result.references, f.proof.references); assert.equal(f.maximumPending(), 1);
  assert.equal(f.reads.some(key => key.includes('/pages/')), false, 'the saved independent witness avoids replaying supplier pages');
  const published = await verifySourceContribution({storage: f.storage, ...f.publicReference,
    internalManifest: f.internalManifest, publicManifest: f.publicManifest, stage: 'public'});
  assert.equal(published.count, 2);
});

test('the same standard witness handles an approved non-Korea source, while unknown and Japan IDs are rejected before any download', async () => {
  const f = sourceContributionFixture({market: 'china', sourceId: 'autohome_used_china_open'});
  assert.equal((await verify(f)).market, 'china');
  const before = f.reads.length;
  for (const sourceId of ['ajes_japan', 'unknown_source']) {
    await assert.rejects(verifySourceContribution({storage: f.storage,
      key: `catalog/raw-feed-coordination/v1/contributions/gen_2000_contribution/${sourceId}/internal.json`,
      sha256: 'a'.repeat(64), internalManifest: f.internalManifest}), /scope|reference/);
  }
  assert.equal(f.reads.length, before);
  const approved = Object.fromEntries(Object.entries(REQUIRED_CATALOG_SOURCES).filter(([market]) => market !== 'japan')
    .flatMap(([market, sources]) => sources.map(source => [source.sourceId, market])));
  // The proof namespace includes historical source IDs; it is not the current
  // collection/publication allowlist. Name its sole retired compatibility entry.
  assert.equal(Object.hasOwn(approved, 'mobile_de_open'), false);
  assert.deepEqual(CONTRIBUTION_SOURCE_MARKETS, {...approved, mobile_de_open: 'europe'});
  const historical = sourceContributionFixture({market: 'europe', sourceId: 'mobile_de_open'});
  await assert.rejects(verify(historical), /snapshot_market/, "a Che168 witness cannot authorize a retired European source");
  assert.equal(isAllowedCatalogSourceId('europe', 'mobile_de_open'), false);
});

test('a borrowed source can carry its witness into a new global generation only with the exact source entry and actual chunks', async () => {
  const f = sourceContributionFixture();
  f.internalManifest = {...f.internalManifest, generationId: 'gen_2001_newmarket', sources: {...f.internalManifest.sources,
    unknown_legacy: {count: 1, chunks: ['catalog/internal/offers/unknown_legacy/gen_1_legacy-chunk-1.json']}}};
  assert.equal((await verify(f)).count, 2);
  assert.equal(f.reads.some(key => key.includes('unknown_legacy')), false);
  f.internalManifest.sources.encar_direct.updatedAt = 'changed';
  await assert.rejects(verify(f), /internal_source_changed/);
});

test('same-ID changed raw values, missing chunks, changed producer receipts and missing paid reports cannot become a complete source', async () => {
  for (const [mutate, message] of [
    [f => {f.objects.get(f.internalKey)[0].sourcePrice++;}, /chunk_changed/],
    [f => {f.objects.delete(f.internalKey);}, /object_missing/],
    [f => {f.objects.get(f.snapshotRoot + '/complete.json').count++;}, /snapshot_changed/],
    [f => {f.objects.delete(f.reportRoot + '/complete.json');}, /object_missing/],
    [f => {const value = structuredClone(f.proof); value.references = value.references.filter(row => row.kind !== 'encar-reports'); replaceProof(f, value);}, /closure_missing/],
  ] as any) {const f = sourceContributionFixture(); mutate(f); await assert.rejects(verify(f), message);}
});

test('an altered materialization input hash is rejected even when its part and enclosing proof checksums are recomputed', async () => {
  const f = sourceContributionFixture(), part = f.objects.get(f.partKey);
  part.rows[0].inputSha256 = '9'.repeat(64);
  const proof = structuredClone(f.proof); proof.materialization.parts[0].sha256 = hash(part);
  replaceProof(f, proof);
  await assert.rejects(verify(f), /input_coverage/);
});

test('archive report decompression has a hard decoded-byte limit and a report witness cannot be replaced by a complete flag', async () => {
  const f = sourceContributionFixture(), file = f.archive.files.find(row => row.name === 'report.json'), part = f.objects.get(file.parts[0].key);
  part.payload = gzipSync(Buffer.alloc(2 * 1024 ** 2 + 1)).toString('base64');
  await assert.rejects(verify(f));
  const g = sourceContributionFixture(), proof = structuredClone(g.proof);
  proof.input.witnessField = 'complete'; replaceProof(g, proof);
  await assert.rejects(verify(g), /witness_field/);
});

test('public evidence cannot change the input/materialization identity of its already committed internal phase', async () => {
  const f = sourceContributionFixture(), proof = structuredClone(f.publicProof);
  proof.materialization.sourceSha = '1'.repeat(40);
  const {checksum, ...body} = proof; f.publicProof = signContribution(body);
  f.objects.set(f.publicReference.key, f.publicProof); f.publicReference.sha256 = hash(f.publicProof);
  await assert.rejects(verifySourceContribution({storage: f.storage, ...f.publicReference,
    internalManifest: f.internalManifest, publicManifest: f.publicManifest, stage: 'public'}), /phase_changed/);
});

test('internal v2 retires inherited roots only after every nonempty source has actual independently checked contribution evidence', async () => {
  const f = sourceContributionFixture(), contribution = await verify(f);
  const old = {kind: 'encar-snapshot', root: 'catalog/intake-staging/encar/111/1'};
  let provenance = buildRawInternalProvenance({manifest: f.internalManifest, references: [old], contributions: [contribution]});
  assert.equal(provenance.complete, true); assert.equal(provenance.references.some(row => row.root === old.root), false);
  assert.equal((await verifiedRawInternalPointerDescriptor({storage: f.storage, manifest: f.internalManifest, provenance})).complete, true);
  const mixed = {...f.internalManifest, generationId: 'gen_2001_mixed', sources: {...f.internalManifest.sources,
    unknown_legacy: {count: 1, chunks: ['catalog/internal/offers/unknown_legacy/gen_1_old.json']}}};
  provenance = buildRawInternalProvenance({manifest: mixed, references: [old], contributions: [contribution]});
  assert.equal(provenance.complete, false); assert.deepEqual(provenance.unknownSources, ['unknown_legacy']);
  assert.ok(provenance.references.some(row => row.root === old.root));
  await verifiedRawInternalPointerDescriptor({storage: f.storage, manifest: mixed, provenance});
  assert.equal(f.reads.some(key => key.includes('unknown_legacy')), false);
  f.objects.get(f.internalKey)[0].sourcePrice++;
  await assert.rejects(verifiedRawInternalPointerDescriptor({storage: f.storage, manifest: mixed, provenance}), /chunk_changed/);
});

test('proof namespace is outside ordinary generation cleanup and elapsed work budgets stop reads', async () => {
  assert.equal(sourceContributionKey('gen_2000_contribution', 'encar_direct'),
    'catalog/raw-feed-coordination/v1/contributions/gen_2000_contribution/encar_direct/internal.json');
  const f = sourceContributionFixture();
  await assert.rejects(verifySourceContribution({storage: f.storage, ...f.reference,
    internalManifest: f.internalManifest, deadline: Date.now() - 1}), /deadline/);
  assert.deepEqual(f.reads, []);
});
