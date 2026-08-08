import fs from "node:fs/promises";

process.env.CATALOG_REBUILD_MIN_IMAGES_PER_OFFER ||= "5";
process.env.CATALOG_MAX_IMAGES_PER_OFFER ||= "30";
process.env.CATALOG_IMAGE_STORAGE_MODE ||= "source_urls_only";

const { calculateOfferWithRussiaCustoms } = await import("../apps/web/lib/catalog/customs-pricing.ts");
const { credibleCatalogImages } = await import("../apps/web/lib/catalog/offer-quality.ts");
const { normalizeVehicleOfferSpecs } = await import("../apps/web/lib/catalog/spec-normalization.ts");
const { findVehicleModel, findVehicleVariant } = await import("../apps/web/lib/catalog/vehicle-knowledge.ts");

const input = process.env.PRESTIGE_RECOVERY_INPUT || "prestige-japan-exact-sold-repaired.json";
const output = process.env.PRESTIGE_RECOVERY_OUTPUT || "catalog-rebuild-japan.json";
const target = Math.max(1, Math.min(5_000, Number(process.env.PRESTIGE_RECOVERY_TARGET || 1_500)));
const preferredMaxRub = Math.max(500_000, Number(process.env.RECOVERY_PREFERRED_MAX_RUB || 8_000_000));
const concurrency = Math.max(1, Math.min(16, Number(process.env.PRESTIGE_RECOVERY_CONCURRENCY || 12)));
const minYear = new Date().getFullYear() - 15;
const EXACT_URL = /^https:\/\/prestigemotorsport\.com\.au\/auction-vehicle-display\/\?car_id=[A-Za-z0-9_-]+$/;
const EXACT_IMAGE = /^https:\/\/(?:\d+\.)?ajes\.com\/imgs\/[A-Za-z0-9_-]+$/i;
const COMMERCIAL_RE = /\b(?:truck|dump|tipper|bus|minibus|commercial|cargo|lorry|tractor|forklift|excavator|machinery|canter|fighter|dutro|forward|giga|elf|profia)\b/i;

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
async function uniqueVariantEnrich(offer) {
  const engineCc = Number(offer?.engineCc || 0);
  if (!(engineCc > 0)) return offer;
  const match = await findVehicleModel(offer).catch(() => null);
  if (!match) return offer;
  const variant = await findVehicleVariant(match.model, offer).catch(() => null);
  if (!variant || !(Number(variant.engineCc) > 0)) return offer;
  const tolerance = Math.max(20, Number(variant.engineCcTolerance || 80));
  if (Math.abs(Number(variant.engineCc) - engineCc) > tolerance) return offer;
  const powerHp = Number(offer.powerHp || 0) || Number(variant.powerHp || 0);
  return {
    ...offer,
    powerHp: powerHp || offer.powerHp,
    powerKw: offer.powerKw || variant.powerKw || (powerHp ? Math.round((powerHp / 1.359621617) * 10) / 10 : undefined),
    fuel: offer.fuel || variant.fuel,
    transmission: offer.transmission || variant.transmission,
    drive: offer.drive || variant.drive,
    generation: offer.generation || variant.generation,
    powertrainKind: offer.powertrainKind && offer.powertrainKind !== "unknown" ? offer.powertrainKind : variant.powertrainKind || offer.powertrainKind,
    icePowerKw: offer.icePowerKw || variant.icePowerKw,
    power30MinKw: offer.power30MinKw || variant.power30MinKw,
    power30MinKwByMotor: offer.power30MinKwByMotor?.length ? offer.power30MinKwByMotor : variant.power30MinKwByMotor,
    utilizationPowerKw: offer.utilizationPowerKw || variant.utilizationPowerKw,
    powerDataConfidence: offer.powerDataConfidence || "reference",
    powerDataSource: offer.powerDataSource || variant.sourceUrl || variant.sourceType,
    operational: {
      ...(offer.operational || {}),
      raw: {
        ...(offer.operational?.raw || {}),
        recoveryVariantId: variant.id,
        recoveryVariantSource: variant.sourceUrl || variant.sourceType,
        recoveryVariantEngineCc: variant.engineCc,
        recoveryBodySourceOnly: true,
      },
    },
  };
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
function finalOrder(a, b) {
  const ap = Number(a.totalRub || 0) <= preferredMaxRub ? 0 : 1;
  const bp = Number(b.totalRub || 0) <= preferredMaxRub ? 0 : 1;
  return ap - bp
    || Number(b.year || 0) - Number(a.year || 0)
    || Number(b.images?.length || 0) - Number(a.images?.length || 0)
    || Number(a.totalRub || Number.MAX_SAFE_INTEGER) - Number(b.totalRub || Number.MAX_SAFE_INTEGER);
}

const payload = JSON.parse(await fs.readFile(input, "utf8"));
const rows = (Array.isArray(payload?.offers) ? payload.offers : [])
  .filter((offer) => Number(offer?.year || 0) >= minYear)
  .sort(priority)
  .slice(0, Math.max(target * 8, target));
const rejected = {};
function reject(reason) { rejected[reason] = Number(rejected[reason] || 0) + 1; }

const prepared = await pool(rows, concurrency, async (raw) => {
  let offer = normalizeVehicleOfferSpecs({ ...raw, status: "active", images: credibleCatalogImages(raw?.images || []).slice(0, 30) });
  const op = offer?.operational || {};
  const sourceRaw = op?.raw || {};
  if (offer.sourceId !== "prestige_japan_auctions_open" || offer.market !== "japan") { reject("source"); return null; }
  if (offer.offerType !== "auction" || offer.catalogKind !== "auction_result" || offer.auctionResult !== "sold" || offer.auctionPriceKind !== "published_result") { reject("auction_semantics"); return null; }
  if (sourceRaw.currentStatus !== "Sold" || Number(sourceRaw.finalPriceJpy || 0) !== Number(offer.sourcePrice || 0) || offer.sourceCurrency !== "JPY") { reject("final_price"); return null; }
  if (!EXACT_URL.test(String(op.sourceUrl || ""))) { reject("source_url"); return null; }
  if (offer.images.length < 5 || offer.images.some((image) => !EXACT_IMAGE.test(String(image?.url || "")))) { reject("images"); return null; }
  if (COMMERCIAL_RE.test(`${offer.make || ""} ${offer.model || ""} ${offer.trim || ""}`)) { reject("commercial"); return null; }
  if (!(Number(offer.engineCc || 0) > 0)) { reject("engine_cc"); return null; }
  offer = normalizeVehicleOfferSpecs(await uniqueVariantEnrich(offer));
  let calculated;
  try { calculated = normalizeVehicleOfferSpecs(await calculateOfferWithRussiaCustoms(offer)); }
  catch { reject("calculation_exception"); return null; }
  if (!exactCalculation(calculated)) { reject("calculation_pending"); return null; }
  calculated.status = "active";
  calculated.operational = {
    ...(calculated.operational || {}),
    raw: {
      ...(calculated.operational?.raw || {}),
      recoveryExactSourceUrl: true,
      recoveryExactPhotoIdentity: true,
      recoveryCalculatedRub: true,
      recoveryBodySourceOnly: true,
    },
  };
  return calculated;
});

const seen = new Set();
const offers = prepared.filter(Boolean).sort(finalOrder).filter((offer) => {
  if (seen.has(offer.id)) return false;
  seen.add(offer.id);
  return true;
}).slice(0, target);
const report = {
  version: 1,
  mode: "prestige_strict_sold_to_calculated_live_japan",
  market: "japan",
  inputCount: Array.isArray(payload?.offers) ? payload.offers.length : 0,
  candidateCount: rows.length,
  count: offers.length,
  target,
  minYear,
  preferredMaxRub,
  preferredCount: offers.filter((offer) => Number(offer.totalRub || 0) <= preferredMaxRub).length,
  calculatedCount: offers.filter(exactCalculation).length,
  rejected,
  passed: offers.length > 0,
};
await fs.writeFile(output, JSON.stringify({ market: "japan", count: offers.length, partial: offers.length < target, report, offers }, null, 2));
console.log(JSON.stringify(report, null, 2));
if (!offers.length) process.exit(1);
