import fs from "node:fs/promises";

process.env.CATALOG_IMAGE_STORAGE_MODE = "source_urls_only";

const { normalizeVehicleOfferSpecs } = await import("../apps/web/lib/catalog/spec-normalization.ts");
const { enrichOfferWithCertifiedPower } = await import("../apps/web/lib/catalog/power-reference.ts");
const { calculateOfferWithPreliminaryPowerPricing, isPreliminaryPowerPendingCalculation } = await import("../apps/web/lib/catalog/customs-pricing.ts");
const { credibleCatalogImages, catalogMinYearForMarket } = await import("../apps/web/lib/catalog/offer-quality.ts");
const { findVehicleModel, readVehicleKnowledgeVariants } = await import("../apps/web/lib/catalog/vehicle-knowledge.ts");
const { dubicarsUaeCurrentSource } = await import("../apps/web/lib/catalog/dubicars-current-source.ts");
const { autoGeorgiaStrictSource } = await import("../apps/web/lib/catalog/auto-georgia-strict-source.ts");

const market = String(process.env.RECOVERY_DIRECT_MARKET || "").trim();
const target = Math.max(1, Math.min(3000, Number(process.env.RECOVERY_TARGET || 1000)));
const maxPages = Math.max(1, Math.min(300, Number(process.env.RECOVERY_MAX_PAGES || 120)));
const timeLimitMs = Math.max(60_000, Math.min(5_400_000, Number(process.env.RECOVERY_TIME_LIMIT_MS || 2_700_000)));
const maxPreferredRub = Math.max(500_000, Number(process.env.RECOVERY_PREFERRED_MAX_RUB || 8_000_000));
const minYear = catalogMinYearForMarket(market);
const output = process.env.RECOVERY_OUTPUT || `catalog-rebuild-${market}.json`;
const deadline = Date.now() + timeLimitMs;
const pageRetryAttempts = Math.max(1, Math.min(8, Number(process.env.RECOVERY_DIRECT_PAGE_RETRY_ATTEMPTS || 4)));
const pageRetryBaseMs = Math.max(1_000, Math.min(60_000, Number(process.env.RECOVERY_DIRECT_PAGE_RETRY_BASE_MS || 15_000)));
const pageCooldownMs = Math.max(0, Math.min(60_000, Number(process.env.RECOVERY_DIRECT_PAGE_COOLDOWN_MS || (market === "uae" ? 8_000 : 0))));
const pageRetryEvents = [];
let pageRetryCount = 0;

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function transientPageError(error) {
  const message = String(error?.message || error || "");
  return /(?:http_(?:403|408|409|425|429|5\d\d)|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|fetch failed|aborted|timeout)/i.test(message);
}
async function fetchPageWithRetry(currentCursor) {
  let lastError;
  for (let attempt = 1; attempt <= pageRetryAttempts; attempt++) {
    try { return await source.fetchPage(currentCursor); }
    catch (error) {
      lastError = error;
      const retryable = transientPageError(error);
      if (!retryable || attempt >= pageRetryAttempts || Date.now() >= deadline) throw error;
      const delayMs = Math.min(60_000, pageRetryBaseMs * attempt);
      pageRetryCount++;
      pageRetryEvents.push({ cursor: currentCursor, attempt, delayMs, error: String(error?.message || error) });
      await sleep(delayMs);
    }
  }
  throw lastError;
}

const source = market === "uae" ? dubicarsUaeCurrentSource : market === "georgia" ? autoGeorgiaStrictSource : null;
if (!source) throw new Error(`direct_recovery_market_unsupported:${market || "missing"}`);

const EXPECTED_HOST = market === "uae" ? "dubicars.com" : "auto.ge";
const COMMERCIAL_RE = /\b(?:truck|dump|tipper|bus|minibus|commercial|cargo|lorry|tractor|forklift|excavator|machinery|canter|fighter|dutro|forward|giga|elf|profia)\b/i;

