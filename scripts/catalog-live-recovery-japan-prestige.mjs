import fs from "node:fs/promises";
import { isJapanCommercialAuctionOffer } from "../apps/web/lib/catalog/japan-commercial.ts";

process.env.CATALOG_REBUILD_MIN_IMAGES_PER_OFFER ||= "5";
process.env.CATALOG_MAX_IMAGES_PER_OFFER ||= "30";
process.env.CATALOG_IMAGE_STORAGE_MODE ||= "source_urls_only";

const { calculateOfferWithPreliminaryPowerPricing, isPreliminaryPowerPendingCalculation } = await import("../apps/web/lib/catalog/customs-pricing.ts");
const { credibleCatalogImages, catalogMinYearForMarket } = await import("../apps/web/lib/catalog/offer-quality.ts");
const { normalizeVehicleOfferSpecs } = await import("../apps/web/lib/catalog/spec-normalization.ts");
const { CATALOG_MAX_OFFERS_PER_MODEL_YEAR, catalogModelYearQuotaKey, catalogExactModelKey } = await import("../apps/web/lib/catalog/inventory-quota.ts");
const { enrichOfferWithCertifiedPower } = await import("../apps/web/lib/catalog/power-reference.ts");
const { findVehicleModel, readVehicleKnowledgeVariants } = await import("../apps/web/lib/catalog/vehicle-knowledge.ts");
const { canonicalPrestigeJapanIdentity } = await import("../apps/web/lib/catalog/prestige-japan-exact-source.ts");

const input = process.env.PRESTIGE_RECOVERY_INPUT || "prestige-japan-exact-sold-repaired.json";
const output = process.env.PRESTIGE_RECOVERY_OUTPUT || "catalog-rebuild-japan.json";
const target = Math.max(1, Math.min(30_000, Number(process.env.PRESTIGE_RECOVERY_TARGET || 1_500)));
const preferredMaxRub = Math.max(500_000, Number(process.env.RECOVERY_PREFERRED_MAX_RUB || 8_000_000));
const maxOffersPerModelYear = CATALOG_MAX_OFFERS_PER_MODEL_YEAR;
const candidateMaxOffersPerModelYear = maxOffersPerModelYear * 4;
const concurrency = Math.max(1, Math.min(16, Number(process.env.PRESTIGE_RECOVERY_CONCURRENCY || 12)));
const minYear = catalogMinYearForMarket("japan");
const EXACT_URL = /^https:\/\/prestigemotorsport\.com\.au\/auction-vehicle-display\/\?car_id=[A-Za-z0-9_-]+$/;
const EXACT_IMAGE = /^https:\/\/(?:\d+\.)?ajes\.com\/imgs\/[A-Za-z0-9_-]+$/i;

