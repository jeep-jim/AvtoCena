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
 const selectionPrefix=/^catalog\/runtime-budget-selections-v1\/(china|korea|europe|uae|georgia)\/([a-f0-9]{64})\//;
 const selectionObject=/^catalog\/runtime-budget-selections-v1\/(china|korea|europe|uae|georgia)\/([a-f0-9]{64})\/(?:ready|parts\/\1\/[a-f0-9]{64})\.json$/;
 // The ready receipt references its own content-addressed parts. Retain the
 // whole context if any object is recent or its age/schema is unknown, so an
 // old part cannot be deleted underneath a newly completed ready receipt.
 const protectedSelections=new Set();
 for(const object of objects){
  const key=String(object.key||''),prefix=key.match(selectionPrefix)?.[0];
  if(!prefix)continue;
  const modified=Date.parse(object.lastModified||'');
  if(!selectionObject.test(key)||!Number.isFinite(modified)||modified>=cutoff)protectedSelections.add(prefix);
 }
 return objects.filter(object=>{
  const key=String(object.key||'');
  const modified=Date.parse(object.lastModified||'');
  const price=/^catalog\/runtime-(?:budget|sort)-prices-v3\/(?:china|korea|europe|uae|georgia)\/[a-f0-9]{64}\.json$/.test(key);
  const selection=selectionObject.test(key)&&!protectedSelections.has(key.match(selectionPrefix)?.[0]);
  return (price||selection)&&Number.isFinite(modified)&&modified<cutoff;
 });
}
