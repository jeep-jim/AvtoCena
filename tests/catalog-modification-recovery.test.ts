import assert from "node:assert/strict";
import test, { mock } from "node:test";
import fs from "node:fs";
import { compatibleModificationOptions, specificationEvidenceComplete, unprovenEnginePrecision } from "../apps/web/lib/catalog/modification-matching";
import { hasModificationSelection, isModificationScenario, modificationBinding, limitModificationInventory } from "../apps/web/lib/catalog/modification-contract";
import { catalogOfferVisibleRub } from "../apps/web/lib/catalog/public-priority";
import { calculateSelectedModification, conditionalModificationRub, prepareModificationRecovery } from "../apps/web/lib/catalog/modification-recovery";
import { restoreSavedSourceEvidence } from "../apps/web/lib/catalog/saved-source-recovery";
import { calculateOfferWithResolvedModification, requireFreshRecoveryRates } from "../apps/web/lib/catalog/customs-pricing";
import { catalogSearchProjectionMatches, catalogSearchProjectionSort, projectionCanRenderCard, searchProjectionFromOffer, compactPublicStorageOffer, persistCatalogOffers } from "../apps/web/lib/catalog/storage";
import { LocalJsonStorage } from "../apps/web/lib/data";

// Synthetic fixtures. These are not attested production vehicle specifications.
const variant: any = { id: "fixture/variant-petrol", modelId: "fixture/model", name: "Fixture petrol", market: "Europe",
  yearFrom: 2020, yearTo: 2026, fuel: "petrol", powertrainKind: "combustion", engineCc: 1798, powerHp: 140,
  status: "verified", evidence: [{ sourceId: "fixture-manufacturer", status: "verified", confidence: "official",
    fields: ["market", "yearFrom", "yearTo", "fuel", "powertrainKind", "engineCc", "powerHp"] }] };