function exactCalculation(offer) {
  const total = Number(offer?.totalRub || 0);
  const customs = offer?.calculationSnapshot?.customs;
  const breakdown = offer?.calculationSnapshot?.breakdown;
  if (!(total > 0) || customs?.status !== "ready" || !Number.isFinite(Number(customs?.totalCustomsRub))) return false;
  if (!Array.isArray(breakdown) || !breakdown.some((line) => line?.id === "car") || !breakdown.some((line) => line?.id === "customs")) return false;
  const kind = String(offer?.powertrainKind || "");
  if (!["electric", "series_hybrid", "other_hybrid"].includes(kind)) return Number(offer?.engineCc || 0) > 0 && Number(offer?.powerHp || 0) > 0;
  if (Number(offer?.utilizationPowerKw || 0) > 0) return true;
  const motor30 = Number(offer?.power30MinKw || 0) || (Array.isArray(offer?.power30MinKwByMotor) ? offer.power30MinKwByMotor.reduce((sum, value) => sum + Math.max(0, Number(value || 0)), 0) : 0);
  return kind === "other_hybrid" ? motor30 > 0 && Number(offer?.icePowerKw || 0) > 0 : motor30 > 0;
}
function token(value) { return String(value || "").toLocaleLowerCase("en-US").replace(/[^\p{L}\p{N}]+/gu, ""); }
function compatibleText(left, right) {
  const a = token(left), b = token(right);
  return !a || !b || a === b || a.includes(b) || b.includes(a);
}
function uniqueNumber(rows, selector) {
  const values = [...new Set(rows.map(selector).map(Number).filter((value) => Number.isFinite(value) && value > 0).map((value) => Math.round(value * 1000) / 1000))];
  return values.length === 1 ? values[0] : undefined;
}
function uniqueText(rows, selector) {
  const values = [...new Set(rows.map(selector).map((value) => String(value || "").trim()).filter(Boolean))];
  return values.length === 1 ? values[0] : undefined;
}
function uniqueNumberArray(rows, selector) {
  const encoded = [...new Set(rows.map(selector).filter((value) => Array.isArray(value) && value.length).map((value) => JSON.stringify(value.map(Number))))];
  return encoded.length === 1 ? JSON.parse(encoded[0]) : undefined;
}
async function uniqueVariantEnrich(offer) {
  const engineCc = Number(offer?.engineCc || 0);
  const year = Number(offer?.year || 0);
  if (!year) return offer;
  const match = await findVehicleModel(offer).catch(() => null);
  if (!match) return offer;
  const allVariants = await readVehicleKnowledgeVariants().catch(() => []);
  const baseVariants = allVariants.filter((variant) => {
    if (variant.active === false || variant.modelId !== match.model.id) return false;
    if (variant.yearFrom && year < variant.yearFrom) return false;
    if (variant.yearTo && year > variant.yearTo) return false;
    if (!compatibleText(variant.transmission, offer.transmission)) return false;
    if (!compatibleText(variant.fuel, offer.fuel)) return false;
    return true;
  });
  let variants = [];
  if (engineCc > 0) {
    variants = baseVariants.filter((variant) => {
      if (!(Number(variant.engineCc || 0) > 0)) return false;
      const tolerance = Math.max(20, Number(variant.engineCcTolerance || 80));
      return Math.abs(Number(variant.engineCc) - engineCc) <= tolerance;
    });
  } else {
    const strictModelMatch = match.matchedBy !== "text" && Number(match.score || 0) >= 120;
    const allExplicitElectric = baseVariants.length > 0 && baseVariants.every((variant) =>
      String(variant.powertrainKind || "") === "electric" && !(Number(variant.engineCc || 0) > 0));
    if (strictModelMatch && allExplicitElectric) variants = baseVariants;
  }
  if (!variants.length) return offer;

  const powerHp = Number(offer.powerHp || 0) || uniqueNumber(variants, (variant) => variant.powerHp);
  const powerKw = Number(offer.powerKw || 0) || uniqueNumber(variants, (variant) => variant.powerKw) || (powerHp ? Math.round((powerHp / 1.359621617) * 10) / 10 : undefined);
  const fuel = offer.fuel || uniqueText(variants, (variant) => variant.fuel);
  const transmission = offer.transmission || uniqueText(variants, (variant) => variant.transmission);
  const drive = offer.drive || uniqueText(variants, (variant) => variant.drive);
  const generation = offer.generation || uniqueText(variants, (variant) => variant.generation);
  const powertrainKind = offer.powertrainKind && offer.powertrainKind !== "unknown" ? offer.powertrainKind : uniqueText(variants, (variant) => variant.powertrainKind) || offer.powertrainKind;
  const icePowerKw = Number(offer.icePowerKw || 0) || uniqueNumber(variants, (variant) => variant.icePowerKw);
  const power30MinKw = Number(offer.power30MinKw || 0) || uniqueNumber(variants, (variant) => variant.power30MinKw);
  const power30MinKwByMotor = offer.power30MinKwByMotor?.length ? offer.power30MinKwByMotor : uniqueNumberArray(variants, (variant) => variant.power30MinKwByMotor);
  const utilizationPowerKw = Number(offer.utilizationPowerKw || 0) || uniqueNumber(variants, (variant) => variant.utilizationPowerKw);
  const enriched = Boolean(powerHp || power30MinKw || utilizationPowerKw || icePowerKw || powertrainKind === "electric");

  return normalizeVehicleOfferSpecs({
    ...offer,
    powerHp: powerHp || offer.powerHp,
    powerKw: powerKw || offer.powerKw,
    fuel,
    transmission,
    drive,
    generation,
    powertrainKind,
    icePowerKw: icePowerKw || offer.icePowerKw,
    power30MinKw: power30MinKw || offer.power30MinKw,
    power30MinKwByMotor,
    utilizationPowerKw: utilizationPowerKw || offer.utilizationPowerKw,
    powerDataConfidence: offer.powerDataConfidence || (enriched ? "reference" : undefined),
    powerDataSource: offer.powerDataSource || (enriched ? uniqueText(variants, (variant) => variant.sourceUrl || variant.sourceType) || "vehicle-knowledge-unambiguous" : undefined),
    operational: {
      ...(offer.operational || {}),
      raw: {
        ...(offer.operational?.raw || {}),
        recoveryVariantIds: variants.map((variant) => variant.id).slice(0, 30),
        recoveryVariantEngineCc: engineCc || null,
        recoveryEngineLessElectricKnowledge: engineCc <= 0 && powertrainKind === "electric",
        recoveryVehicleModelMatchScore: match.score,
        recoveryVehicleModelMatchedBy: match.matchedBy,
        recoveryUniquePowerHp: powerHp || null,
        recoveryUniquePower30MinKw: power30MinKw || null,
        recoveryUniqueUtilizationPowerKw: utilizationPowerKw || null,
        recoveryBodySourceOnly: true,
      },
    },
  });
}
async function pool(rows, limit, worker) {
  const result = new Array(rows.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, rows.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= rows.length) return;
      result[index] = await worker(rows[index], index);
    }
  }));
  return result;
}
function priority(a, b) {
  return Number(b.year || 0) - Number(a.year || 0)
    || Number(a.sourcePrice || Number.MAX_SAFE_INTEGER) - Number(b.sourcePrice || Number.MAX_SAFE_INTEGER)
    || Number(b.images?.length || 0) - Number(a.images?.length || 0);
}
function makeKey(offer) { return String(offer?.make || "").trim().toLowerCase().replace(/\s+/g, " "); }
function takeWithPerModelYearCap(rows, limit, perModelCap = maxOffersPerModelYear) {
  const counts = new Map();
  const makes = new Set();
  const result = [];
  let quotaSkipped = 0;
  for (const offer of rows) {
    const key = catalogModelYearQuotaKey(offer, "japan");
    const count = key ? Number(counts.get(key) || 0) : 0;
    if (key && count >= perModelCap) { quotaSkipped++; continue; }
    result.push(offer);
    if (key) counts.set(key, count + 1);
    if (makeKey(offer)) makes.add(makeKey(offer));
    if (result.length >= limit) break;
  }
  return { rows: result, quotaSkipped, distinctModels: new Set(result.map((offer) => catalogExactModelKey(offer, "japan")).filter(Boolean)).size, distinctModelYears: counts.size, distinctMakes: makes.size };
}
function finalOrder(a, b) {
  const ap = Number(a.totalRub || 0) <= preferredMaxRub ? 0 : 1;
  const bp = Number(b.totalRub || 0) <= preferredMaxRub ? 0 : 1;
  return ap - bp
    || Number(b.year || 0) - Number(a.year || 0)
    || Number(b.images?.length || 0) - Number(a.images?.length || 0)
    || Number(a.totalRub || Number.MAX_SAFE_INTEGER) - Number(b.totalRub || Number.MAX_SAFE_INTEGER);
}

