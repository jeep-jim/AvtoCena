import fs from "node:fs/promises";

process.env.CATALOG_REBUILD_MIN_IMAGES_PER_OFFER ||= "1";
process.env.CATALOG_MAX_IMAGES_PER_OFFER ||= "30";
process.env.CATALOG_IMAGE_STORAGE_MODE ||= "source_urls_only";

const { catalogImportSources } = await import("../apps/web/lib/catalog/importer.ts");
const { calculateOfferWithPreliminaryPowerPricing, isPreliminaryPowerPendingCalculation } = await import("../apps/web/lib/catalog/customs-pricing.ts");
const { credibleCatalogImages, catalogMinYearForMarket } = await import("../apps/web/lib/catalog/offer-quality.ts");
const { normalizeVehicleOfferSpecs } = await import("../apps/web/lib/catalog/spec-normalization.ts");
const { CATALOG_MAX_OFFERS_PER_MODEL_YEAR, catalogModelYearQuotaKey, selectCatalogModelYearCoverageFirst } = await import("../apps/web/lib/catalog/inventory-quota.ts");
const { enrichOfferWithCertifiedPower } = await import("../apps/web/lib/catalog/power-reference.ts");
const { findVehicleModel, findVehicleVariant } = await import("../apps/web/lib/catalog/vehicle-knowledge.ts");
const { catalogPublicPriority, catalogRequiredSpecificationRejectionReason } = await import("../apps/web/lib/catalog/public-priority.ts");
const { SPECIFICATION_AUDIT_FIELDS, classifySpecificationEvidence } = await import("../apps/web/lib/catalog/specification-evidence-audit.ts");

const market = String(process.env.RECOVERY_MARKET || "").trim();
const requestedSourceIds = String(process.env.RECOVERY_SOURCE_IDS || "").split(",").map((value) => value.trim()).filter(Boolean);
const target = Math.max(1, Math.min(5_000, Number(process.env.RECOVERY_TARGET || 1_000)));
const maxPages = Math.max(1, Math.min(1_000, Number(process.env.RECOVERY_MAX_PAGES || 120)));
const timeLimitMs = Math.max(60_000, Math.min(5_400_000, Number(process.env.RECOVERY_TIME_LIMIT_MS || 2_700_000)));
const prepareConcurrency = Math.max(1, Math.min(12, Number(process.env.RECOVERY_PREPARE_CONCURRENCY || 6)));
const requestTimeoutMs = Math.max(8_000, Math.min(120_000, Number(process.env.RECOVERY_REQUEST_TIMEOUT_MS || 35_000)));
const retryAttempts = Math.max(1, Math.min(6, Number(process.env.RECOVERY_RETRY_ATTEMPTS || 4)));
const maxPreferredRub = Math.max(500_000, Number(process.env.RECOVERY_PREFERRED_MAX_RUB || 8_000_000));
const maxOffersPerModelYear = CATALOG_MAX_OFFERS_PER_MODEL_YEAR;
const minYear = catalogMinYearForMarket(market);
const output = process.env.RECOVERY_OUTPUT || `catalog-rebuild-${market}.json`;
const deadline = Date.now() + timeLimitMs;
const strictPublicReady = /^(?:1|true|yes)$/i.test(String(process.env.RECOVERY_STRICT_PUBLIC_READY || ""));

const EXPECTED_HOSTS = {
  encar_direct: ["encar.com"],
  kcar_korea_open: ["kcar.com"],
  kbchachacha_korea_open: ["kbchachacha.com"],
  autohome_used_china_open: ["che168.com"],
  guazi_china_open: ["guazi.com"],
  autohome_new_china_open: ["autohome.com.cn"],
  dongchedi_china_open: ["dongchedi.com"],
  dubizzle_uae_open: ["dubizzle.com"],
  dubicars_uae_exact: ["dubicars.com"],
  autoscout_europe_open: ["autoscout24.com", "autoscout24.de", "autoscout24.it", "autoscout24.fr", "autoscout24.nl"],
  mobile_de_open: ["mobile.de"],
  auto_georgia_open: ["auto.ge"],
  myauto_georgia_list: ["myauto.ge"],
  autopapa_georgia_open: ["autopapa.ge"],
};

