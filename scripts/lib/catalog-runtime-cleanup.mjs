// Only the derived Japan input cache is disposable; never broad-delete runtime.
export function staleJapanPreviewObjects(objects, protectedGenerations, cutoff) {
 return objects.filter(object => {
  const match=String(object.key||'').match(/^catalog\/runtime\/japan-preview-inputs-v1\/(gen_(\d+)_[-a-z0-9]+)\.json$/i);
  const modified=Date.parse(object.lastModified||'');
  return match && !protectedGenerations.has(match[1]) && Number(match[2])<cutoff && Number.isFinite(modified) && modified<cutoff;
 });
}

// Price tuples are disposable; never select source inventories or evidence.
// Keep seven days independently of emergency-generation cleanup. Runtime
// validation expires snapshots after one day, so an old tuple cannot be active.
export function stalePriceSnapshotObjects(objects,now=Date.now()){
 const cutoff=now-7*86400000;
 return objects.filter(object=>{
  const modified=Date.parse(object.lastModified||'');
  return /^catalog\/runtime-(?:budget|sort)-prices-v3\/(?:china|korea|europe|uae|georgia)\/[a-f0-9]{64}\.json$/.test(String(object.key||''))&&Number.isFinite(modified)&&modified<cutoff;
 });
}
