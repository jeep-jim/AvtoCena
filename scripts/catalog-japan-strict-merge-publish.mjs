import fs from "node:fs/promises";

const { persistCatalogOffers, readMarketOffers } = await import("../apps/web/lib/catalog/storage.ts");
const { credibleCatalogImages } = await import("../apps/web/lib/catalog/offer-quality.ts");
const { normalizeVehicleOfferSpecs } = await import("../apps/web/lib/catalog/spec-normalization.ts");
const { PUBLIC_CATALOG_MARKETS } = await import("../apps/web/lib/catalog/runtime-config.ts");
const { readVehicleKnowledgeVariants } = await import("../apps/web/lib/catalog/vehicle-knowledge.ts");

const input = process.env.JAPAN_STRICT_MERGE_INPUT || "catalog-rebuild-japan-exact-frame.json";
const output = process.env.JAPAN_STRICT_MERGE_REPORT || "catalog-japan-strict-merge-publish-report.json";
const maxOffersPerModel = Math.max(1, Math.min(100, Number(process.env.CATALOG_MAX_OFFERS_PER_MODEL || 20)));
const maxModelsPerMake = Math.max(1, Math.min(50, Number(process.env.CATALOG_MAX_MODELS_PER_MAKE || 10)));
const minYear = new Date().getFullYear() - 15;

function compact(value) { return String(value || "").toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/g, ""); }
function positive(value) { const n = Number(value); return Number.isFinite(n) && n > 0 ? n : 0; }
function makeKey(offer) { return String(offer?.make || "").trim().toLowerCase().replace(/\s+/g, " "); }
function modelKey(offer) {
  const make = makeKey(offer);
  const model = String(offer?.model || "").trim().toLowerCase().replace(/\s+/g, " ");
  return make && model ? `${make}|${model}` : "";
}
function exactCalculation(offer) {
  const total = positive(offer?.totalRub);
  const customs = offer?.calculationSnapshot?.customs;
  const breakdown = offer?.calculationSnapshot?.breakdown;
  if (!total || customs?.status !== "ready" || !Number.isFinite(Number(customs?.totalCustomsRub))) return false;
  if (!Array.isArray(breakdown) || !breakdown.some((line) => line?.id === "car") || !breakdown.some((line) => line?.id === "customs")) return false;
  const kind = String(offer?.powertrainKind || "");
  if (!["electric", "series_hybrid", "other_hybrid"].includes(kind)) return positive(offer?.engineCc) > 0 && positive(offer?.powerHp) > 0;
  if (positive(offer?.utilizationPowerKw) > 0) return true;
  const motor30 = positive(offer?.power30MinKw) || (Array.isArray(offer?.power30MinKwByMotor) ? offer.power30MinKwByMotor.reduce((sum, value) => sum + positive(value), 0) : 0);
  return kind === "other_hybrid" ? motor30 > 0 && positive(offer?.icePowerKw) > 0 : motor30 > 0;
}
function soldSemantics(offer) {
  const raw = offer?.operational?.raw || {};
  return offer?.market === "japan"
    && offer?.offerType === "auction"
    && offer?.catalogKind === "auction_result"
    && offer?.auctionResult === "sold"
    && offer?.auctionPriceKind === "published_result"
    && String(raw.currentStatus || "") === "Sold"
    && positive(raw.finalPriceJpy) === positive(offer?.sourcePrice)
    && positive(offer?.sourcePrice) > 0
    && String(offer?.sourceCurrency || "") === "JPY";
}
function exactPhotos(offer) {
  const op = offer?.operational || {};
  const raw = op?.raw || {};
  return /^https:\/\/prestigemotorsport\.com\.au\/auction-vehicle-display\/\?car_id=[A-Za-z0-9_-]+$/.test(String(op.sourceUrl || ""))
    && (op.photoIdentityVerified === true || raw.photoIdentityVerified === true || raw.detailIdentityVerified === true || raw.listingBoundImages === true)
    && credibleCatalogImages(offer?.images || []).length >= 5;
}
function frameMatchesVariant(variant, offer) {
  if (!variant || !["manufacturer", "official_registry"].includes(String(variant.sourceType || ""))) return false;
  const frame = compact(offer.frameNumber);
  if (!frame) return false;
  const aliases = [variant.generation, ...(variant.generationAliases || [])].map(compact).filter(Boolean);
  if (!aliases.includes(frame)) return false;
  const year = Number(offer.year || 0);
  if (variant.yearFrom && year < variant.yearFrom) return false;
  if (variant.yearTo && year > variant.yearTo) return false;
  if (positive(variant.engineCc) && positive(offer.engineCc)) {
    const tolerance = Math.max(20, Number(variant.engineCcTolerance || 80));
    if (Math.abs(Number(variant.engineCc) - Number(offer.engineCc)) > tolerance) return false;
  }
  if (positive(variant.powerHp) && Math.abs(Number(variant.powerHp) - Number(offer.powerHp || 0)) > 2) return false;
  return true;
}
function quality(a, b) {
  return Number(b.year || 0) - Number(a.year || 0)
    || Number(a.totalRub || Number.MAX_SAFE_INTEGER) - Number(b.totalRub || Number.MAX_SAFE_INTEGER)
    || Number(b.images?.length || 0) - Number(a.images?.length || 0)
    || String(a.id || "").localeCompare(String(b.id || ""));
}

