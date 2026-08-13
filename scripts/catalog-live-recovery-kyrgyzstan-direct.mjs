import fs from "node:fs/promises";

process.env.CATALOG_IMAGE_STORAGE_MODE = "source_urls_only";
process.env.CATALOG_MAX_IMAGES_PER_OFFER ||= "30";

const { mashinaKyrgyzstanListSource: source } = await import("../apps/web/lib/catalog/mashina-kyrgyzstan-list-source.ts");
const { normalizeVehicleOfferSpecs } = await import("../apps/web/lib/catalog/spec-normalization.ts");
const { calculateOfferWithRussiaCustoms, isPreliminaryElectrifiedCalculation } = await import("../apps/web/lib/catalog/customs-pricing.ts");
const { credibleCatalogImages, catalogMinYearForMarket } = await import("../apps/web/lib/catalog/offer-quality.ts");
const { findVehicleModel, readVehicleKnowledgeVariants } = await import("../apps/web/lib/catalog/vehicle-knowledge.ts");
const { CATALOG_MAX_OFFERS_PER_MODEL_YEAR, catalogModelYearQuotaKey, catalogExactModelKey } = await import("../apps/web/lib/catalog/inventory-quota.ts");

const target = Math.max(1, Math.min(10_000, Number(process.env.RECOVERY_TARGET || 5_000)));
const maxPages = Math.max(1, Math.min(500, Number(process.env.RECOVERY_MAX_PAGES || 240)));
const maxPreferredRub = Math.max(500_000, Number(process.env.RECOVERY_PREFERRED_MAX_RUB || 8_000_000));
const maxOffersPerModelYear = CATALOG_MAX_OFFERS_PER_MODEL_YEAR;
const timeLimitMs = Math.max(60_000, Math.min(5_400_000, Number(process.env.RECOVERY_TIME_LIMIT_MS || 5_100_000)));
const minYear = catalogMinYearForMarket("kyrgyzstan");
const output = process.env.RECOVERY_OUTPUT || "catalog-rebuild-kyrgyzstan.json";
const deadline = Date.now() + timeLimitMs;
const COMMERCIAL_RE = /\b(?:truck|bus|minibus|commercial|cargo|tractor|forklift|excavator|agricultural|scooter|motorcycle|quad\s*bike|sprinter|transit|crafter|ducato|boxer|jumper|canter|elf|dutro|fuso|hino)\b/i;