const payload = JSON.parse(await fs.readFile(input, "utf8"));
const eligibleRows = (Array.isArray(payload?.offers) ? payload.offers : [])
  .filter((offer) => Number(offer?.year || 0) >= minYear)
  .sort(priority);
const candidateSelection = takeWithPerModelYearCap(eligibleRows, Math.max(target * 8, target), candidateMaxOffersPerModelYear);
const rows = candidateSelection.rows;
const rejected = {};
function reject(reason) { rejected[reason] = Number(rejected[reason] || 0) + 1; }

const prepared = await pool(rows, concurrency, async (raw) => {
  const identity = canonicalPrestigeJapanIdentity(raw?.make, raw?.model);
  let offer = normalizeVehicleOfferSpecs({ ...raw, ...identity, status: "active", images: credibleCatalogImages(raw?.images || []).slice(0, 30) });
  const op = offer?.operational || {};
  const sourceRaw = op?.raw || {};
  if (offer.sourceId !== "prestige_japan_auctions_open" || offer.market !== "japan") { reject("source"); return null; }
  if (offer.offerType !== "auction" || offer.catalogKind !== "auction_result" || offer.auctionResult !== "sold" || offer.auctionPriceKind !== "published_result") { reject("auction_semantics"); return null; }
  if (sourceRaw.currentStatus !== "Sold" || Number(sourceRaw.finalPriceJpy || 0) !== Number(offer.sourcePrice || 0) || offer.sourceCurrency !== "JPY") { reject("final_price"); return null; }
  if (!EXACT_URL.test(String(op.sourceUrl || ""))) { reject("source_url"); return null; }
  if (offer.images.length < 5 || offer.images.some((image) => !EXACT_IMAGE.test(String(image?.url || "")))) { reject("images"); return null; }
  if (isJapanCommercialAuctionOffer(offer)) { reject("commercial"); return null; }
  offer = await uniqueVariantEnrich(offer);
  offer = normalizeVehicleOfferSpecs(await enrichOfferWithCertifiedPower(offer));
  if (!(Number(offer.engineCc || 0) > 0) && String(offer.powertrainKind || "") !== "electric") { reject("engine_cc"); return null; }
  let calculated;
  try { calculated = normalizeVehicleOfferSpecs(await calculateOfferWithPreliminaryPowerPricing(offer)); }
  catch { reject("calculation_exception"); return null; }
  if (!exactCalculation(calculated) && !isPreliminaryPowerPendingCalculation(calculated)) { reject("calculation_pending"); return null; }
  calculated.status = "active";
  calculated.operational = {
    ...(calculated.operational || {}),
    photoIdentityVerified: true,
    raw: {
      ...(calculated.operational?.raw || {}),
      listingBoundImages: true,
      photoIdentityVerified: true,
      recoveryExactSourceUrl: true,
      recoveryExactPhotoIdentity: true,
      recoveryCalculatedRub: true,
      recoveryBodySourceOnly: true,
    },
  };
  return calculated;
});