function hostOk(value) {
  try {
    const host = new URL(String(value || "")).hostname.toLowerCase();
    return host === EXPECTED_HOST || host.endsWith(`.${EXPECTED_HOST}`);
  } catch { return false; }
}
function image(url) {
  const value = String(url || "").trim();
  const extension = value.match(/\.(jpe?g|webp|avif|png)(?:[?#]|$)/i)?.[1]?.toLowerCase();
  return {
    id: "", url: value, objectKey: "", checksum: "", size: 0,
    mimeType: extension === "png" ? "image/png" : extension === "webp" ? "image/webp" : extension === "avif" ? "image/avif" : "image/jpeg",
  };
}
function rawBoundImages(offer) {
  const op = offer?.operational || {};
  const raw = op.raw || {};
  const sourceUrl = String(op.sourceUrl || "");
  const rawUrls = Array.isArray(raw.images) ? raw.images.map(String).filter(Boolean) : [];
  if (!sourceUrl || !rawUrls.length || !hostOk(sourceUrl)) return [];
  if (market === "uae") {
    if (String(raw.url || "") !== sourceUrl || String(raw.id || "") !== String(offer.sourceOfferId || "")) return [];
  } else {
    if (String(raw.detailUrl || "") !== sourceUrl || raw.listingBoundImages !== true || raw.photoIdentityVerified !== true) return [];
  }
  return credibleCatalogImages(rawUrls.map(image)).slice(0, 30);
}
function token(value) { return String(value || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ""); }
function compatibleText(left, right) {
  const a = token(left), b = token(right);
  return !a || !b || a === b || a.includes(b) || b.includes(a);
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
  const engineValues = [...new Set(variants.map((v) => Number(v.engineCc || 0)).filter((v) => v > 0).map(Math.round))];
  const powerValues = [...new Set(variants.map((v) => Number(v.powerHp || 0)).filter((v) => v > 0).map((v) => Math.round(v * 10) / 10))];
  const canFillEngine = !Number(offer.engineCc || 0) && engineValues.length === 1;
  const canFillPower = !Number(offer.powerHp || 0) && powerValues.length === 1;
  if (!canFillEngine && !canFillPower) return offer;
  const chosen = variants.find((v) => (!canFillEngine || Math.round(Number(v.engineCc || 0)) === engineValues[0]) && (!canFillPower || Math.round(Number(v.powerHp || 0) * 10) / 10 === powerValues[0]));
  offer = normalizeVehicleOfferSpecs({
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
  return offer;
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
function quality(a, b) {
  const ap = Number(a.totalRub || 0) <= maxPreferredRub ? 0 : 1;
  const bp = Number(b.totalRub || 0) <= maxPreferredRub ? 0 : 1;
  return ap - bp || Number(b.year || 0) - Number(a.year || 0) || Number(b.images?.length || 0) - Number(a.images?.length || 0) || Number(a.totalRub || Number.MAX_SAFE_INTEGER) - Number(b.totalRub || Number.MAX_SAFE_INTEGER);
}
function reject(counter, key) { counter[key] = Number(counter[key] || 0) + 1; }

const accepted = new Map();
const rejections = {};
const errors = [];
let cursor = null;
let pages = 0;
let seen = 0;
let normalized = 0;

while (pages < maxPages && accepted.size < target && Date.now() < deadline) {
  let page;
  try { page = await fetchPageWithRetry(cursor); }
  catch (error) { errors.push({ stage: "page", cursor, error: String(error?.message || error) }); break; }
  pages++;
  const rows = Array.isArray(page?.items) ? page.items : [];
  seen += rows.length;
  for (const raw of rows) {
    if (accepted.size >= target || Date.now() >= deadline) break;
    let offer;
    try { offer = source.normalizeOffer(raw); } catch { reject(rejections, "normalize"); continue; }
    if (!offer) { reject(rejections, "normalize"); continue; }
    normalized++;
    offer = normalizeVehicleOfferSpecs(offer);
    const year = Number(offer.year || 0);
    if (year < minYear || year > new Date().getFullYear() + 1) { reject(rejections, "year"); continue; }
    if (!offer.make || !offer.model || !offer.sourceOfferId || !hostOk(offer.operational?.sourceUrl)) { reject(rejections, "identity"); continue; }
    if (!(Number(offer.sourcePrice) > 0) || !String(offer.sourceCurrency || "").trim()) { reject(rejections, "source_price"); continue; }
    if (COMMERCIAL_RE.test(`${offer.make} ${offer.model} ${offer.trim || ""} ${offer.bodyType || ""}`)) { reject(rejections, "commercial"); continue; }
    let exactImages = rawBoundImages(offer);
    if (market === "georgia") {
      try {
        const detailImages = credibleCatalogImages(await source.fetchImages(offer));
        if (detailImages.length > exactImages.length) exactImages = detailImages.slice(0, 30);
      } catch (error) {
        errors.push({ stage: "exact_gallery", sourceOfferId: offer.sourceOfferId, error: String(error?.message || error) });
      }
    }
    if (!exactImages.length) { reject(rejections, "exact_images"); continue; }
    offer.images = exactImages;
    offer = await fillOnlyUnambiguousSpecs(offer);
    if (["electric", "series_hybrid", "other_hybrid"].includes(String(offer.powertrainKind || ""))) {
      offer = normalizeVehicleOfferSpecs(await enrichOfferWithCertifiedPower(offer));
    }
    let calculated;
    try { calculated = normalizeVehicleOfferSpecs(await calculateOfferWithPreliminaryPowerPricing(offer)); }
    catch (error) { errors.push({ stage: "calculation", sourceOfferId: offer.sourceOfferId, error: String(error?.message || error) }); reject(rejections, "calculation_exception"); continue; }
    const preliminaryPowerPending = isPreliminaryPowerPendingCalculation(calculated);
    if (!exactCalculation(calculated) && !preliminaryPowerPending) { reject(rejections, "calculation_pending"); continue; }
    calculated.status = "active";
    calculated.operational = {
      ...(calculated.operational || {}),
      raw: {
        ...(calculated.operational?.raw || {}),
        recoveryExactSourceUrl: true,
        recoveryExactPhotoIdentity: true,
        recoveryCalculatedRub: true,
        recoveryPreliminaryPowerPending: preliminaryPowerPending,
        recoveryBodySourceOnly: true,
        recoveryDirectExactAdapter: true,
      },
    };
    accepted.set(calculated.id, calculated);
  }
  if (!page?.nextCursor || page?.finished) break;
  cursor = page.nextCursor;
  if (pageCooldownMs > 0 && Date.now() < deadline) await sleep(pageCooldownMs);
}

const offers = [...accepted.values()].sort(quality).slice(0, target);
const report = {
  version: 2,
  mode: "direct_exact_adapter_recovery",
  market,
  sourceId: source.sourceId,
  minYear,
  preferredMaxRub: maxPreferredRub,
  pages,
  seen,
  normalized,
  count: offers.length,
  electricCount: offers.filter((offer) => String(offer.powertrainKind || "") === "electric").length,
  hybridCount: offers.filter((offer) => ["series_hybrid", "other_hybrid"].includes(String(offer.powertrainKind || ""))).length,
  documentedPowerCount: offers.filter((offer) => String(offer.powerDataConfidence || "") === "documented").length,
  preferredCount: offers.filter((offer) => Number(offer.totalRub || 0) <= maxPreferredRub).length,
  calculatedCount: offers.filter(exactCalculation).length,
  preliminaryCount: offers.filter(isPreliminaryPowerPendingCalculation).length,
  imageStats: {
    min: offers.length ? Math.min(...offers.map((offer) => offer.images.length)) : 0,
    max: offers.length ? Math.max(...offers.map((offer) => offer.images.length)) : 0,
    average: offers.length ? Number((offers.reduce((sum, offer) => sum + offer.images.length, 0) / offers.length).toFixed(2)) : 0,
  },
  rejections,
  pageRetryAttempts,
  pageRetryCount,
  pageRetryEvents: pageRetryEvents.slice(0, 50),
  pageCooldownMs,
  errors: errors.slice(0, 100),
  passed: offers.length > 0,
};
await fs.writeFile(output, JSON.stringify({ market, count: offers.length, report, offers }, null, 2));
console.log(JSON.stringify(report, null, 2));
if (!offers.length) process.exit(1);
