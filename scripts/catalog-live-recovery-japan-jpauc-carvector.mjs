import fs from "node:fs/promises";
import { isJapanCommercialAuctionOffer } from "../apps/web/lib/catalog/japan-commercial.ts";

process.env.CATALOG_REBUILD_MIN_IMAGES_PER_OFFER ||= "3";
process.env.CATALOG_MAX_IMAGES_PER_OFFER ||= "30";
process.env.CATALOG_IMAGE_STORAGE_MODE ||= "source_urls_only";

const { calculateOfferWithRussiaCustoms } = await import("../apps/web/lib/catalog/customs-pricing.ts");
const { credibleCatalogImages, catalogMinYearForMarket, isCatalogMarketSourceAllowed, isCrediblePublicOffer } = await import("../apps/web/lib/catalog/offer-quality.ts");
const { normalizeVehicleOfferSpecs } = await import("../apps/web/lib/catalog/spec-normalization.ts");
const { catalogModelYearQuotaKey, catalogExactModelKey } = await import("../apps/web/lib/catalog/inventory-quota.ts");
const { japanAuctionSoldIdentityVerified, japanAuctionSoldPriceVerified } = await import("../apps/web/lib/catalog/public-priority.ts");

const input = process.env.JAPAN_EXACT_RECOVERY_INPUT || "japan-carvector-jpauc-exact.json";
const output = process.env.JAPAN_EXACT_RECOVERY_OUTPUT || "catalog-rebuild-japan.json";
const target = Math.max(1, Math.min(30_000, Number(process.env.JAPAN_EXACT_RECOVERY_TARGET || 30_000)));
const concurrency = Math.max(1, Math.min(24, Number(process.env.JAPAN_EXACT_RECOVERY_CONCURRENCY || 12)));
const maxOffersPerModelYear = Math.max(20, Math.min(100, Number(process.env.CATALOG_MAX_OFFERS_PER_MODEL_YEAR || 100)));
const minYear = catalogMinYearForMarket("japan");
const ELECTRIFIED = /(?:\bhybrid\b|plug[ -]?in|phev|electric|\bev\b|e[ -]?power|fuel[ -]?cell|fcev|ハイブリッド|電気)/i;

function safeCalculation(offer) {
  const total = Number(offer?.totalRub || 0);
  const snapshot = offer?.calculationSnapshot || {};
  const customs = snapshot?.customs;
  const breakdown = snapshot?.breakdown;
  const exact = offer?.calculationStatus === "ready" && snapshot?.pricingConfidence === "exact";
  const controlledScenario = offer?.calculationStatus === "estimated" && snapshot?.pricingConfidence === "estimated"
    && customs?.vehicleCategory === "M1" && customs?.vehicleCategoryAssumed === true && customs?.personalUseAssumed === true
    && customs?.ageEstimated === false && !snapshot?.powerScenario && snapshot?.powerRequiresConfirmation !== true
    && (!Array.isArray(snapshot?.estimatedMarketFields) || snapshot.estimatedMarketFields.length === 0);
  return total > 0 && (exact || controlledScenario)
    && customs?.status === "ready" && Number.isFinite(Number(customs?.totalCustomsRub))
    && Array.isArray(breakdown) && breakdown.some((line) => line?.id === "car") && breakdown.some((line) => line?.id === "customs")
    && offer?.powertrainKind === "combustion" && Number(offer?.engineCc || 0) > 0 && Number(offer?.powerHp || 0) > 0;
}
function evidenceValid(offer) {
  const op = offer?.operational || {}; const raw = op?.raw || {};
  return offer?.sourceId === "jpauc_japan_past_open" && offer?.market === "japan"
    && offer?.offerType === "auction" && offer?.catalogKind === "auction_result" && offer?.auctionResult === "sold" && offer?.auctionPriceKind === "published_result"
    && /^https:\/\/jpauc\.com\/auction\/past\/detail\//.test(String(op.sourceUrl || ""))
    && /^https:\/\/carvector\.com\/stat\//.test(String(offer?.powerDataSource || ""))
    && raw?.carvectorEvidenceSourceId === "carvector_japan_stat_open" && raw?.carvectorExactFinalPrice === true && raw?.carvectorExactPower === true
    && raw?.carvectorCombustionOnly === true && raw?.exactJoinVersion === 1
    && Number(raw?.finalPriceJpy || 0) === Number(offer?.sourcePrice || 0)
    && raw?.recoveryExactSourceUrl === true && raw?.recoveryExactPhotoIdentity === true
    && raw?.listingBoundImages === true && raw?.photoIdentityVerified === true
    && !/goo-?net/i.test(`${offer?.powerDataSource || ""} ${JSON.stringify(raw)}`);
}
function order(a, b) {
  return Number(b.year || 0) - Number(a.year || 0)
    || Date.parse(String(b.auctionDate || "")) - Date.parse(String(a.auctionDate || ""))
    || Number(a.sourcePrice || Number.MAX_SAFE_INTEGER) - Number(b.sourcePrice || Number.MAX_SAFE_INTEGER)
    || String(a.id || "").localeCompare(String(b.id || ""));
}
function selectWithQuota(rows) {
  const counts = new Map(); const selected = []; let quotaSkipped = 0;
  for (const offer of rows.sort(order)) {
    const key = catalogModelYearQuotaKey(offer, "japan");
    const count = Number(counts.get(key) || 0);
    if (!key || count >= maxOffersPerModelYear) { quotaSkipped++; continue; }
    selected.push(offer); counts.set(key, count + 1);
    if (selected.length >= target) break;
  }
  return { selected, counts, quotaSkipped };
}
async function pool(rows, limit, worker) {
  const outputRows = new Array(rows.length); let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, rows.length || 1) }, async () => {
    while (true) { const index = cursor++; if (index >= rows.length) return; outputRows[index] = await worker(rows[index], index); }
  }));
  return outputRows;
}

