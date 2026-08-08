import fs from "node:fs/promises";

process.env.CATALOG_IMAGE_STORAGE_MODE = "source_urls_only";
process.env.CATALOG_MAX_IMAGES_PER_OFFER ||= "30";

const { otomotoEuropeDetailSource: source } = await import("../apps/web/lib/catalog/otomoto-detail-source.ts");
const { normalizeVehicleOfferSpecs } = await import("../apps/web/lib/catalog/spec-normalization.ts");
const { calculateOfferWithRussiaCustoms } = await import("../apps/web/lib/catalog/customs-pricing.ts");
const { credibleCatalogImages } = await import("../apps/web/lib/catalog/offer-quality.ts");
const { findVehicleModel, readVehicleKnowledgeVariants } = await import("../apps/web/lib/catalog/vehicle-knowledge.ts");

const target = Math.max(1, Math.min(3000, Number(process.env.RECOVERY_TARGET || 1000)));
const maxPages = Math.max(1, Math.min(100, Number(process.env.RECOVERY_MAX_PAGES || 45)));
const maxPreferredRub = Math.max(500_000, Number(process.env.RECOVERY_PREFERRED_MAX_RUB || 8_000_000));
const maxOffersPerModel = Math.max(1, Math.min(100, Number(process.env.CATALOG_MAX_OFFERS_PER_MODEL || 20)));
const maxModelsPerMake = Math.max(1, Math.min(50, Number(process.env.CATALOG_MAX_MODELS_PER_MAKE || 10)));
const minYear = new Date().getFullYear() - 15;
const output = process.env.RECOVERY_OUTPUT || "catalog-rebuild-europe.json";
const timeLimitMs = Math.max(60_000, Math.min(5_400_000, Number(process.env.RECOVERY_TIME_LIMIT_MS || 2_700_000)));
const deadline = Date.now() + timeLimitMs;