const COMMERCIAL_RE = /\b(?:truck|dump|tipper|bus|minibus|commercial|cargo|lorry|tractor|forklift|excavator|machinery|canter|fighter|dutro|forward|giga|elf|profia)\b|(?:货车|卡车|客车|巴士|工程机械|商用车)/i;
const BODY_VALUES = new Set(["sedan", "saloon", "hatchback", "liftback", "fastback", "suv", "crossover", "offroad", "wagon", "estate", "coupe", "convertible", "cabriolet", "roadster", "pickup", "minivan", "mpv", "van"]);

if (!market) throw new Error("recovery_market_missing");
if (!requestedSourceIds.length) throw new Error("recovery_source_ids_missing");

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function errorText(error) {
  const parts = [];
  let current = error;
  for (let depth = 0; current && depth < 5; depth++) {
    parts.push(String(current?.code || ""), String(current?.message || current || ""));
    current = current?.cause;
  }
  return parts.filter(Boolean).join(" ");
}
function retryable(error) {
  return /UND_ERR_SOCKET|ECONNRESET|ECONNREFUSED|EPIPE|ETIMEDOUT|ENETUNREACH|EAI_AGAIN|fetch failed|socket|other side closed|timeout|HTTP[_ -]?(?:408|425|429|500|502|503|504)|\b(?:408|425|429|500|502|503|504)\b/i.test(errorText(error));
}
async function withTimeout(operation, label) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label}_timeout`)), requestTimeoutMs); }),
    ]);
  } finally { clearTimeout(timer); }
}
async function retry(label, operation) {
  let lastError;
  for (let attempt = 1; attempt <= retryAttempts; attempt++) {
    try { return await withTimeout(operation, label); }
    catch (error) {
      lastError = error;
      if (!retryable(error) || attempt >= retryAttempts) throw error;
      const delay = Math.min(12_000, 900 * (2 ** (attempt - 1)) + Math.floor(Math.random() * 400));
      console.warn(JSON.stringify({ event: "recovery_retry", market, label, attempt, delay, error: errorText(error).slice(0, 400) }));
      await sleep(delay);
    }
  }
  throw lastError;
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
function hostAllowed(sourceId, url) {
  const expected = EXPECTED_HOSTS[sourceId] || [];
  if (!expected.length) return false;
  try {
    const host = new URL(String(url || "")).hostname.toLowerCase();
    return expected.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
  } catch { return false; }
}
function photoBound(offer) {
  const op = offer?.operational || {};
  const raw = op?.raw || {};
  if (op.photoIdentityVerified === true || raw.photoIdentityVerified === true || raw.detailIdentityVerified === true || raw.listingBoundImages === true) return true;
  if (offer?.sourceId === "encar_direct" && op.galleryVerified === true && ["encar_source_urls_only", "encar_detail_only_v2"].includes(String(op.gallerySafetyMode || ""))) return true;
  return false;
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
  if (kind === "other_hybrid") return motor30 > 0 && Number(offer?.icePowerKw || 0) > 0;
  return motor30 > 0;
}
function saneBody(offer) {
  const body = String(offer?.bodyType || "").trim().toLowerCase();
  if (!body) return true;
  return BODY_VALUES.has(body);
}
function strictSpecificationRejectionReason(offer) {
  const body = String(offer?.bodyType || "").trim().toLowerCase();
  if (!body) return "strict_body_missing";
  if (!BODY_VALUES.has(body)) return "strict_body_noncanonical";
  for (const field of SPECIFICATION_AUDIT_FIELDS) {
    const result = classifySpecificationEvidence(offer, field);
    const accepted = result.state === "exact"
      || (result.state === "not_applicable" && ["engineCc", "certifiedPower"].includes(field));
    if (!accepted) return `strict_${field}_${result.state}_${result.reason}`;
  }
  const requiredSpecification = catalogRequiredSpecificationRejectionReason(offer);
  if (requiredSpecification) return `strict_${requiredSpecification}`;
  return "";
}
async function safeVariantEnrich(offer) {
  // Never infer body shape here. The source page remains authoritative for the
  // кузов. Knowledge may only fill missing calculation fields after a unique
  // make/model/year + source engine match.
  if (Number(offer?.powerHp || 0) > 0) return offer;
  const kind = String(offer?.powertrainKind || "");
  if (["electric", "series_hybrid", "other_hybrid"].includes(kind)) return offer;
  const engineCc = Number(offer?.engineCc || 0);
  if (!(engineCc > 0)) return offer;
  const match = await findVehicleModel(offer).catch(() => null);
  if (!match) return offer;
  const variant = await findVehicleVariant(match.model, offer).catch(() => null);
  if (!variant || !(Number(variant.powerHp) > 0) || !(Number(variant.engineCc) > 0)) return offer;
  const tolerance = Math.max(20, Number(variant.engineCcTolerance || 80));
  if (Math.abs(Number(variant.engineCc) - engineCc) > tolerance) return offer;
  return {
    ...offer,
    powerHp: offer.powerHp || variant.powerHp,
    powerKw: offer.powerKw || variant.powerKw || Math.round((Number(variant.powerHp) / 1.359621617) * 10) / 10,
    fuel: offer.fuel || variant.fuel,
    transmission: offer.transmission || variant.transmission,
    drive: offer.drive || variant.drive,
    generation: offer.generation || variant.generation,
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
function reject(counter, reason) { counter[reason] = Number(counter[reason] || 0) + 1; }
function qualityOrder(a, b) {
  const aPreferred = Number(a?.totalRub || 0) > 0 && Number(a.totalRub) <= maxPreferredRub ? 0 : 1;
  const bPreferred = Number(b?.totalRub || 0) > 0 && Number(b.totalRub) <= maxPreferredRub ? 0 : 1;
  return aPreferred - bPreferred
    || Number(b?.year || 0) - Number(a?.year || 0)
    || Number(b?.images?.length || 0) - Number(a?.images?.length || 0)
    || Number(a?.totalRub || Number.MAX_SAFE_INTEGER) - Number(b?.totalRub || Number.MAX_SAFE_INTEGER)
    || String(a?.id || "").localeCompare(String(b?.id || ""));
}

function listingBoundSourceImages(offer) {
  const raw = offer?.operational?.raw || {};
  if (raw.listingBoundImages !== true || raw.photoIdentityVerified !== true || !Array.isArray(raw.images)) return [];
  return raw.images.map((value) => {
    const url = String(value || "").trim();
    if (!/^https?:\/\//i.test(url)) return null;
    const extension = url.match(/\.(jpe?g|webp|avif|png)(?:[?#]|$)/i)?.[1]?.toLowerCase();
    if (!extension) return null;
    return {
      id: "",
      url,
      objectKey: "",
      checksum: "",
      size: 0,
      mimeType: extension === "png" ? "image/png" : extension === "webp" ? "image/webp" : extension === "avif" ? "image/avif" : "image/jpeg",
    };
  }).filter(Boolean);
}

const AUTO_GEORGIA_DETAIL_HEADERS = {
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9,ka;q=0.8,ru;q=0.7",
  "cache-control": "no-cache",
  pragma: "no-cache",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
};
function autoGeorgiaPlainText(value) {
  return String(value || "").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'").replace(/\s+/g, " ").trim();
}
function autoGeorgiaCompact(value) { return String(value || "").toLocaleLowerCase("en-US").replace(/[^\p{L}\p{N}]+/gu, ""); }
function autoGeorgiaInteger(value) {
  const parsed = Number(String(value || "").replace(/[^0-9]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
function autoGeorgiaIdentityMatches(markup, offer) {
  const text = autoGeorgiaCompact(autoGeorgiaPlainText(markup).slice(0, 30_000));
  const make = autoGeorgiaCompact(offer?.make);
  const tokens = String(offer?.model || "").split(/\s+/).map(autoGeorgiaCompact).filter((token) => token.length >= 2).slice(0, 3);
  return Boolean(make && text.includes(make) && tokens.some((token) => text.includes(token)));
}
async function enrichAutoGeorgiaExactSpecs(offer) {
  if (String(offer?.sourceId || "") !== "auto_georgia_open") return offer;
  const sourceUrl = String(offer?.operational?.sourceUrl || "").trim();
  if (!/^https?:\/\//i.test(sourceUrl)) return offer;
  const response = await fetch(sourceUrl, { headers: { ...AUTO_GEORGIA_DETAIL_HEADERS, referer: sourceUrl }, redirect: "follow" });
  const markup = await response.text();
  if (!response.ok) throw new Error(`auto_georgia_detail_http_${response.status}`);
  if (/captcha|cloudflare|access denied|request blocked|verify you are human|forbidden/i.test(markup.slice(0, 3_000))) throw new Error(`auto_georgia_detail_blocked_${response.status}`);
  if (!autoGeorgiaIdentityMatches(markup, offer)) throw new Error(`auto_georgia_detail_identity_mismatch:${offer?.sourceOfferId || ""}`);
  const sourceText = autoGeorgiaPlainText(markup);
  const cc = autoGeorgiaInteger(sourceText.match(/([0-9][0-9\s,.']{2,5})\s*(?:cc|cm3|cm³)/i)?.[1]);
  const liters = Number(sourceText.match(/\b([0-9]+(?:[.,][0-9]+)?)\s*(?:L|liter|litre)\b/i)?.[1]?.replace(",", ".") || 0);
  // AUTO.GE exact detail pages expose displacement as a labelled value such as
  // "Engine 1.5" rather than "1.5 L". Read only that exact source label;
  // never infer displacement from model names or unrelated numbers.
  const engineLabelLiters = Number(sourceText.match(/\bEngine\s+([0-9]+(?:[.,][0-9]+)?)\b/i)?.[1]?.replace(",", ".") || 0);
  const exactEngineCc = cc
    || (engineLabelLiters >= 0.3 && engineLabelLiters <= 15 ? Math.round(engineLabelLiters * 1_000) : undefined)
    || (liters >= 0.3 && liters <= 15 ? Math.round(liters * 1_000) : undefined);
  const hp = autoGeorgiaInteger(sourceText.match(/\b([0-9]{2,4})\s*(?:HP|PS|horsepower)\b/i)?.[1]);
  const exactFuel = sourceText.match(/\bFuel\s+(Hybrid Engine|ELECTRIC|Electric|Gasoline|Petrol|Diesel|COMPRESSED NATURAL GAS|CNG|LPG|Gas|Other)\b/i)?.[1];
  const exactTransmission = sourceText.match(/\bTransmission\s+(Automatic|Manual|Automanual|CVT|Variator|Robot)\b/i)?.[1];
  const exactDrive = sourceText.match(/\bDrive Train\s+(Front-wheel Drive|Rear-wheel Drive|All-wheel Drive|4WD|AWD|2WD)\b/i)?.[1];
  if (!(Number(offer.engineCc || 0) > 0) && exactEngineCc) offer.engineCc = exactEngineCc;
  if (exactFuel) offer.fuel = exactFuel;
  if (!offer.transmission && exactTransmission) offer.transmission = exactTransmission;
  if (!offer.drive && exactDrive) offer.drive = exactDrive;
  if (!(Number(offer.powerHp || 0) > 0) && hp) {
    offer.powerHp = hp;
    offer.powerKw ||= Math.round((hp / 1.359621617) * 10) / 10;
  }
  offer.operational = {
    ...(offer.operational || {}),
    raw: {
      ...(offer.operational?.raw || {}),
      detailIdentityVerified: true,
      recoveryExactSpecSource: sourceUrl,
      recoveryExactSourceEngineCc: Number(offer.engineCc || 0) || null,
      recoveryExactSourcePowerHp: Number(offer.powerHp || 0) || null,
    },
  };
  return offer;
}
function thirtyMinutePower(offer) {
  const single = Number(offer?.power30MinKw || 0);
  if (single > 0) return single;
  return Array.isArray(offer?.power30MinKwByMotor)
    ? offer.power30MinKwByMotor.reduce((sum, value) => sum + Math.max(0, Number(value || 0)), 0)
    : 0;
}
function calculationPendingDiagnostic(offer) {
  const kind = String(offer?.powertrainKind || "unknown");
  const utilization = Number(offer?.utilizationPowerKw || 0);
  const motor30 = thirtyMinutePower(offer);
  const ice = Number(offer?.icePowerKw || 0);
  const engineCc = Number(offer?.engineCc || 0);
  const powerHp = Number(offer?.powerHp || 0);
  const electrified = ["electric", "series_hybrid", "other_hybrid"].includes(kind);
  let reason = "exact_calculation_incomplete";
  if (electrified && utilization <= 0 && motor30 <= 0) reason = "missing_certified_utilization_or_30min_power";
  else if (kind === "other_hybrid" && utilization <= 0 && ice <= 0) reason = "missing_ice_power_kw";
  else if (!electrified && engineCc <= 0) reason = "missing_engine_cc";
  else if (!electrified && powerHp <= 0) reason = "missing_power_hp";
  else if (String(offer?.calculationSnapshot?.customs?.status || "") !== "ready") reason = `customs_${String(offer?.calculationSnapshot?.customs?.status || "missing")}`;
  return {
    make: String(offer?.make || ""), model: String(offer?.model || ""), trim: String(offer?.trim || ""), year: Number(offer?.year || 0),
    powertrainKind: kind, sourceId: String(offer?.sourceId || ""), sourceOfferId: String(offer?.sourceOfferId || ""),
    sourceUrl: String(offer?.operational?.sourceUrl || ""), reason, engineCc: engineCc || null, powerHp: powerHp || null,
    utilizationPowerKw: utilization || null, power30MinKw: motor30 || null, icePowerKw: ice || null,
  };
}

const adapterMap = new Map(catalogImportSources.map((source) => [source.sourceId, source]));
const sources = requestedSourceIds.map((id) => adapterMap.get(id)).filter(Boolean).filter((source) => source.market === market || source.market === "multi");
if (!sources.length) throw new Error(`recovery_sources_not_registered:${requestedSourceIds.join(",")}`);

const globalOffers = new Map();
const reports = [];
const pendingElectrifiedModels = new Map();
const pendingCombustionModels = new Map();

await Promise.all(sources.map(async (source) => {
  const accepted = new Map();
  const acceptedModelYearCounts = new Map();
  const rejections = {};
  const errors = [];
  const cursors = new Set();
  let cursor = null;
  let pages = 0;
  let seen = 0;
  let normalized = 0;
  let finished = false;
  let stopReason = "source_exhausted";

  while (pages < maxPages && Date.now() < deadline) {
    const cursorKey = String(cursor ?? "__start__");
    if (cursors.has(cursorKey)) { stopReason = "cursor_loop"; break; }
    cursors.add(cursorKey);
    let page;
    try { page = await retry(`${source.sourceId}_page`, () => source.fetchPage(cursor)); }
    catch (error) {
      const pageError = errorText(error);
      if (source.sourceId === "auto_georgia_open" && pages > 0 && /auto_georgia_strict_parsed_zero_200_\d+/i.test(pageError)) {
        finished = true;
        stopReason = "source_exhausted";
        break;
      }
      errors.push({ stage: "page", cursor, error: pageError.slice(0, 800) });
      stopReason = "source_error";
      break;
    }
    pages++;
    const rows = Array.isArray(page?.items) ? page.items : [];
    seen += rows.length;
    const prepared = await pool(rows, prepareConcurrency, async (raw) => {
      if (Date.now() >= deadline) return null;
      let offer;
      try { offer = source.normalizeOffer(raw); } catch { reject(rejections, "normalize"); return null; }
      if (!offer) { reject(rejections, "normalize"); return null; }
      normalized++;
      offer = normalizeVehicleOfferSpecs(offer);
      const year = Number(offer.year || 0);
      if (year < minYear || year > new Date().getFullYear() + 1) { reject(rejections, "year"); return null; }
      const detailBoundIdentity = source.sourceId === "autohome_new_china_open" && (!offer.make || !offer.model);
      if (!offer.sourceOfferId || ((!offer.make || !offer.model) && !detailBoundIdentity)) { reject(rejections, "identity"); return null; }
      // Coverage scanning continues after the output target. Once a model-year
      // already has 20 successfully prepared rows from earlier pages, skip its
      // expensive detail/gallery work. This is not a speculative reservation:
      // failed rows never occupy quota.
      if (!detailBoundIdentity) {
        const quotaKey = catalogModelYearQuotaKey(offer, market);
        if (quotaKey && Number(acceptedModelYearCounts.get(quotaKey) || 0) >= maxOffersPerModelYear) {
          reject(rejections, "model_year_quota");
          return null;
        }
      }
      if (!hostAllowed(source.sourceId, offer.operational?.sourceUrl)) { reject(rejections, "source_url"); return null; }
      if (!(Number(offer.sourcePrice) > 0) || !String(offer.sourceCurrency || "").trim()) { reject(rejections, "source_price"); return null; }
      if (!detailBoundIdentity && COMMERCIAL_RE.test(`${offer.make} ${offer.model} ${offer.trim || ""} ${offer.bodyType || ""}`)) { reject(rejections, "commercial"); return null; }
      if (!detailBoundIdentity && !saneBody(offer)) { reject(rejections, "body"); return null; }

      const trustedListingImages = source.sourceId === "auto_georgia_open" && process.env.CATALOG_IMAGE_STORAGE_MODE === "source_urls_only"
        ? listingBoundSourceImages(offer)
        : [];
      if (trustedListingImages.length) {
        offer.images = credibleCatalogImages(trustedListingImages).slice(0, 30);
        offer.operational = {
          ...(offer.operational || {}),
          galleryVerified: offer.images.length > 0,
          galleryImageCount: offer.images.length,
          gallerySafetyMode: "auto_georgia_listing_bound_source_urls",
          galleryStoredAs: "json_urls",
        };
      } else {
        try {
          const fetched = typeof source.fetchImages === "function" ? await retry(`${source.sourceId}_images`, () => source.fetchImages(offer)) : [];
          const combined = credibleCatalogImages([...(offer.images || []), ...(Array.isArray(fetched) ? fetched : [])]);
          offer.images = combined.slice(0, 30);
        } catch (error) {
          errors.push({ stage: "images", sourceOfferId: offer.sourceOfferId, error: errorText(error).slice(0, 500) });
          offer.images = credibleCatalogImages(offer.images || []).slice(0, 30);
        }
      }
      if (!offer.images.length) { reject(rejections, "images"); return null; }
      if (["autohome_new_china_open", "mobile_de_open"].includes(source.sourceId) && offer.images.length < 5) {
        reject(rejections, "exact_gallery_below_5");
        return null;
      }
      if (!photoBound(offer)) { reject(rejections, "photo_identity"); return null; }

      if (detailBoundIdentity) {
        offer = normalizeVehicleOfferSpecs(offer);
        if (!offer.make || !offer.model || !offer.sourceOfferId) { reject(rejections, "identity"); return null; }
        if (COMMERCIAL_RE.test(`${offer.make} ${offer.model} ${offer.trim || ""} ${offer.bodyType || ""}`)) { reject(rejections, "commercial"); return null; }
        if (!saneBody(offer)) { reject(rejections, "body"); return null; }
      }

      if (source.sourceId === "auto_georgia_open" && (!(Number(offer.engineCc || 0) > 0) || !(Number(offer.powerHp || 0) > 0))) {
        try { offer = normalizeVehicleOfferSpecs(await retry(`${source.sourceId}_detail_specs`, () => enrichAutoGeorgiaExactSpecs(offer))); }
        catch (error) { errors.push({ stage: "detail_specs", sourceOfferId: offer.sourceOfferId, error: errorText(error).slice(0, 500) }); }
      }
      offer = normalizeVehicleOfferSpecs(await safeVariantEnrich(offer));
      if (["electric", "series_hybrid", "other_hybrid"].includes(String(offer.powertrainKind || ""))) {
        offer = normalizeVehicleOfferSpecs(await enrichOfferWithCertifiedPower(offer));
      }
      let calculated;
      try { calculated = normalizeVehicleOfferSpecs(await calculateOfferWithPreliminaryPowerPricing(offer)); }
      catch (error) { errors.push({ stage: "calculation", sourceOfferId: offer.sourceOfferId, error: errorText(error).slice(0, 500) }); reject(rejections, "calculation_exception"); return null; }
      const calculatedExactly = exactCalculation(calculated);
      const preliminaryCalculation = isPreliminaryPowerPendingCalculation(calculated);
      if (!calculatedExactly) {
        const diagnostic = calculationPendingDiagnostic(calculated);
        const diagnosticKey = `${diagnostic.make}|${diagnostic.model}|${diagnostic.trim}|${diagnostic.year}|${diagnostic.powertrainKind}|${diagnostic.reason}`.toLocaleLowerCase("en-US");
        const targetDiagnostics = ["electric", "series_hybrid", "other_hybrid"].includes(diagnostic.powertrainKind) ? pendingElectrifiedModels : pendingCombustionModels;
        if (targetDiagnostics.size < 500 && !targetDiagnostics.has(diagnosticKey)) targetDiagnostics.set(diagnosticKey, diagnostic);
        if (!preliminaryCalculation || strictPublicReady) {
          reject(rejections, preliminaryCalculation ? "strict_preliminary_calculation" : "calculation_pending");
          return null;
        }
      }
      if (strictPublicReady) {
        const specificationRejection = strictSpecificationRejectionReason(calculated);
        if (specificationRejection) { reject(rejections, specificationRejection); return null; }
        const publicPriority = catalogPublicPriority(calculated);
        if (!publicPriority.eligible) { reject(rejections, `strict_public_${publicPriority.reason}`); return null; }
      }
      calculated.status = "active";
      calculated.operational = {
        ...(calculated.operational || {}),
        raw: {
          ...(calculated.operational?.raw || {}),
          recoveryExactSourceUrl: true,
          recoveryExactPhotoIdentity: true,
          recoveryCalculatedRub: true,
          recoveryPreliminaryPowerPending: preliminaryCalculation,
          recoveryBodySourceOnly: true,
          recoveryStrictPublicReady: strictPublicReady,
        },
      };
      return calculated;
    });

    for (const offer of prepared.filter(Boolean)) {
      if (accepted.has(offer.id)) {
        if (!globalOffers.has(offer.id)) globalOffers.set(offer.id, offer);
        continue;
      }
      const key = catalogModelYearQuotaKey(offer, market);
      const acceptedForModelYear = key ? Number(acceptedModelYearCounts.get(key) || 0) : 0;
      if (key && acceptedForModelYear >= maxOffersPerModelYear) {
        reject(rejections, "model_year_quota");
        continue;
      }
      accepted.set(offer.id, offer);
      if (key) acceptedModelYearCounts.set(key, acceptedForModelYear + 1);
      if (!globalOffers.has(offer.id)) globalOffers.set(offer.id, offer);
    }
    if (!page?.nextCursor || page?.finished) { finished = true; stopReason = "source_exhausted"; break; }
    cursor = page.nextCursor;
    if (!rows.length && pages >= 3) { stopReason = "empty_pages"; break; }
  }
  if (Date.now() >= deadline) stopReason = "time_limit";
  else if (!finished && pages >= maxPages && stopReason === "source_exhausted") stopReason = "page_limit";
  reports.push({ sourceId: source.sourceId, pages, seen, normalized, accepted: accepted.size, rejected: Object.values(rejections).reduce((a, b) => a + b, 0), rejections, errors: errors.slice(0, 100), finished, stopReason });
}));

const discoveredOffers = [...globalOffers.values()];
const offers = selectCatalogModelYearCoverageFirst(discoveredOffers, target, qualityOrder);
const preferredCount = offers.filter((offer) => Number(offer.totalRub || 0) <= maxPreferredRub).length;
const report = {
  version: 3,
  mode: strictPublicReady ? "live_market_strict_public_ready_dry_run" : "live_market_exact_calculated_recovery",
  writes: false,
  strictPublicReady,
  market,
  sourceIds: sources.map((source) => source.sourceId),
  target,
  discoveredCount: discoveredOffers.length,
  discoveredModelYears: new Set(discoveredOffers.map((offer) => catalogModelYearQuotaKey(offer, market)).filter(Boolean)).size,
  minYear,
  preferredMaxRub: maxPreferredRub,
  count: offers.length,
  electricCount: offers.filter((offer) => String(offer.powertrainKind || "") === "electric").length,
  hybridCount: offers.filter((offer) => ["series_hybrid", "other_hybrid"].includes(String(offer.powertrainKind || ""))).length,
  documentedPowerCount: offers.filter((offer) => String(offer.powerDataConfidence || "") === "documented").length,
  calculationPendingElectrifiedModels: [...pendingElectrifiedModels.values()].slice(0, 250),
  calculationPendingCombustionModels: [...pendingCombustionModels.values()].slice(0, 100),
  preferredCount,
  calculatedCount: offers.filter(exactCalculation).length,
  preliminaryCount: offers.filter(isPreliminaryPowerPendingCalculation).length,
  imageStats: offers.length ? {
    min: Math.min(...offers.map((offer) => offer.images?.length || 0)),
    max: Math.max(...offers.map((offer) => offer.images?.length || 0)),
    average: Number((offers.reduce((sum, offer) => sum + Number(offer.images?.length || 0), 0) / offers.length).toFixed(2)),
  } : { min: 0, max: 0, average: 0 },
  sources: reports.sort((a, b) => a.sourceId.localeCompare(b.sourceId)),
  passed: offers.length > 0,
};
await fs.writeFile(output, JSON.stringify({ market, count: offers.length, partial: offers.length < target, report, offers }, null, 2));
console.log(JSON.stringify(report, null, 2));
if (!offers.length) process.exit(1);