const payload = JSON.parse(await fs.readFile(input, "utf8"));
const incoming = Array.isArray(payload?.offers) ? payload.offers : [];
const current = await readMarketOffers("japan");
const variants = await readVehicleKnowledgeVariants();
const variantById = new Map(variants.map((variant) => [variant.id, variant]));
const combinedCandidates = [...incoming, ...current];
const unique = new Map();
const rejected = {};
const reject = (reason) => { rejected[reason] = Number(rejected[reason] || 0) + 1; };

for (const rawOffer of combinedCandidates) {
  const offer = normalizeVehicleOfferSpecs({ ...rawOffer, status: "active", images: credibleCatalogImages(rawOffer?.images || []).slice(0, 30) });
  if (!offer?.id || unique.has(offer.id)) continue;
  if (Number(offer.year || 0) < minYear || Number(offer.year || 0) > new Date().getFullYear() + 1) { reject("year"); continue; }
  if (!soldSemantics(offer)) { reject("sold_semantics"); continue; }
  if (!exactPhotos(offer)) { reject("exact_photos"); continue; }
  if (!exactCalculation(offer)) { reject("calculation"); continue; }
  const raw = offer.operational?.raw || {};
  const variantId = String(raw.vehicleKnowledgeVariant?.id || raw.recoveryVariantId || raw.exactFrameVariantIds?.[0] || "");
  const variant = variantById.get(variantId);
  if (!frameMatchesVariant(variant, offer)) { reject("exact_frame_power"); continue; }
  unique.set(offer.id, offer);
}

const strictRows = [...unique.values()].sort(quality);
const modelCounts = new Map();
const modelsByMake = new Map();
const japanRows = [];
for (const offer of strictRows) {
  const make = makeKey(offer);
  const key = modelKey(offer);
  const count = Number(modelCounts.get(key) || 0);
  if (key && count >= maxOffersPerModel) { reject("model_quota"); continue; }
  const makeModels = make ? (modelsByMake.get(make) || new Set()) : null;
  if (make && key && !makeModels.has(key) && makeModels.size >= maxModelsPerMake) { reject("make_model_quota"); continue; }
  japanRows.push(offer);
  if (key) modelCounts.set(key, count + 1);
  if (make && key) { makeModels.add(key); modelsByMake.set(make, makeModels); }
}
if (!japanRows.length) throw new Error("japan_strict_merge_empty");

const all = [...japanRows];
const preservedByMarket = {};
for (const market of PUBLIC_CATALOG_MARKETS) {
  if (market === "japan") continue;
  let rows = [];
  try { rows = await readMarketOffers(market); } catch { rows = []; }
  const preserved = rows
    .filter((offer) => ["active", "stale"].includes(String(offer?.status || "")))
    .map((offer) => normalizeVehicleOfferSpecs({ ...offer, status: "active", images: credibleCatalogImages(offer?.images || []).slice(0, 30) }))
    .filter((offer) => offer?.id && offer.make && offer.model && Number(offer.year || 0) >= minYear && offer.images.length > 0)
    .slice(0, 5_000);
  preservedByMarket[market] = preserved.length;
  all.push(...preserved);
}
const allUnique = new Map();
for (const offer of all) if (offer?.id && !allUnique.has(offer.id)) allUnique.set(offer.id, offer);
process.env.CATALOG_GROW_ONLY_MARKETS = "";
const manifest = await persistCatalogOffers([...allUnique.values()]);
const manifestCount = Number(manifest?.markets?.japan?.count || 0);
if (manifestCount !== japanRows.length) throw new Error(`japan_strict_manifest_mismatch:${manifestCount}:${japanRows.length}`);

const report = {
  version: 1,
  mode: "japan_strict_exact_frame_merge_publish",
  published: true,
  generationId: manifest.generationId,
  inputNew: incoming.length,
  inputCurrent: current.length,
  strictBeforeDiversity: strictRows.length,
  count: japanRows.length,
  maxOffersPerModel,
  maxModelsPerMake,
  distinctModels: modelCounts.size,
  distinctMakes: modelsByMake.size,
  sourceCounts: Object.fromEntries([...new Set(japanRows.map((offer) => String(offer.sourceId || "unknown")))].map((sourceId) => [sourceId, japanRows.filter((offer) => String(offer.sourceId || "unknown") === sourceId).length])),
  preservedByMarket,
  rejected,
};
await fs.writeFile(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