const seen = new Set();
const uniquePrepared = prepared.filter(Boolean).sort(finalOrder).filter((offer) => {
  if (seen.has(offer.id)) return false;
  seen.add(offer.id);
  return true;
});
const finalSelection = takeWithPerModelYearCap(uniquePrepared, target);
const offers = finalSelection.rows;
const report = {
  version: 2,
  mode: "prestige_strict_sold_to_calculated_live_japan",
  market: "japan",
  inputCount: Array.isArray(payload?.offers) ? payload.offers.length : 0,
  candidateCount: rows.length,
  count: offers.length,
  target,
  candidateModelYearQuotaSkipped: candidateSelection.quotaSkipped,
  finalModelYearQuotaSkipped: finalSelection.quotaSkipped,
  distinctModels: finalSelection.distinctModels,
  distinctModelYears: finalSelection.distinctModelYears,
  distinctMakes: finalSelection.distinctMakes,
  maxOffersPerModelYear,
  candidateMaxOffersPerModelYear,
  preliminaryCount: offers.filter(isPreliminaryPowerPendingCalculation).length,
  exactCalculatedCount: offers.filter(exactCalculation).length,
  electricCount: offers.filter((offer) => String(offer.powertrainKind || "") === "electric").length,
  hybridCount: offers.filter((offer) => ["series_hybrid", "other_hybrid"].includes(String(offer.powertrainKind || ""))).length,
  preferredCount: offers.filter((offer) => Number(offer.totalRub || 0) <= preferredMaxRub).length,
  rejected,
};
await fs.writeFile(output, JSON.stringify({ offers, report }, null, 2));
console.log(JSON.stringify(report, null, 2));
if (!offers.length) process.exit(1);
