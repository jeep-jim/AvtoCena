from pathlib import Path

storage = Path('apps/web/lib/catalog/storage.ts')
s = storage.read_text()
old = '''export async function persistCatalogOffers(nextOffers: VehicleOffer[]) {
  const storage = getJsonStorage();'''
new = '''export type PersistCatalogOptions = {
  beforePersistValidate?: (publicOffers: VehicleOffer[]) => void | Promise<void>;
};
export async function persistCatalogOffers(nextOffers: VehicleOffer[], options: PersistCatalogOptions = {}) {
  const storage = getJsonStorage();'''
if old not in s:
    raise SystemExit('storage persist signature target not found')
s = s.replace(old, new, 1)
old = '''  const generationId = `gen_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();
  await persistInternalCatalog(storage, generationId, nextOffers);
  const byMarket = new Map<string, VehicleOffer[]>();
  for (const offer of nextOffers.filter(isPublicOffer)) byMarket.set(offer.market, [...(byMarket.get(offer.market) || []), offer]);'''
new = '''  const publicOffers = nextOffers.filter(isPublicOffer);
  // A guarded writer can inspect the exact normalized public rows that would be
  // persisted. The validator runs before any generation/internal/index object is
  // written, so a preservation mismatch cannot switch or partially stage a new
  // catalog generation.
  if (options.beforePersistValidate) await options.beforePersistValidate(publicOffers);
  const generationId = `gen_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();
  await persistInternalCatalog(storage, generationId, nextOffers);
  const byMarket = new Map<string, VehicleOffer[]>();
  for (const offer of publicOffers) byMarket.set(offer.market, [...(byMarket.get(offer.market) || []), offer]);'''
if old not in s:
    raise SystemExit('storage prewrite insertion target not found')
s = s.replace(old, new, 1)
old = '  await rebuildIndexes(generationId, nextOffers.filter(isPublicOffer), byId, imagesById);'
new = '  await rebuildIndexes(generationId, publicOffers, byId, imagesById);'
if old not in s:
    raise SystemExit('storage rebuild target not found')
s = s.replace(old, new, 1)
storage.write_text(s)

stable_hash = '''function stableJsonValue(value) {
  if (Array.isArray(value)) return value.map(stableJsonValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableJsonValue(value[key])]));
  }
  return value;
}
function hashRows(rows) {
  const canonical = [...rows]
    .sort((left, right) => String(left?.id || "").localeCompare(String(right?.id || "")))
    .map(stableJsonValue);
  return crypto.createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}'''

single = Path('scripts/catalog-live-recovery-publish.mjs')
p = single.read_text()
old = 'function hashRows(rows) { return crypto.createHash("sha256").update(JSON.stringify(rows)).digest("hex"); }'
if old not in p:
    raise SystemExit('single hashRows target not found')
p = p.replace(old, stable_hash, 1)
old = '''  manifest = await persistCatalogOffers([...unique.values()]);'''
new = '''  manifest = await persistCatalogOffers([...unique.values()], {
    beforePersistValidate(publicOffers) {
      const failures = [];
      for (const other of PUBLIC_CATALOG_MARKETS) {
        if (other === market) continue;
        const projectedRows = publicOffers.filter((offer) => String(offer?.market || "") === other);
        const expectedCount = Number(preservedByMarket[other] || 0);
        const projectedHash = hashRows(projectedRows);
        if (projectedRows.length !== expectedCount) failures.push(`${other}:count:${projectedRows.length}:${expectedCount}`);
        if (projectedHash !== preservedPublicHashByMarket[other]) failures.push(`${other}:hash:${projectedHash}:${preservedPublicHashByMarket[other]}`);
      }
      if (failures.length) throw new Error(`recovery_prewrite_preservation_gate_failed:${failures.join("|")}`);
    },
  });'''
if old not in p:
    raise SystemExit('single persist call target not found')
p = p.replace(old, new, 1)
single.write_text(p)

batch = Path('scripts/catalog-live-recovery-publish-batch.mjs')
b = batch.read_text()
old = '''function hashRows(rows) {
  return crypto.createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}'''
if old not in b:
    raise SystemExit('batch hashRows target not found')
b = b.replace(old, stable_hash, 1)
old = 'const manifest = await persistCatalogOffers([...unique.values()]);'
new = '''const manifest = await persistCatalogOffers([...unique.values()], {
  beforePersistValidate(publicOffers) {
    const failures = [];
    for (const other of PUBLIC_CATALOG_MARKETS) {
      if (markets.includes(other)) continue;
      const projectedRows = publicOffers.filter((offer) => String(offer?.market || "") === other);
      const expectedCount = Number(preservedByMarket[other] || 0);
      const projectedHash = hashRows(projectedRows);
      if (projectedRows.length !== expectedCount) failures.push(`${other}:count:${projectedRows.length}:${expectedCount}`);
      if (projectedHash !== preservedPublicHashByMarket[other]) failures.push(`${other}:hash:${projectedHash}:${preservedPublicHashByMarket[other]}`);
    }
    if (failures.length) throw new Error(`recovery_batch_prewrite_preservation_gate_failed:${failures.join("|")}`);
  },
});'''
if old not in b:
    raise SystemExit('batch persist call target not found')
b = b.replace(old, new, 1)
batch.write_text(b)

test = Path('tests/catalog-production-hardening.test.ts')
t = test.read_text()
anchor = '''test("single recovery publisher preserves full maintenance state and enforces target gallery depth", () => {
  assert.match(singleRecoveryPublisher, /readAllOffersForMaintenance/);'''
if anchor not in t:
    raise SystemExit('test insertion anchor not found')
insert = '''test("recovery preservation gates inspect the exact normalized public rows before any generation write", () => {
  assert.match(storage, /const publicOffers = nextOffers\\.filter\\(isPublicOffer\\);[\\s\\S]*beforePersistValidate\\(publicOffers\\)[\\s\\S]*const generationId[\\s\\S]*persistInternalCatalog/);
  assert.match(singleRecoveryPublisher, /beforePersistValidate\\(publicOffers\\)[\\s\\S]*recovery_prewrite_preservation_gate_failed/);
  assert.match(recoveryPublisher, /beforePersistValidate\\(publicOffers\\)[\\s\\S]*recovery_batch_prewrite_preservation_gate_failed/);
  assert.match(singleRecoveryPublisher, /function stableJsonValue/);
  assert.match(recoveryPublisher, /function stableJsonValue/);
});

'''
t = t.replace(anchor, insert + anchor, 1)
test.write_text(t)