const payload = JSON.parse(await fs.readFile(input, "utf8"));
const inputOffers = Array.isArray(payload?.offers) ? payload.offers : [];
const rejected = {};
function reject(reason) { rejected[reason] = Number(rejected[reason] || 0) + 1; return null; }
const calculated = await pool(inputOffers, concurrency, async (raw) => {
  let offer = normalizeVehicleOfferSpecs({ ...raw, status: "active", images: credibleCatalogImages(raw?.images || []).slice(0, 30) });
  if (Number(offer.year || 0) < minYear) return reject("year");
  if (!evidenceValid(offer)) return reject("evidence");
  if (offer.images.length < 3) return reject("images");
  if (isJapanCommercialAuctionOffer(offer)) return reject("commercial");
  if (ELECTRIFIED.test(`${offer.model || ""} ${offer.trim || ""} ${offer.fuel || ""}`)) return reject("electrified");
  if (!(Number(offer.engineCc || 0) >= 400) || !(Number(offer.powerHp || 0) >= 30) || offer.powerDataConfidence !== "source_exact") return reject("power_or_engine");
  try { offer = normalizeVehicleOfferSpecs(await calculateOfferWithRussiaCustoms(offer)); }
  catch { return reject("calculation_exception"); }
  if (!safeCalculation(offer)) return reject("calculation");
  offer.status = "active";
  offer.operational = { ...(offer.operational || {}), publicJapanSoldIdentityVerified: true, publicJapanSoldPriceVerified: true, photoIdentityVerified: true,
    raw: { ...(offer.operational?.raw || {}), recoveryCalculatedRub: true, recoveryCalculationScenario: offer.calculationStatus === "estimated" ? "m1_personal_use_assumption_only" : "exact", recoveryBodySourceOnly: true, listingBoundImages: true, photoIdentityVerified: true } };
  if (!japanAuctionSoldIdentityVerified(offer) || !japanAuctionSoldPriceVerified(offer)) return reject("sold_gate");
  if (!isCatalogMarketSourceAllowed(offer) || !isCrediblePublicOffer(offer)) return reject("quality");
  return offer;
});
const unique = [...new Map(calculated.filter(Boolean).map((offer) => [offer.id, offer])).values()];
const selection = selectWithQuota(unique);
const offers = selection.selected;
const report = {
  version: 1, mode: "jpauc_carvector_exact_sold_to_calculated_live_japan", market: "japan",
  inputCount: inputOffers.length, calculatedCount: unique.length, count: offers.length, target,
  maxOffersPerModelYear, quotaSkipped: selection.quotaSkipped, distinctModelYears: selection.counts.size,
  distinctModels: new Set(offers.map((offer) => catalogExactModelKey(offer, "japan")).filter(Boolean)).size,
  distinctMakes: new Set(offers.map((offer) => String(offer.make || "").toLowerCase()).filter(Boolean)).size,
  rejected,
};
await fs.writeFile(output, JSON.stringify({ offers, report }, null, 2));
console.log(JSON.stringify({ ...report, output }, null, 2));
if (!offers.length) process.exitCode = 1;
