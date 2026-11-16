import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {buildRawInternalProvenance, assertRawInternalProvenance, rawInternalPointerDescriptor,
  rawInternalProvenanceKey} from '../apps/web/lib/catalog/raw-internal-provenance.mjs';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const manifest = {generationId: 'gen_2000_internal', sources: {encar_direct: {count: 1,
  chunks: ['catalog/internal/offers/encar_direct/gen_1000_older-chunk-0001.json']}}};
const ref = {kind: 'encar-snapshot', root: 'catalog/intake-staging/encar/43870000000/1', sha256: 'a'.repeat(64)};

test('immutable internal proof binds the actual borrowed chunk paths and preserves known roots without asserting row lineage', () => {
  const proof = buildRawInternalProvenance({manifest, references: [ref, {...ref}]});
  assert.equal(proof.count, 1); assert.equal(proof.complete, false);
  assert.deepEqual(proof.unknownSources, ['encar_direct']);
  assert.equal(proof.reason, 'internal_row_lineage_unproven');
  assert.deepEqual(proof.references, [ref]);
  assertRawInternalProvenance(proof, manifest);
  const descriptor = rawInternalPointerDescriptor(manifest, proof);
  assert.equal(descriptor.provenanceSha256, digest(proof));
  assert.equal(descriptor.sha256, digest(manifest));
  assert.throws(() => assertRawInternalProvenance({...proof, complete: true}, manifest), /provenance_changed/);
  assert.throws(() => assertRawInternalProvenance({...proof, unknownSources: []}, manifest), /provenance_changed/);
  assert.throws(() => assertRawInternalProvenance(proof, {...manifest, sources: {}}), /empty_references/);
});

test('absence and a proved empty internal manifest are complete; a legacy present manifest without proof is not', () => {
  assert.deepEqual(rawInternalPointerDescriptor(null), {sha256: digest(null), complete: true, references: [], provenanceSha256: null});
  assert.equal(rawInternalPointerDescriptor(manifest).complete, false);
  const empty = {generationId: 'gen_2001_empty', sources: {}};
  assert.equal(rawInternalPointerDescriptor(empty).complete, false);
  const proof = buildRawInternalProvenance({manifest: empty});
  assert.equal(rawInternalPointerDescriptor(empty, proof).complete, true);
  assert.throws(() => buildRawInternalProvenance({manifest: empty, references: [ref]}), /empty_references/);
});

test('ambiguous internal source/chunk identities and conflicting digest claims fail closed', () => {
  for (const sources of [{encar_direct: {count: 1, chunks: []}}, {encar_direct: {count: 0, chunks: manifest.sources.encar_direct.chunks}},
    {encar_direct: {count: 1, chunks: ['catalog/internal/offers/other/gen_2000_x.json']}},
    {encar_direct: {count: 1, chunks: ['catalog/internal/offers/encar_direct/../x.json']}}]) {
    assert.throws(() => buildRawInternalProvenance({manifest: {...manifest, sources}}), /raw_internal_/);
  }
  assert.throws(() => buildRawInternalProvenance({manifest, references: [ref, {...ref, sha256: 'b'.repeat(64)}]}), /reference_conflict/);
  assert.throws(() => rawInternalProvenanceKey('../manifest'), /generation/);
  assert.equal(rawInternalProvenanceKey(manifest.generationId),
    'catalog/raw-feed-coordination/v1/internal/gen_2000_internal/provenance.json');
});
