const day = 86_400_000;
export const WEB_REPOSITORY = 'crp73he0q1blh1mujo4s/avtocena-web';
export function registryRetentionPlan(images, revisions, now = Date.now()) {
  const own = images.filter(image => image.name === WEB_REPOSITORY);
  if (!own.length) throw new Error('No web images; refusing empty inventory');
  const relevant = revisions.filter(r => r.image?.imageUrl?.startsWith(`cr.yandex/${WEB_REPOSITORY}:`) || r.image?.imageUrl?.startsWith(`cr.yandex/${WEB_REPOSITORY}@`));
  if (!relevant.some(r => r.status === 'ACTIVE')) throw new Error('No active web revision; refusing cleanup');
  const sorted = [...own].sort((a,b) => Date.parse(b.createdAt)-Date.parse(a.createdAt));
  const keep = new Set(sorted.slice(0, 10).map(x => x.id));
  // Protect all non-obsolete revisions and ten most recent usable rollback revisions.
  const rollback = [...relevant].filter(r => r.status !== 'FAILED').sort((a,b) => Date.parse(b.createdAt)-Date.parse(a.createdAt)).slice(0,10);
  const protectedRevisions = [...new Map([...relevant.filter(r => !['OBSOLETE','FAILED'].includes(r.status)), ...rollback].map(r=>[r.id,r])).values()];
  for (const revision of protectedRevisions) {
    const matches = own.filter(image => image.digest === revision.image.imageDigest || revision.image.imageUrl === `cr.yandex/${WEB_REPOSITORY}@${image.digest}` || (image.tags || []).some(tag => revision.image.imageUrl === `cr.yandex/${WEB_REPOSITORY}:${tag}`));
    if (!matches.length) throw new Error(`Protected revision image not found: ${revision.id}`);
    for (const image of matches) keep.add(image.id);
  }
  for (const image of own) {
    if (!image.id || !image.digest || !Number.isFinite(Date.parse(image.createdAt))) throw new Error('Incomplete image inventory');
    // Named operator pins, recent builds and unknown dates are never age-pruned.
    if (now-Date.parse(image.createdAt) < 7*day || (image.tags || []).some(tag => !/^[a-f0-9]{40}$/.test(tag))) keep.add(image.id);
  }
  const candidates = own.filter(x => !keep.has(x.id));
  return {repository:WEB_REPOSITORY, images:own.length, retained:own.length-candidates.length, candidates:candidates.map(x=>({id:x.id,digest:x.digest,createdAt:x.createdAt,tags:x.tags || []})), protectedRevisions:protectedRevisions.map(r=>({id:r.id,status:r.status,imageDigest:r.image.imageDigest,imageUrl:r.image.imageUrl}))};
}
export function uniqueRegistryBytes(images) {
  // The list API may omit layer details; unknown is not zero bytes.
  if (images.some(image => !Array.isArray(image.layers))) return null;
  const blobs = new Map();
  for (const image of images) for (const blob of [image.config,...(image.layers || [])]) {
    if (blob?.digest && Number.isFinite(Number(blob.size))) blobs.set(blob.digest, Number(blob.size));
  }
  return [...blobs.values()].reduce((a,b)=>a+b,0);
}
