import fs from "node:fs";

function replaceOnce(path, before, after) {
  const source = fs.readFileSync(path, "utf8");
  if (!source.includes(before)) throw new Error(`patch_anchor_missing:${path}:${before.slice(0, 80)}`);
  const next = source.replace(before, after);
  if (next === source) throw new Error(`patch_noop:${path}`);
  fs.writeFileSync(path, next);
}

const storagePath = "apps/web/lib/catalog/storage.ts";
replaceOnce(
  storagePath,
`export type PersistCatalogOptions = {
  beforePersistValidate?: (publicOffers: VehicleOffer[]) => void | Promise<void>;
};
export async function persistCatalogOffers(nextOffers: VehicleOffer[], options: PersistCatalogOptions = {}) {
  const storage = getJsonStorage();
  const growOnlyMarkets = new Set(String(process.env.CATALOG_GROW_ONLY_MARKETS ?? "korea").split(",").map((value) => value.trim()).filter(Boolean));
  const normalized = await Promise.all(nextOffers.map(async (offer) => normalizeVehicleOfferSpecs(await enrichOfferWithVehicleKnowledge(offer))));`,
`export type PersistCatalogOptions = {
  beforePersistValidate?: (publicOffers: VehicleOffer[]) => void | Promise<void>;
  // Recovery writers may preserve already-published markets byte-for-byte while
  // rebuilding only their target market. Those rows are trusted only because
  // the caller has already read and hash-validated the current public market.
  preservePublicOffersByMarket?: Partial<Record<CatalogMarket, VehicleOffer[]>>;
};
export async function persistCatalogOffers(nextOffers: VehicleOffer[], options: PersistCatalogOptions = {}) {
  const storage = getJsonStorage();
  const growOnlyMarkets = new Set(String(process.env.CATALOG_GROW_ONLY_MARKETS ?? "korea").split(",").map((value) => value.trim()).filter(Boolean));
  const preservedPublicOffersByMarket = options.preservePublicOffersByMarket || {};
  const preservedMarketKeys = Object.keys(preservedPublicOffersByMarket);
  for (const market of preservedMarketKeys) {
    if (!MARKETS.includes(market as CatalogMarket)) throw new Error(\`catalog_preserved_public_market_unknown:\${market}\`);
  }
  const exactPreserveMarkets = new Set(preservedMarketKeys as CatalogMarket[]);
  const normalized = await Promise.all(nextOffers.map(async (offer) => exactPreserveMarkets.has(offer.market)
    ? offer
    : normalizeVehicleOfferSpecs(await enrichOfferWithVehicleKnowledge(offer))));`);

replaceOnce(
  storagePath,
`    for (const offer of current) {
      if (!growOnlyMarkets.has(String(offer.market)) || !hasCredibleOfferContent({ ...offer, status: "active" })) continue;`,
`    for (const offer of current) {
      if (exactPreserveMarkets.has(offer.market)) continue;
      if (!growOnlyMarkets.has(String(offer.market)) || !hasCredibleOfferContent({ ...offer, status: "active" })) continue;`);

replaceOnce(
  storagePath,
`  const publicOffers = nextOffers.filter(isPublicOffer);
  // A guarded writer can inspect the exact normalized public rows that would be`,
`  const publicOffers = nextOffers.filter((offer) => !exactPreserveMarkets.has(offer.market) && isPublicOffer(offer));
  for (const [market, rows] of Object.entries(preservedPublicOffersByMarket)) {
    for (const offer of rows || []) {
      if (!offer?.id || String(offer.market || "") !== market) throw new Error(\`catalog_preserved_public_row_invalid:\${market}:\${String(offer?.id || "missing")}\`);
      publicOffers.push(offer);
    }
  }
  const seenPublicIds = new Set<string>();
  for (const offer of publicOffers) {
    const id = String(offer?.id || "");
    if (!id) throw new Error("catalog_public_offer_id_missing");
    if (seenPublicIds.has(id)) throw new Error(\`catalog_public_offer_id_duplicate:\${id}\`);
    seenPublicIds.add(id);
  }
  // A guarded writer can inspect the exact normalized public rows that would be`);

