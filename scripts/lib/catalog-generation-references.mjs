/** Immutable market chunks can reference generations older than the top-level manifest. */
export function referencedCatalogGenerations(...manifests) {
 const result=new Set(),seen=new WeakSet(),pending=[...manifests];
 while(pending.length){
  const value=pending.pop();
  if(typeof value==='string'){
   const match=value.match(/^catalog\/generations\/(gen_\d+_[-a-z0-9]+)\//i);
   if(match)result.add(match[1]);
  }else if(value&&typeof value==='object'&&!seen.has(value)){
   seen.add(value);
   if(/^gen_\d+_[-a-z0-9]+$/i.test(value.generationId||''))result.add(value.generationId);
   pending.push(...Object.values(value));
  }
 }
 return result;
}

/** Follow content-addressed market receipts from active, rollback and internal
 * roots. Leaves are protected, not repriced or declared fresh. Callers still
 * need the maintenance lease; the final reread is not an atomic deletion lock.
 * The lazy import keeps the existing synchronous helper usable without tsx. */
export async function readReferencedCatalogGenerationClosure({roots, readJson}) {
 const {catalogReferenceDigest, assertCatalogMarketGenerationReference,
  readCatalogMarketGenerationReceipt, resolveCatalogMarketGeneration} = await import('../../apps/web/lib/catalog/market-generation.ts');
 const requiredRoots = new Set(['catalog/manifest.json', 'catalog/previous-manifest.json', 'catalog/internal/manifest.json']);
 if (!Array.isArray(roots) || roots.length !== requiredRoots.size
  || roots.some(root => !root || !requiredRoots.delete(root.key))) throw Error('catalog_generation_closure_roots');
 const rootDigests = new Map();
 for (const {key, value} of roots) {
  if (value !== null && (typeof value !== 'object' || Array.isArray(value))) throw Error('catalog_generation_closure_root');
  rootDigests.set(key, catalogReferenceDigest(value));
 }
 const generations = referencedCatalogGenerations(...roots.map(root => root.value));
 const objectDigests = new Map(), receipts = new Map();
 function protect(key, sha256) {
  const previous = objectDigests.get(key);
  if (previous && previous !== sha256) throw Error('catalog_generation_closure_conflicting_object');
  objectDigests.set(key, sha256);
 }
 const readReceiptJson = async (key, fallback) => {
  if (!receipts.has(key)) receipts.set(key, await readJson(key, fallback));
  return receipts.get(key);
 };
 const pending = [];
 for (const {value} of roots) {
  if (!value || value.markets === undefined) continue;
  if (!value.markets || typeof value.markets !== 'object' || Array.isArray(value.markets)) throw Error('catalog_generation_closure_markets');
  for (const [market, entry] of Object.entries(value.markets)) {
   if (entry?.acceptedGeneration === undefined) continue;
   // Validates outer count/date/chunk order as well as the exact receipt SHA.
   await resolveCatalogMarketGeneration(value, market, readReceiptJson);
   pending.push(entry.acceptedGeneration);
  }
 }
 const visited = new Set();
 while (pending.length) {
  const reference = assertCatalogMarketGenerationReference(pending.pop());
  const {key, sha256} = reference.receipt;
  protect(key, sha256);
  if (visited.has(key)) continue;
  const receipt = await readCatalogMarketGenerationReceipt(reference, readReceiptJson);
  visited.add(key);
  for (const generation of referencedCatalogGenerations(receipt)) generations.add(generation);
  for (const item of receipt.references) protect(item.key, item.sha256);
  for (const retained of receipt.retainedReceipts) pending.push(retained);
 }
 return {
  generations, objectKeys: new Set(objectDigests.keys()), receiptCount: visited.size,
  async assertUnchanged() {
   // Fresh direct storage reads, not the receipt cache or a local seed fallback.
   const checkRoots = async () => {
    for (const [key, digest] of rootDigests) {
     if (catalogReferenceDigest(await readJson(key, null)) !== digest) throw Error('catalog_generation_closure_root_changed');
    }
   };
   await checkRoots();
   for (const key of visited) {
    if (catalogReferenceDigest(await readJson(key, null)) !== objectDigests.get(key)) throw Error('catalog_generation_closure_receipt_changed');
   }
   await checkRoots();
  },
 };
}