const offer = (overrides: any = {}): any => ({ id: "fixture-listing", sourceOfferId: "1", sourceId: "mobile_de_open", market: "europe", make: "Fixture", model: "Model",
  year: 2021, offerType: "fixed", status: "active", sourcePrice: 10000, sourceCurrency: "EUR", priceMode: "fixed", bodyType: "sedan",
  firstSeenAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-01T00:00:00Z", images: [{ id: "fixture-image", url: "https://example.invalid/car.jpg", objectKey: "", mimeType: "image/jpeg" }], ...overrides });
const options = () => compatibleModificationOptions(offer(), [variant], variant.modelId);
const selection = (overrides: any = {}): any => {
  const row = offer(overrides);
  return { ...row, totalRub: null, recoveryQualification: { version: 1, status: "selection_required", reasons: [] },
    modificationSelection: { version: 1, status: "selection_required", binding: modificationBinding(row), options: options() } };
};

test("only verified, fully evidenced, compatible variants are offered; no default winner", () => {
  const diesel = { ...variant, id: "fixture/diesel", name: "Fixture diesel", fuel: "diesel" };
  assert.equal(compatibleModificationOptions(offer(), [variant, diesel], variant.modelId).length, 2);
  assert.equal(offer().powerHp, undefined);
  assert.equal(compatibleModificationOptions(offer(), [{ ...variant, status: "review" }], variant.modelId).length, 0);
  assert.equal(compatibleModificationOptions(offer(), [{ ...variant, evidence: [] }], variant.modelId).length, 0);
  assert.equal(compatibleModificationOptions(offer({ year: 2019 }), [variant], variant.modelId).length, 0);
  assert.equal(compatibleModificationOptions(offer(), [{ ...variant, yearTo: null }], variant.modelId).length, 0);
  assert.equal(compatibleModificationOptions(offer({ market: "japan" }), [variant], variant.modelId).length, 0);
  const known = offer({ fuel: "diesel", powertrainKind: "combustion", operational: { semanticEvidence: { fuel: { status: "exact" } } } });
  assert.deepEqual(compatibleModificationOptions(known, [variant, diesel], variant.modelId).map(x => x.id), [diesel.id]);
  assert.equal(compatibleModificationOptions(offer({ engineCc: 1800, operational: { semanticEvidence: { engineCc: { status: "exact" } } } }), [variant], variant.modelId).length, 0);
  assert.equal(compatibleModificationOptions(offer({ drive: "awd" }), [variant], variant.modelId).length, 0);
  const partialHybrid = offer({ fuel: "hybrid", powertrainKind: "unknown", operational: { semanticEvidence: { fuel: { status: "exact" }, powertrainKind: { status: "missing" } } } });
  assert.equal(compatibleModificationOptions(partialHybrid, [variant, diesel], variant.modelId).length, 0);
});

test("electric peak power cannot make a modification calculable without certified power", () => {
  assert.equal(compatibleModificationOptions(offer(), [{ ...variant, fuel: "electric", powertrainKind: "electric", engineCc: undefined }], variant.modelId).length, 0);
});

test("a complete-looking scenario with stale official rates has no delivered total", () => {
  const old = offer({ totalRub: 2500000, calculationSnapshot: {
    currencyRate: { rateSource: "cbr", rateDate: "2026-08-30" }, eurRate: { rateSource: "cbr", rateDate: "2026-08-30" },
    breakdown: [{ id: "car", amountRub: 1000000 }] } });
  const result = requireFreshRecoveryRates(old, Date.parse("2026-09-06"));
  assert.equal(result.totalRub, null);
  assert.equal(result.calculationStatus, "needs_currency_rate");
  assert.deepEqual(result.calculationSnapshot.breakdown, []);
  assert.equal(old.totalRub, 2500000);
});

test("selectors survive projections and compaction, with no stale price or budget match", () => {
  const row = selection({ totalRub: 2500000 });
  row.totalRub = 2500000; row.publicVisibleRub = 2500000; row.cardProjectionVersion = 3; row.publicSpecificationVerified = true;
  assert.equal(catalogOfferVisibleRub(row), 0);
  const projected = searchProjectionFromOffer(row);
  assert.equal(projected.totalRub, null);
  assert.equal(projectionCanRenderCard(projected), true);
  assert.equal(hasModificationSelection(compactPublicStorageOffer(row)), true);
  assert.equal(catalogSearchProjectionMatches(projected, { budgetTo: 3000000 }), false);
  assert.equal(catalogSearchProjectionMatches(projected, { hasPrice: "yes" }), false);
  assert.equal(catalogSearchProjectionMatches(projected, { hasPrice: "no" }), true);
  assert.equal(catalogSearchProjectionMatches(projected, { engineTo: 2000 }), false);
  const priced: any = { id: "priced", totalRub: 2000000 };
  assert.equal(catalogSearchProjectionSort([projected, priced], "totalRub")[0].id, "priced");
  assert.equal(catalogSearchProjectionSort([projected, priced], "totalRubDesc")[0].id, "priced");
  assert.equal(hasModificationSelection({ ...row, sourcePrice: 20000 }), false);
});

test("unknown or cross-listing variant IDs fail closed", async () => {
  assert.equal(await calculateSelectedModification(selection(), "foreign/variant"), null);
  assert.equal(await calculateSelectedModification({ ...selection(), id: "another" }, variant.id), null);
});

test("quota is per market after dedup; customer scenarios and empty markets never inflate 80%", () => {
  const ready = Array.from({ length: 7 }, (_, i) => offer({ id: `ready-${i}`, totalRub: 2000000 }));
  const unknown = Array.from({ length: 6 }, (_, i) => selection({ id: `choice-${i}` }));
  const japan = offer({ id: "paused-fixture", market: "japan" });
  const rows = limitModificationInventory([...ready, ...unknown, selection({ market: "uae" }), japan], x => Number(x.totalRub || 0));
  assert.equal(rows.length, 9); // 7 automatic + 1 conditional + untouched Japan
  assert.equal(rows.filter(hasModificationSelection).length, 1);
  assert.equal(rows.at(-1), japan);
  assert.equal(limitModificationInventory(unknown, () => 0).length, 0);
  const personal = offer({ calculationSnapshot: { modificationScenario: { source: "customer_selection" } }, totalRub: 2000000 });
  assert.equal(limitModificationInventory([personal, ...unknown], x => Number(x.totalRub || 0)).length, 0);
});

test("retained listing fields repair fuel; ranges, guesses and wrong identity do not become facts", () => {
  const raw = { detailIdentityVerified: true, parsed: { id: "1", engineCc: 1798, powerHp: 140, fuel: "Electric/Gasoline" } };
  const original = offer({ fuel: "petrol", powerHp: 99, totalRub: 2000000, operational: { raw } });
  const restored = restoreSavedSourceEvidence(original);
  assert.equal(restored.fuel, "hybrid"); assert.equal(restored.powertrainKind, "unknown");
  assert.equal(restored.powerHp, 140); assert.equal(restored.totalRub, null);
  assert.equal(original.powerHp, 99); assert.equal(original.totalRub, 2000000);
  assert.equal(specificationEvidenceComplete(restored), false);
  const valid = restoreSavedSourceEvidence(offer({ operational: { raw: { ...raw, parsed: { ...raw.parsed, fuel: "Benzin" } } } }));
  assert.equal(specificationEvidenceComplete(valid), true);
  const listBound = offer({ sourceId: "autoscout_europe_open", operational: { raw: { detailIdentityVerified: false,
    listingBoundSearchImages: true, parsed: { ...raw.parsed, fuel: "Gasoline", raw: { id: "1" } } } } });
  assert.equal(specificationEvidenceComplete(restoreSavedSourceEvidence(listBound)), true);
  listBound.operational.raw.parsed.raw.id = "another-listing";
  assert.equal(specificationEvidenceComplete(restoreSavedSourceEvidence(listBound)), false);
  assert.equal(restoreSavedSourceEvidence(offer({ sourceOfferId: "2", operational: { raw } })).operational.savedSourceRecovery, undefined);
  assert.equal(restoreSavedSourceEvidence(offer({ operational: { raw: { ...raw, parsed: { ...raw.parsed, engineCc: "1500-2000" } } } })).engineCc, undefined);
  const marketing = restoreSavedSourceEvidence(offer({ market: "china", sourceId: "autohome_new_china_open", operational: {
    raw: { detailIdentityVerified: true, configSpecId: "1", listing: { specId: "1" }, configFields: { engine: "1.5L 140HP", energy: "汽油", engineMaxHp: "140" } } } }));
  assert.equal(marketing.engineCc, undefined);
  const usedChina = restoreSavedSourceEvidence(offer({ market: "china", sourceId: "autohome_used_china_open", sourceOfferId: "59609193", operational: {
    raw: { detailIdentityVerified: true, listing: { infoid: 59609193 }, detail: { infoid: 59609193, fuelname: "Gasoline", engine: "1998 cc 156hp L4" } } } }));
  assert.equal(usedChina.fuel, "petrol"); assert.equal(usedChina.powertrainKind, "combustion");
  assert.equal(usedChina.engineCc, 1998); assert.equal(usedChina.powerHp, 156);
  const roundedUsedChina = restoreSavedSourceEvidence(offer({ market: "china", sourceId: "autohome_used_china_open", sourceOfferId: "59609193", operational: {
    raw: { detailIdentityVerified: true, listing: { infoid: 59609193 }, detail: { infoid: 59609193, fuelname: "Gasoline", engine: "2.0L 156hp L4" } } } }));
  assert.equal(roundedUsedChina.engineCc, undefined); assert.equal(roundedUsedChina.powerHp, 156);
  const wrongUsedChina = restoreSavedSourceEvidence(offer({ market: "china", sourceId: "autohome_used_china_open", sourceOfferId: "59609193", operational: {
    raw: { detailIdentityVerified: true, listing: { infoid: 59609193 }, detail: { infoid: 1, fuelname: "Gasoline", engine: "1998 cc 156hp L4" } } } }));
  assert.equal(wrongUsedChina.operational.savedSourceRecovery, undefined);
  for (const engine of ["1500-2000 cc 156hp", "1998 cc 100–156hp", "1500/2000 cc 156hp", "1500 cc–2000 cc 156hp", "<2000 cc 156hp"]) {
    const row = structuredClone(usedChina);
    row.operational.raw.detail.engine = engine;
    const restored = restoreSavedSourceEvidence(row);
    assert.equal(restored.engineCc, undefined, engine);
    assert.equal(restored.powerHp, undefined, engine);
  }
  const cubic = structuredClone(usedChina);
  cubic.operational.raw.detail.engine = "1998 cm³ 156hp";
  assert.equal(restoreSavedSourceEvidence(cubic).engineCc, 1998);
  const missingIdentity = structuredClone(usedChina);
  missingIdentity.sourceOfferId = "";
  delete missingIdentity.operational.savedSourceRecovery;
  delete missingIdentity.operational.raw.listing.infoid;
  delete missingIdentity.operational.raw.detail.infoid;
  assert.equal(restoreSavedSourceEvidence(missingIdentity).operational.savedSourceRecovery, undefined);
  assert.equal(unprovenEnginePrecision(offer({ engineCc: 1500, operational: { semanticEvidence: {
    engineCc: { status: "exact", rawValues: ["1.5L 140HP"] } } } })), true);
});

test("selected modification calculates a full isolated scenario using existing engine", async () => {
  const markets = JSON.parse(fs.readFileSync("data/markets/markets.json", "utf8"));
  const today = new Date().toISOString();
  const read = mock.method(LocalJsonStorage.prototype, "readJsonWithMeta", async (key: string) => ({ found: true,
    value: key === "fees/exchange-rates.json" ? { updatedAt: today, EUR: { cbrRate: 95, nominal: 1, rateDate: today, rateSource: "cbr" } } : key === "markets/markets.json" ? markets : {} }));
  process.env.CATALOG_LIVE_RATE_DISABLED = "true";
  try {
    const input = selection({ fuel: "unknown", powerHp: 99, engineCc: 999, utilizationPowerKw: 999 });
    const before = JSON.stringify(input);
    const result = await calculateOfferWithResolvedModification(input, options()[0]);
    assert.equal(JSON.stringify(input), before);
    assert.equal(result.engineCc, 1798); assert.equal(result.powerHp, 140); assert.equal(result.fuel, "petrol");
    assert.equal(isModificationScenario(result), true);
    assert.ok(conditionalModificationRub(result) > 0, JSON.stringify(result.calculationSnapshot));
    assert.equal(catalogOfferVisibleRub(result), 0);
    const incomplete = { ...result, calculationSnapshot: { ...result.calculationSnapshot, priceIncludesUtilizationFee: false } };
    assert.equal(conditionalModificationRub(incomplete), 0);
  } finally { read.mock.restore(); }
});

test("new recovery preserves Japan and cannot pass the production freeze", async () => {
  const japan = offer({ market: "japan" });
  assert.equal(restoreSavedSourceEvidence(japan), japan);
  assert.equal(await prepareModificationRecovery(japan), japan);
  const previous = process.env.JSON_STORAGE_DRIVER;
  process.env.JSON_STORAGE_DRIVER = "object";
  try { await assert.rejects(persistCatalogOffers([], { modificationRecovery: true }), /catalog_production_writes_paused/); }
  finally { if (previous === undefined) delete process.env.JSON_STORAGE_DRIVER; else process.env.JSON_STORAGE_DRIVER = previous; }
});


test("saved Autohome displacement keeps exact cc, rejects conflicts and mismatched spec IDs", () => {
  const make = (values: string[], engine = "1.5T", configSpecId = "1") => offer({ market: "china", sourceId: "autohome_new_china_open", operational: { raw: {
    detailIdentityVerified: true, configSpecId, listing: { specId: "1" }, configFields: { energy: "汽油", engine, displacementCcValues: values },
  } } });
  assert.equal(restoreSavedSourceEvidence(make(["1498 cc"])).engineCc, 1498);
  assert.equal(restoreSavedSourceEvidence(make(["1498 cc", "1499 cc"])).engineCc, undefined);
  assert.equal(restoreSavedSourceEvidence(make(["1498 cc"], "1499 cc")).engineCc, undefined);
  assert.equal(restoreSavedSourceEvidence(make(["1498-1998 cc"])).engineCc, undefined);
  const wrong = make(["1498 cc"], "1.5T", "2");
  assert.equal(restoreSavedSourceEvidence(wrong), wrong);
});
