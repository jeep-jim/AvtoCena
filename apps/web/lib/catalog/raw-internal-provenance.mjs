import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {sourceContributionReference, verifySourceContribution} from './source-contribution-reader.mjs';

export const RAW_INTERNAL_MANIFEST_KEY = 'catalog/internal/manifest.json';
export const RAW_INTERNAL_COORDINATION_ID = 'internal_catalog';
const SHA = /^[a-f0-9]{64}$/, GENERATION = /^gen_\d+_[a-z0-9-]+$/;
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function rawInternalProvenanceKey(generationId) {
  assert.match(generationId || '', GENERATION, 'raw_internal_generation');
  return `catalog/raw-feed-coordination/v1/internal/${generationId}/provenance.json`;
}

function sources(manifest) {
  rawInternalProvenanceKey(manifest?.generationId);
  assert.ok(object(manifest.sources) && Object.keys(manifest.sources).length <= 100, 'raw_internal_sources');
  let count = 0;
  for (const [sourceId, entry] of Object.entries(manifest.sources)) {
    assert.match(sourceId, /^[a-zA-Z0-9_-]{1,100}$/, 'raw_internal_source');
    assert.ok(Number.isSafeInteger(entry?.count) && entry.count >= 0 && Array.isArray(entry.chunks)
      && entry.chunks.length <= 10000 && new Set(entry.chunks).size === entry.chunks.length
      && (entry.count === 0 ? entry.chunks.length === 0 : entry.chunks.length > 0), 'raw_internal_source_chunks');
    for (const key of entry.chunks) assert.ok(typeof key === 'string'
      && key.startsWith(`catalog/internal/offers/${sourceId}/`) && key.endsWith('.json')
      && key.length <= 512 && !key.split('/').some(part => !part || part === '.' || part === '..'), 'raw_internal_chunk_scope');
    count += entry.count;
    assert.ok(Number.isSafeInteger(count), 'raw_internal_count');
  }
  return {count, sourceIds: Object.keys(manifest.sources).filter(id => manifest.sources[id].count > 0).sort()};
}

// Exact root eligibility remains enforced by the coordinator. This small app
// module only canonicalizes references; the runtime also requires each one to
// be an existing live registry root with the same kind.
function references(values) {
  assert.ok(Array.isArray(values) && values.length <= 4096, 'raw_internal_reference_limit');
  const roots = new Map();
  for (const value of values) {
    assert.ok(object(value) && ['che168-snapshot', 'che168-replica', 'che168-journal',
      'encar-snapshot', 'encar-reports', 'nonjp-intake'].includes(value.kind)
      && typeof value.root === 'string' && /^catalog\/[a-zA-Z0-9_/-]{1,500}$/.test(value.root)
      && !value.root.split('/').some(part => !part || part === '.' || part === '..')
      && (value.sha256 === undefined || SHA.test(value.sha256)), 'raw_internal_reference');
    const clean = {kind: value.kind, root: value.root, ...(value.sha256 ? {sha256: value.sha256} : {})};
    const previous = roots.get(clean.root);
    assert.ok(!previous || previous.kind === clean.kind, 'raw_internal_reference_kind');
    if (previous?.sha256 && clean.sha256) assert.equal(previous.sha256, clean.sha256, 'raw_internal_reference_conflict');
    roots.set(clean.root, previous?.sha256 ? previous : clean);
  }
  return [...roots.values()].sort((a, b) => a.root.localeCompare(b.root));
}

/** A manifest/chunk list is not row lineage. Until the retained fields and
 * internal-only rows have an independently verified materialization proof,
 * every nonempty internal catalog stays unknown even with known raw roots. */
export function buildRawInternalProvenance({manifest, references: values = [], contributions}) {
  const identity = sources(manifest), refs = references(values);
  assert.ok(identity.count > 0 || refs.length === 0, 'raw_internal_empty_references');
  if (contributions !== undefined) {
    assert.ok(Array.isArray(contributions) && contributions.length <= 100, 'raw_internal_contribution_limit');
    const seen = new Set(), proofs = contributions.map(value => {
      const reference = sourceContributionReference(value), source = manifest.sources[reference.sourceId];
      assert.ok(value.sourceId === reference.sourceId && !seen.has(value.sourceId) && source?.count > 0
        && value.count === source.count && value.sourceSha256 === digest(source), 'raw_internal_contribution_source');
      seen.add(value.sourceId);
      return {sourceId: value.sourceId, key: reference.key, sha256: reference.sha256,
        sourceSha256: value.sourceSha256, count: value.count, references: references(value.references)};
    }).sort((a, b) => a.sourceId.localeCompare(b.sourceId));
    const unknownSources = identity.sourceIds.filter(id => !seen.has(id));
    const complete = unknownSources.length === 0;
    return {version: 2, generationId: manifest.generationId, manifestSha256: digest(manifest), count: identity.count,
      complete, references: references([...(complete ? [] : refs), ...proofs.flatMap(row => row.references)]),
      unknownSources, reason: complete ? null : 'internal_row_lineage_unproven', contributions: proofs};
  }
  return {version: 1, generationId: manifest.generationId, manifestSha256: digest(manifest),
    count: identity.count, complete: identity.count === 0, references: refs,
    unknownSources: identity.sourceIds, reason: identity.count ? 'internal_row_lineage_unproven' : null};
}

export function assertRawInternalProvenance(value, manifest) {
  assert.ok(value?.version === 1 || value?.version === 2, 'raw_internal_provenance_version');
  const expected = buildRawInternalProvenance({manifest, references: value?.references,
    ...(value.version === 2 ? {contributions: value.contributions} : {})});
  assert.equal(digest(value), digest(expected), 'raw_internal_provenance_changed');
  return expected;
}

/** Completeness for a nonempty reserve comes only from exact persisted input
 * witnesses and actual chunks. GC/bootstrap callers must use this async check
 * before accepting a complete nonempty descriptor. */
export async function verifyRawInternalProvenance({storage, manifest, provenance, deadline = Date.now() + 300000}) {
  const value = assertRawInternalProvenance(provenance, manifest);
  if (value.version === 1) return value;
  const contributions = [];
  for (const proof of value.contributions) {
    const verified = await verifySourceContribution({storage, key: proof.key, sha256: proof.sha256,
      internalManifest: manifest, deadline});
    contributions.push(verified);
  }
  const actual = buildRawInternalProvenance({manifest, references: value.references, contributions});
  assert.equal(digest(actual), digest(value), 'raw_internal_contribution_changed');
  return actual;
}

export async function verifiedRawInternalPointerDescriptor({storage, manifest, provenance = null, deadline}) {
  if (manifest !== null && provenance !== null) await verifyRawInternalProvenance({storage, manifest, provenance, deadline});
  return rawInternalPointerDescriptor(manifest, provenance);
}

/** Actual manifest + immutable provenance, never a caller-supplied complete
 * flag. The digest is part of the seventh pointer's persisted CAS descriptor. */
export function rawInternalPointerDescriptor(manifest, provenance = null) {
  if (manifest === null) {
    assert.equal(provenance, null, 'raw_internal_absent_provenance');
    return {sha256: digest(null), complete: true, references: [], provenanceSha256: null};
  }
  sources(manifest);
  const proof = provenance === null ? null : assertRawInternalProvenance(provenance, manifest);
  return {sha256: digest(manifest), complete: proof?.complete === true,
    references: proof?.references || [], provenanceSha256: proof === null ? null : digest(proof)};
}
