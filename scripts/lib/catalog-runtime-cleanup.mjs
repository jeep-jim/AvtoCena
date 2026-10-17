// Only the derived Japan input cache is disposable; never broad-delete runtime.
export function staleJapanPreviewObjects(objects, protectedGenerations, cutoff) {
 return objects.filter(object => {
  const match=String(object.key||'').match(/^catalog\/runtime\/japan-preview-inputs-v1\/(gen_(\d+)_[-a-z0-9]+)\.json$/i);
  const modified=Date.parse(object.lastModified||'');
  return match && !protectedGenerations.has(match[1]) && Number(match[2])<cutoff && Number.isFinite(modified) && modified<cutoff;
 });
}