function sourceImage(url) {
  const value = String(url || "").trim();
  const ext = value.match(/\.(jpe?g|webp|avif|png)(?:[?#]|$)/i)?.[1]?.toLowerCase();
  return {
    id: "", url: value, objectKey: "", checksum: "", size: 0,
    mimeType: ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : ext === "avif" ? "image/avif" : "image/jpeg",
  };
}
function hostOk(value) {
  try {
    const host = new URL(String(value || "")).hostname.toLowerCase();
    return host === "mashina.kg" || host.endsWith(".mashina.kg");
  } catch { return false; }
}
function rawBoundImages(offer) {
  const op = offer?.operational || {};
  const raw = op?.raw || {};
  const parsed = raw?.parsed || {};
  const sourceUrl = String(op.sourceUrl || "");
  const urls = Array.isArray(raw.images) ? raw.images.map(String).filter(Boolean) : [];
  if (!sourceUrl || !hostOk(sourceUrl) || !urls.length) return [];
  if (String(parsed.detailUrl || "") !== sourceUrl) return [];
  if (String(parsed.id || "") !== String(offer?.sourceOfferId || "")) return [];
  if (raw.listingBoundImages !== true || raw.photoIdentityVerified !== true) return [];
  return credibleCatalogImages(urls.map(sourceImage)).slice(0, 30);
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
async function fillOnlyUnambiguousSpecs(input) {
  let offer = normalizeVehicleOfferSpecs(input);
  const year = Number(offer.year || 0);
  if (!year) return offer;
  const modelMatch = await findVehicleModel(offer).catch(() => null);
  if (!modelMatch) return offer;
  const allVariants = await readVehicleKnowledgeVariants().catch(() => []);
  const variants = allVariants.filter((variant) => {
    if (variant.active === false || variant.modelId !== modelMatch.model.id) return false;
    if (variant.yearFrom && year < variant.yearFrom) return false;
    if (variant.yearTo && year > variant.yearTo) return false;
    const engine = Number(offer.engineCc || 0);
    if (engine > 0 && Number(variant.engineCc || 0) > 0) {
      const tolerance = Math.max(20, Number(variant.engineCcTolerance || 80));
      if (Math.abs(Number(variant.engineCc) - engine) > tolerance) return false;
    }
    const power = Number(offer.powerHp || 0);
    if (power > 0 && Number(variant.powerHp || 0) > 0 && Math.abs(Number(variant.powerHp) - power) > 2) return false;
    if (!compatibleText(variant.fuel, offer.fuel)) return false;
    if (!compatibleText(variant.transmission, offer.transmission)) return false;
    if (!compatibleText(variant.drive, offer.drive)) return false;
    return true;
  });
  if (!variants.length) return offer;

  const engineCc = Number(offer.engineCc || 0) || uniqueNumber(variants, (variant) => variant.engineCc);
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
  const enriched = Boolean((!offer.engineCc && engineCc) || (!offer.powerHp && powerHp) || power30MinKw || utilizationPowerKw || icePowerKw);

  return normalizeVehicleOfferSpecs({
    ...offer,
    engineCc: engineCc || offer.engineCc,
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
        recoveryUnambiguousVariantIds: variants.map((variant) => variant.id).slice(0, 30),
        recoveryUnambiguousEngineCc: engineCc || null,
        recoveryUnambiguousPowerHp: powerHp || null,
        recoveryBodySourceOnly: true,
      },
    },
  });
}
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
function makeKey(offer) { return String(offer?.make || "").trim().toLocaleLowerCase("en-US").replace(/\s+/g, " "); }
function quality(a, b) {
  const ap = Number(a.totalRub || 0) <= maxPreferredRub ? 0 : 1;
  const bp = Number(b.totalRub || 0) <= maxPreferredRub ? 0 : 1;
  return ap - bp || Number(b.year || 0) - Number(a.year || 0) || Number(b.images?.length || 0) - Number(a.images?.length || 0) || Number(a.totalRub || Number.MAX_SAFE_INTEGER) - Number(b.totalRub || Number.MAX_SAFE_INTEGER);
}
function reject(counter, key) { counter[key] = Number(counter[key] || 0) + 1; }

const candidates = [];
const rejections = {};
const errors = [];
const ids = new Set();
let cursor = null;
let pages = 0;
let seen = 0;
let normalized = 0;

while (pages < maxPages && Date.now() < deadline) {
  let page;
  try { page = await source.fetchPage(cursor); }
  catch (error) { errors.push({ stage: "page", cursor, error: String(error?.message || error) }); break; }
  pages++;
  const rows = Array.isArray(page?.items) ? page.items : [];
  seen += rows.length;
  for (const raw of rows) {
    if (Date.now() >= deadline) break;
    let offer;
    try { offer = source.normalizeOffer(raw); } catch { reject(rejections, "normalize"); continue; }
    if (!offer || ids.has(offer.id)) { if (!offer) reject(rejections, "normalize"); continue; }
    ids.add(offer.id);
    normalized++;
    offer = normalizeVehicleOfferSpecs(offer);
    const year = Number(offer.year || 0);
    if (year < minYear || year > new Date().getFullYear() + 1) { reject(rejections, "year"); continue; }
    if (!offer.make || !offer.model || !offer.sourceOfferId || !hostOk(offer.operational?.sourceUrl)) { reject(rejections, "identity"); continue; }
    if (!(Number(offer.sourcePrice) > 0) || !String(offer.sourceCurrency || "").trim()) { reject(rejections, "source_price"); continue; }
    if (COMMERCIAL_RE.test(`${offer.make} ${offer.model} ${offer.trim || ""} ${offer.bodyType || ""}`)) { reject(rejections, "commercial"); continue; }
    const exactImages = rawBoundImages(offer);
    if (!exactImages.length) { reject(rejections, "exact_images"); continue; }
    offer.images = exactImages;
    offer = await fillOnlyUnambiguousSpecs(offer);
    let calculated;
    try { calculated = normalizeVehicleOfferSpecs(await calculateOfferWithRussiaCustoms(offer)); }
    catch (error) { errors.push({ stage: "calculation", sourceOfferId: offer.sourceOfferId, error: String(error?.message || error) }); reject(rejections, "calculation_exception"); continue; }
    if (!exactCalculation(calculated) && !isPreliminaryElectrifiedCalculation(calculated)) { reject(rejections, "calculation_pending"); continue; }
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
        recoveryPreliminaryPowerPending: isPreliminaryElectrifiedCalculation(calculated),
        recoveryBodySourceOnly: true,
        recoveryDirectExactAdapter: true,
      },
    };
    candidates.push(calculated);
  }
  if (!page?.nextCursor || page?.finished) break;
  cursor = page.nextCursor;
}

candidates.sort(quality);
const offers = [];
const countByModelYear = new Map();
for (const offer of candidates) {
  const model = catalogModelYearQuotaKey(offer, "kyrgyzstan");
  if (!model) continue;
  if (Number(countByModelYear.get(model) || 0) >= maxOffersPerModelYear) { reject(rejections, "model_year_quota"); continue; }
  countByModelYear.set(model, Number(countByModelYear.get(model) || 0) + 1);
  offers.push(offer);
  if (offers.length >= target) break;
}

const report = {
  version: 1,
  mode: "kyrgyzstan_mashina_exact_calculated_recovery",
  market: "kyrgyzstan",
  sourceId: source.sourceId,
  minYear,
  preferredMaxRub: maxPreferredRub,
  maxOffersPerModelYear,
  pages,
  seen,
  normalized,
  count: offers.length,
  preferredCount: offers.filter((offer) => Number(offer.totalRub || 0) <= maxPreferredRub).length,
  calculatedCount: offers.filter(exactCalculation).length,
  preliminaryCount: offers.filter(isPreliminaryElectrifiedCalculation).length,
  distinctModels: new Set(offers.map((offer) => catalogExactModelKey(offer, "kyrgyzstan")).filter(Boolean)).size,
  distinctModelYears: countByModelYear.size,
  distinctMakes: new Set(offers.map(makeKey)).size,
  imageStats: {
    min: offers.length ? Math.min(...offers.map((offer) => offer.images.length)) : 0,
    max: offers.length ? Math.max(...offers.map((offer) => offer.images.length)) : 0,
    average: offers.length ? Number((offers.reduce((sum, offer) => sum + offer.images.length, 0) / offers.length).toFixed(2)) : 0,
  },
  rejections,
  errors: errors.slice(0, 100),
  passed: offers.length > 0,
};
await fs.writeFile(output, JSON.stringify({ market: "kyrgyzstan", count: offers.length, report, offers }, null, 2));
console.log(JSON.stringify(report, null, 2));
if (!offers.length) process.exit(1);
