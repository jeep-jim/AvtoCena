// Internal chunks can outlive their public generation directory. Determine
// reachability from the internal manifest, not from public directory existence.
export function planInternalChunkCleanup(objects, manifest, protectedGenerations, cutoff) {
  const fail = () => { throw new Error('storage_cleanup_internal_manifest_invalid'); };
  if (!manifest || !/^gen_\d+_[-a-z0-9]+$/i.test(manifest.generationId || '')
    || !manifest.sources || typeof manifest.sources !== 'object' || Array.isArray(manifest.sources)
    || !Number.isFinite(cutoff)) fail();
  const referenced = new Set();
  for (const [sourceId, source] of Object.entries(manifest.sources)) {
    if (!source || !Number.isInteger(source.count) || source.count < 0 || !Array.isArray(source.chunks)
      || (source.count > 0 && source.chunks.length === 0)) fail();
    for (const key of source.chunks) {
      if (typeof key !== 'string' || !key.startsWith(`catalog/internal/offers/${sourceId}/`)
        || !/^catalog\/internal\/offers\/[^/]+\/gen_\d+_[-a-z0-9]+-chunk-\d+\.json$/i.test(key)) fail();
      referenced.add(key);
    }
  }
  const available = new Set(objects.map(row => row.key));
  if ([...referenced].some(key => !available.has(key))) fail();
  const candidates = [], retained = [];
  for (const object of objects) {
    const match = String(object.key || '').match(/^catalog\/internal\/offers\/[^/]+\/(gen_(\d+)_[-a-z0-9]+)-chunk-\d+\.json$/i);
    const modified = Date.parse(object.lastModified || '');
    const generationTime = Number(match?.[2]);
    if (!referenced.has(object.key) && match && !protectedGenerations.has(match[1])
      && match[1] !== manifest.generationId && Number.isFinite(modified) && modified > 0
      && modified < cutoff && generationTime > 0 && generationTime < cutoff) candidates.push(object);
    else retained.push(object);
  }
  const bytes = rows => rows.reduce((n, row) => n + Math.max(0, Number(row.size) || 0), 0);
  return { candidates, summary: {
    referencedObjects: objects.filter(row => referenced.has(row.key)).length,
    referencedBytes: bytes(objects.filter(row => referenced.has(row.key))),
    candidateObjects: candidates.length, candidateBytes: bytes(candidates),
    retainedObjects: retained.length, retainedBytes: bytes(retained),
  } };
}