function sourceImage(url) {
  const value = String(url || "").trim();
  const ext = value.match(/\.(jpe?g|webp|avif|png)(?:[?#]|$)/i)?.[1]?.toLowerCase();
  return {
    id: "",
    url: value,
    objectKey: "",
    checksum: "",
    size: 0,
    mimeType: ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : ext === "avif" ? "image/avif" : "image/jpeg",
  };
}
function token(value) { return String(value || "").toLocaleLowerCase("en-US").replace(/[^\p{L}\p{N}]+/gu, ""); }
function compatibleText(left, right) {
  const a = token(left), b = token(right);
  return !a || !b || a === b || a.includes(b) || b.includes(a);
}
function hostOk(value) {
  try {
    const host = new URL(String(value || "")).hostname.toLowerCase();
    return host === "otomoto.pl" || host.endsWith(".otomoto.pl");
  } catch { return false; }
}
function rawBoundImages(offer) {
  const op = offer?.operational || {};
  const raw = op?.raw || {};
  const sourceUrl = String(op.sourceUrl || "");
  const urls = Array.isArray(raw.images) ? raw.images.map(String).filter(Boolean) : [];
  if (!hostOk(sourceUrl) || String(raw.url || "") !== sourceUrl || String(raw.id || "") !== String(offer?.sourceOfferId || "") || !urls.length) return [];
  return credibleCatalogImages(urls.map(sourceImage)).slice(0, 30);
}
async function fillOnlyUnambiguousSpecs(input) {
  let offer = normalizeVehicleOfferSpecs(input);
  const year = Number(offer.year || 0);
  if (!year) return offer;
  const modelMatch = await findVehicleModel(offer).catch(() => null);
  if (!modelMatch) return offer;
  const variants = (await readVehicleKnowledgeVariants()).filter((variant) => {
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
  const engineValues = [...new Set(variants.map((v) => Math.round(Number(v.engineCc || 0))).filter((v) => v > 0))];
  const powerValues = [...new Set(variants.map((v) => Math.round(Number(v.powerHp || 0) * 10) / 10).filter((v) => v > 0))];
  const canFillEngine = !Number(offer.engineCc || 0) && engineValues.length === 1;
  const canFillPower = !Number(offer.powerHp || 0) && powerValues.length === 1;
  if (!canFillEngine && !canFillPower) return offer;
  const chosen = variants.find((v) => (!canFillEngine || Math.round(Number(v.engineCc || 0)) === engineValues[0]) && (!canFillPower || Math.round(Number(v.powerHp || 0) * 10) / 10 === powerValues[0]));
  return normalizeVehicleOfferSpecs({
    ...offer,
    engineCc: offer.engineCc || (canFillEngine ? engineValues[0] : undefined),
    powerHp: offer.powerHp || (canFillPower ? powerValues[0] : undefined),
    powerKw: offer.powerKw || (canFillPower ? Math.round((powerValues[0] / 1.359621617) * 10) / 10 : undefined),
    powerDataConfidence: offer.powerDataConfidence || ((canFillEngine || canFillPower) ? "reference" : undefined),
    powerDataSource: offer.powerDataSource || chosen?.sourceUrl || chosen?.sourceType,
    operational: {
      ...(offer.operational || {}),
      raw: {
        ...(offer.operational?.raw || {}),
        recoveryUnambiguousVariantIds: variants.map((v) => v.id).slice(0, 20),
        recoveryUnambiguousEngineValues: engineValues,
        recoveryUnambiguousPowerValues: powerValues,
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
function modelKey(offer) {
  const make = makeKey(offer);
  const model = String(offer?.model || "").trim().toLocaleLowerCase("en-US").replace(/\s+/g, " ");
  return make && model ? `${make}|${model}` : "";
}
function quality(a, b) {
  const ap = Number(a.totalRub || 0) <= maxPreferredRub ? 0 : 1;
  const bp = Number(b.totalRub || 0) <= maxPreferredRub ? 0 : 1;
  return ap - bp || Number(b.year || 0) - Number(a.year || 0) || Number(b.images?.length || 0) - Number(a.images?.length || 0) || Number(a.totalRub || 0) - Number(b.totalRub || 0);
}
function reject(counter, key) { counter[key] = Number(counter[key] || 0) + 1; }

const candidates = [];
const rejections = {};
const errors = [];
let cursor = null;
let pages = 0;
let seen = 0;
let normalized = 0;
const ids = new Set();

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
    const exactImages = rawBoundImages(offer);
    if (!exactImages.length) { reject(rejections, "exact_images"); continue; }
    offer.images = exactImages;
    offer = await fillOnlyUnambiguousSpecs(offer);
    let calculated;
    try { calculated = normalizeVehicleOfferSpecs(await calculateOfferWithRussiaCustoms(offer)); }
    catch (error) { errors.push({ stage: "calculation", sourceOfferId: offer.sourceOfferId, error: String(error?.message || error) }); reject(rejections, "calculation_exception"); continue; }
    if (!exactCalculation(calculated)) { reject(rejections, "calculation_pending"); continue; }
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
const modelsByMake = new Map();
const countByModel = new Map();
for (const offer of candidates) {
  const make = makeKey(offer);
  const model = modelKey(offer);
  const known = modelsByMake.get(make) || new Set();
  if (!known.has(model) && known.size >= maxModelsPerMake) { reject(rejections, "model_quota"); continue; }
  if (Number(countByModel.get(model) || 0) >= maxOffersPerModel) { reject(rejections, "make_model_quota"); continue; }
  known.add(model);
  modelsByMake.set(make, known);
  countByModel.set(model, Number(countByModel.get(model) || 0) + 1);
  offers.push(offer);
  if (offers.length >= target) break;
}

const report = {
  version: 1,
  mode: "europe_otomoto_direct_exact_calculated_recovery",
  market: "europe",
  sourceId: source.sourceId,
  minYear,
  preferredMaxRub: maxPreferredRub,
  maxOffersPerModel,
  maxModelsPerMake,
  pages,
  seen,
  normalized,
  count: offers.length,
  preferredCount: offers.filter((offer) => Number(offer.totalRub || 0) <= maxPreferredRub).length,
  calculatedCount: offers.filter(exactCalculation).length,
  distinctModels: new Set(offers.map(modelKey)).size,
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
await fs.writeFile(output, JSON.stringify({ market: "europe", count: offers.length, report, offers }, null, 2));
console.log(JSON.stringify(report, null, 2));
if (!offers.length) process.exit(1);