const singlePath = "scripts/catalog-live-recovery-publish.mjs";
replaceOnce(singlePath,
`const preservedByMarket = {};
const preservedInternalByMarket = {};
const preservedPublicHashByMarket = {};`,
`const preservedByMarket = {};
const preservedInternalByMarket = {};
const preservedPublicHashByMarket = {};
const preservedPublicRowsByMarket = {};`);
replaceOnce(singlePath,
`  preservedByMarket[other] = rows.length;
  preservedPublicHashByMarket[other] = hashRows(rows);`,
`  preservedByMarket[other] = rows.length;
  preservedPublicHashByMarket[other] = hashRows(rows);
  preservedPublicRowsByMarket[other] = rows;`);
replaceOnce(singlePath,
`  manifest = await persistCatalogOffers([...unique.values()], {
    beforePersistValidate(publicOffers) {`,
`  manifest = await persistCatalogOffers([...unique.values()], {
    preservePublicOffersByMarket: preservedPublicRowsByMarket,
    beforePersistValidate(publicOffers) {`);

const batchPath = "scripts/catalog-live-recovery-publish-batch.mjs";
replaceOnce(batchPath,
`const preservedByMarket = {};
const preservedInternalByMarket = {};
const preservedPublicHashByMarket = {};`,
`const preservedByMarket = {};
const preservedInternalByMarket = {};
const preservedPublicHashByMarket = {};
const preservedPublicRowsByMarket = {};`);
replaceOnce(batchPath,
`    preservedByMarket[other] = rows.length;
    preservedInternalByMarket[other] = internalRows.length;
    preservedPublicHashByMarket[other] = hashRows(rows);
    combined.push(...internalRows);`,
`    preservedByMarket[other] = rows.length;
    preservedInternalByMarket[other] = internalRows.length;
    preservedPublicHashByMarket[other] = hashRows(rows);
    preservedPublicRowsByMarket[other] = rows;
    combined.push(...internalRows);`);
replaceOnce(batchPath,
`const manifest = await persistCatalogOffers([...unique.values()], {
  beforePersistValidate(publicOffers) {`,
`const manifest = await persistCatalogOffers([...unique.values()], {
  preservePublicOffersByMarket: preserveUntouchedExact ? preservedPublicRowsByMarket : undefined,
  beforePersistValidate(publicOffers) {`);

const testPath = "tests/catalog-production-hardening.test.ts";
replaceOnce(testPath,
`test("recovery preservation gates inspect the exact normalized public rows before any generation write", () => {
  assert.match(storage, /const publicOffers = nextOffers\\.filter\\(isPublicOffer\\);[\\s\\S]*beforePersistValidate\\(publicOffers\\)[\\s\\S]*const generationId[\\s\\S]*persistInternalCatalog/);
  assert.match(singleRecoveryPublisher, /beforePersistValidate\\(publicOffers\\)[\\s\\S]*recovery_prewrite_preservation_gate_failed/);
  assert.match(recoveryPublisher, /beforePersistValidate\\(publicOffers\\)[\\s\\S]*recovery_batch_prewrite_preservation_gate_failed/);
  assert.match(singleRecoveryPublisher, /function stableJsonValue/);
  assert.match(recoveryPublisher, /function stableJsonValue/);
});`,
`test("recovery preservation gates keep untouched public rows exact before any generation write", () => {
  assert.match(storage, /preservePublicOffersByMarket/);
  assert.match(storage, /exactPreserveMarkets\\.has\\(offer\\.market\\)[\\s\\S]*\\? offer[\\s\\S]*enrichOfferWithVehicleKnowledge/);
  assert.match(storage, /const publicOffers = nextOffers\\.filter\\(\\(offer\\) => !exactPreserveMarkets\\.has\\(offer\\.market\\) && isPublicOffer\\(offer\\)\\);[\\s\\S]*Object\\.entries\\(preservedPublicOffersByMarket\\)[\\s\\S]*beforePersistValidate\\(publicOffers\\)[\\s\\S]*const generationId[\\s\\S]*persistInternalCatalog/);
  assert.match(singleRecoveryPublisher, /preservePublicOffersByMarket: preservedPublicRowsByMarket[\\s\\S]*beforePersistValidate\\(publicOffers\\)[\\s\\S]*recovery_prewrite_preservation_gate_failed/);
  assert.match(recoveryPublisher, /preservePublicOffersByMarket: preserveUntouchedExact \\? preservedPublicRowsByMarket : undefined[\\s\\S]*beforePersistValidate\\(publicOffers\\)[\\s\\S]*recovery_batch_prewrite_preservation_gate_failed/);
  assert.match(singleRecoveryPublisher, /function stableJsonValue/);
  assert.match(recoveryPublisher, /function stableJsonValue/);
});`);

console.log("Applied exact untouched public preservation patch");
