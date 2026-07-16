process.env.CATALOG_ENCAR_DIRECT_PAGE_SIZE ||= "48";
process.env.CATALOG_CHE168_GLOBAL_PAGE_SIZE ||= "48";
process.env.CATALOG_CHE168_GLOBAL_MAX_BRANDS ||= "24";
process.env.CATALOG_MAX_IMAGES_PER_OFFER ||= "10";
process.env.CATALOG_TARGET_PUBLIC_OFFERS ||= "1250";
process.env.CATALOG_TARGET_PER_MARKET ||= "250";
process.env.CATALOG_OFFER_RETENTION_MS ||= String(3 * 24 * 60 * 60 * 1000);
process.env.CATALOG_STALE_GRACE_MS ||= String(3 * 24 * 60 * 60 * 1000);
process.env.CATALOG_IMPORT_BUDGET_MS ||= String(42 * 60 * 1000);
process.env.CATALOG_SOURCE_BUDGET_MS ||= String(8 * 60 * 1000);

const { alternateMarketSources, PRODUCTION_CATALOG_SOURCE_IDS } = await import("../apps/web/lib/catalog/alternate-market-sources.ts");
const { publicFallbackSources, PUBLIC_FALLBACK_SOURCE_IDS } = await import("../apps/web/lib/catalog/public-fallback-sources.ts");
const { reliableMarketSources, RELIABLE_MARKET_SOURCE_IDS } = await import("../apps/web/lib/catalog/reliable-market-sources.ts");
const { catalogImportSources, importCatalog } = await import("../apps/web/lib/catalog/importer.ts");
const { mutateSourcePolicy } = await import("../apps/web/lib/catalog/policy.ts");
const { refreshLiveExchangeRates } = await import("../apps/web/lib/catalog/live-rates.ts");
const { persistCatalogOffers, readAllOffersForMaintenance } = await import("../apps/web/lib/catalog/storage.ts");

for (const source of [...reliableMarketSources, ...alternateMarketSources, ...publicFallbackSources]) {
  if (!catalogImportSources.some((candidate) => candidate.sourceId === source.sourceId)) catalogImportSources.push(source);
}

const encarSample = { sourceIds: ["encar_direct"], maxOffers: 20, maxDetails: 20, maxImagesPerOffer: 3, maxPages: 1 };
const encarOnly = ["1", "true", "yes"].includes(String(process.env.CATALOG_IMPORT_ENCAR_ONLY || "").toLowerCase());
const configuredSources = String(process.env.CATALOG_IMPORT_SOURCES || "").split(",").map((value) => value.trim()).filter(Boolean);

// Give every market one reliable source before spending time on fallbacks for an already visited market.
const preferredProductionOrder = [
  "encar_direct",
  "goonet_japan",
  "che168_clean",
  "dubicars_clean",
  "autouncle_europe",
  "japantransit_japan",
  "sbt_japan",
  "che168_global",
  "che168_html",
  "sbt_china",
  "dubicars_uae",
  "sbt_uae",
  "autoscout_europe",
  "sbt_uk",
];
const knownProductionSources = new Set([...RELIABLE_MARKET_SOURCE_IDS, ...PRODUCTION_CATALOG_SOURCE_IDS, ...PUBLIC_FALLBACK_SOURCE_IDS]);
const allProductionSourceIds = [...knownProductionSources];
const defaultSources = [
  ...preferredProductionOrder.filter((sourceId) => knownProductionSources.has(sourceId)),
  ...allProductionSourceIds.filter((sourceId) => !preferredProductionOrder.includes(sourceId)),
];
const sources = encarOnly ? encarSample.sourceIds : configuredSources.length ? configuredSources : [...new Set(defaultSources)];

const japaneseLocationTail = /\b(?:Hokkaido|Aomori|Iwate|Miyagi|Akita|Yamagata|Fukushima|Ibaraki|Tochigi|Gunma|Saitama|Chiba|Tokyo|Kanagawa|Niigata|Toyama|Ishikawa|Fukui|Yamanashi|Nagano|Gifu|Shizuoka|Aichi|Mie|Shiga|Kyoto|Osaka|Hyogo|Nara|Wakayama|Tottori|Shimane|Okayama|Hiroshima|Yamaguchi|Tokushima|Kagawa|Ehime|Kochi|Fukuoka|Saga|Nagasaki|Kumamoto|Oita|Miyazaki|Kagoshima|Okinawa)\s+Japan\b[\s\S]*$/i;
const suspiciousImagePattern = /(?:no[-_ ]?photo|no[-_ ]?image|nophoto|noimage|image[-_ ]?not[-_ ]?available|photos?[-_ ]?(?:coming|soon)|coming[-_ ]?soon|default[-_ ]?(?:car|vehicle|image)|upload[-_ ]?image|placeholder|qrcode|qr-code|qr_|weixin|wechat|scan|download[-_ ]?app|appstore|googleplay|logo|sprite)/i;
const chineseReplacements = [
  [/雷克萨斯/g, "Lexus "], [/梅赛德斯[-·]?奔驰|奔驰/g, "Mercedes-Benz "], [/宝马/g, "BMW "], [/奥迪/g, "Audi "], [/大众/g, "Volkswagen "],
  [/丰田/g, "Toyota "], [/本田/g, "Honda "], [/日产/g, "Nissan "], [/马自达/g, "Mazda "], [/三菱/g, "Mitsubishi "], [/斯巴鲁/g, "Subaru "],
  [/现代/g, "Hyundai "], [/起亚/g, "Kia "], [/捷尼赛思/g, "Genesis "], [/沃尔沃/g, "Volvo "], [/保时捷/g, "Porsche "], [/福特/g, "Ford "],
  [/雪佛兰/g, "Chevrolet "], [/凯迪拉克/g, "Cadillac "], [/路虎/g, "Land Rover "], [/特斯拉/g, "Tesla "], [/比亚迪/g, "BYD "],
  [/吉利/g, "Geely "], [/长安/g, "Changan "], [/奇瑞/g, "Chery "], [/哈弗/g, "Haval "], [/广汽/g, "GAC "], [/理想/g, "Li Auto "],
  [/蔚来/g, "Nio "], [/小鹏/g, "XPeng "], [/极氪/g, "Zeekr "], [/捷途/g, "Jetour "], [/腾势/g, "Denza "], [/坦克/g, "Tank "],
];

function brokenCatalogText(value) {
  const text = String(value || "").trim();
  if (!text) return true;
  const replacementCharacters = (text.match(/[\uFFFD�□]/g) || []).length;
  const repeatedQuestions = (text.match(/\?{3,}/g) || []).length;
  const mojibakeRuns = (text.match(/(?:Ã.|Â.|Ð.|Ñ.){2,}/g) || []).length;
  return replacementCharacters > 0 || repeatedQuestions > 0 || mojibakeRuns > 0;
}

function cleanImportedText(value, market) {
  let text = String(value || "")
    .replace(/[\u0000-\u001f]+/g, " ")
    .replace(/\[object Object\]/gi, " ")
    .replace(/新上架|二手车|准新车|在售|报价|图片|详情/g, " ");
  if (market === "china") for (const [pattern, replacement] of chineseReplacements) text = text.replace(pattern, replacement);
  return text
    .replace(/([0-9]{4})款/g, "$1 ")
    .replace(/\b(?:Japan Car Price|Estimated Total Price|Total Price|Car Price)\b[\s\S]*$/i, "")
    .replace(/\(\s*FOB\s*\)/gi, " ")
    .replace(japaneseLocationTail, "")
    .replace(/[¥￥$€]\s*[0-9][0-9,\.\s]*/g, " ")
    .replace(/\b(?:19|20)\d{2}[./-]\d{1,2}(?:[./-]\d{1,2})?(?:\s+\d{1,2}[.:]\d{2})?[\s\S]*$/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 150)
    .trim();
}

function removeLeadingPhrase(value, phrase) {
  if (!value || !phrase) return value;
  const lowerValue = value.toLocaleLowerCase("en-US");
  const lowerPhrase = phrase.toLocaleLowerCase("en-US");
  if (lowerValue === lowerPhrase) return "";
  if (lowerValue.startsWith(`${lowerPhrase} `)) return value.slice(phrase.length).trim();
  return value;
}

function normalizeOfferText(offer) {
  const make = cleanImportedText(offer?.make, offer?.market);
  const model = cleanImportedText(offer?.model, offer?.market);
  let trim = cleanImportedText(offer?.trim, offer?.market);
  const base = [make, model].filter(Boolean).join(" ").trim();
  trim = removeLeadingPhrase(trim, base);
  trim = removeLeadingPhrase(trim, make);
  trim = removeLeadingPhrase(trim, model);
  return { ...offer, make, model, trim: trim || undefined };
}

function invalidLegacyOffer(offer) {
  const make = String(offer?.make || "").trim();
  const model = String(offer?.model || "").trim();
  const title = String(offer?.trim || "").trim();
  return !make || !model || brokenCatalogText(make) || brokenCatalogText(model) || (title && brokenCatalogText(title));
}

function imageKey(image) {
  return String(image?.checksum || image?.id || image?.objectKey || image?.url || "");
}

function sanitizeCatalogOffers(offers) {
  const normalized = offers.filter((offer) => !invalidLegacyOffer(offer)).map(normalizeOfferText);
  const usage = new Map();
  for (const offer of normalized) {
    if (offer.market === "korea") continue;
    for (const image of offer.images || []) {
      const key = `${offer.market}:${imageKey(image)}`;
      if (key.endsWith(":")) continue;
      usage.set(key, (usage.get(key) || 0) + 1);
    }
  }

  let removedOffers = offers.length - normalized.length;
  let removedImages = 0;
  let changedText = 0;
  const result = normalized.map((offer) => {
    const original = offers.find((candidate) => candidate.id === offer.id);
    if (original && (original.make !== offer.make || original.model !== offer.model || original.trim !== offer.trim)) changedText++;
    const rawImages = Array.isArray(offer?.operational?.raw?.images) ? offer.operational.raw.images.map(String) : [];
    const images = (offer.images || []).filter((image, index) => {
      const repeatedPlaceholder = offer.market !== "korea" && (usage.get(`${offer.market}:${imageKey(image)}`) || 0) >= 3;
      const suspiciousSourceUrl = suspiciousImagePattern.test(rawImages[index] || "");
      const suspiciousStoredUrl = suspiciousImagePattern.test(String(image?.url || image?.objectKey || ""));
      const keep = !repeatedPlaceholder && !suspiciousSourceUrl && !suspiciousStoredUrl;
      if (!keep) removedImages++;
      return keep;
    });
    return images.length === (offer.images || []).length ? offer : { ...offer, images };
  });
  return { offers: result, removedOffers, removedImages, changedText };
}

let purgedInvalidOffers = 0;
let placeholderImagesRemoved = 0;
let normalizedOfferTexts = 0;
if (!encarOnly) {
  const storedOffers = await readAllOffersForMaintenance();
  const sanitized = sanitizeCatalogOffers(storedOffers);
  purgedInvalidOffers += sanitized.removedOffers;
  placeholderImagesRemoved += sanitized.removedImages;
  normalizedOfferTexts += sanitized.changedText;
  if (sanitized.removedOffers || sanitized.removedImages || sanitized.changedText) {
    await persistCatalogOffers(sanitized.offers);
    console.log(`[catalog] pre-import cleanup: offers=${sanitized.removedOffers}, placeholderImages=${sanitized.removedImages}, normalizedTexts=${sanitized.changedText}`);
  }
}

if (["1", "true", "yes"].includes(String(process.env.CATALOG_IMPORT_RESET || "").toLowerCase())) {
  const { getJsonStorage } = await import("../apps/web/lib/data.ts");
  const storage = getJsonStorage();
  const sourcePaths = sources.flatMap((sourceId) => [`catalog/scans/${sourceId}.json`, `catalog/health/${sourceId}.json`, `catalog/sources/${sourceId}.json`]);
  for (const path of ["catalog/internal/manifest.json", "catalog/manifest.json", "catalog/import-lock.json", ...sourcePaths]) await storage.deleteJson?.(path);
}

await import("../apps/web/lib/catalog/encar-resilience.ts");

const requestedOffers = Number(process.env.CATALOG_IMPORT_MAX_OFFERS || 0);
const requestedDetails = Number(process.env.CATALOG_IMPORT_MAX_DETAILS || 0);
const requestedPages = Number(process.env.CATALOG_IMPORT_MAX_PAGES || 0);
const requestedImages = Number(process.env.CATALOG_MAX_IMAGES_PER_OFFER || 0);
const targetPublicOffers = Number(process.env.CATALOG_TARGET_PUBLIC_OFFERS || 1250);
const targetPerMarket = Number(process.env.CATALOG_TARGET_PER_MARKET || 250);
const maxOffers = encarOnly ? encarSample.maxOffers : Math.max(32, requestedOffers || 250);
const maxDetails = encarOnly ? encarSample.maxDetails : Math.max(maxOffers, requestedDetails || maxOffers);
const maxPages = encarOnly ? encarSample.maxPages : Math.max(4, requestedPages || 12);
const maxImagesPerOffer = encarOnly ? encarSample.maxImagesPerOffer : Math.max(10, requestedImages || 10);

for (const source of catalogImportSources.filter((candidate) => sources.includes(candidate.sourceId))) {
  await mutateSourcePolicy(source, (policy) => ({
    ...policy,
    enabled: true,
    blockedUntil: undefined,
    consecutiveFailures: 0,
    maxPagesPerRun: Math.max(Number(policy.maxPagesPerRun || 0), maxPages),
    maxOffersPerRun: Math.max(Number(policy.maxOffersPerRun || 0), maxOffers),
    maxDetailsPerRun: Math.max(Number(policy.maxDetailsPerRun || 0), maxDetails),
  }));
}

const startedAt = Date.now();
const exchangeRates = await refreshLiveExchangeRates().catch((error) => ({ updatedAt: new Date().toISOString(), rates: [], errors: [`refresh:${error?.message || "failed"}`] }));
console.log(`[catalog] exchange rates refreshed: ${exchangeRates.rates?.length || 0}; errors=${exchangeRates.errors?.length || 0}`);

const report = await importCatalog({
  sourceIds: sources,
  maxOffers,
  maxDetails,
  maxImagesPerOffer,
  maxPages,
  requireObjectStorage: true,
  failOnZeroSaved: true,
  reportPath: "catalog/imports/latest-public-markets.json",
});

let finalGenerationId = report.generationId;
let finalPublicOffers = Number(report.publicOffers || 0);
let finalPublicByMarket = report.publicByMarket || {};
if (!encarOnly) {
  const importedOffers = await readAllOffersForMaintenance();
  const sanitized = sanitizeCatalogOffers(importedOffers);
  purgedInvalidOffers += sanitized.removedOffers;
  placeholderImagesRemoved += sanitized.removedImages;
  normalizedOfferTexts += sanitized.changedText;
  if (sanitized.removedOffers || sanitized.removedImages || sanitized.changedText) {
    const manifest = await persistCatalogOffers(sanitized.offers);
    finalGenerationId = manifest.generationId;
    console.log(`[catalog] post-import cleanup: offers=${sanitized.removedOffers}, placeholderImages=${sanitized.removedImages}, normalizedTexts=${sanitized.changedText}`);
  }
  const publicOffers = sanitized.offers.filter((offer) => offer.status === "active" && Array.isArray(offer.images) && offer.images.length > 0);
  finalPublicOffers = publicOffers.length;
  finalPublicByMarket = publicOffers.reduce((totals, offer) => {
    totals[offer.market] = (totals[offer.market] || 0) + 1;
    return totals;
  }, {});
}

const marketIds = ["korea", "china", "japan", "uae", "europe"];
const refreshedByMarket = report.refreshedByMarket || {};
const missingByMarket = Object.fromEntries(marketIds.map((market) => [market, Math.max(0, targetPerMarket - Number(refreshedByMarket[market] || 0))]));
const targetReachedByMarket = marketIds.every((market) => Number(finalPublicByMarket[market] || 0) >= targetPerMarket);
const summary = {
  imported: report.imported,
  updated: report.updated,
  expired: report.expired,
  skipped: report.skipped,
  purgedInvalidOffers,
  placeholderImagesRemoved,
  normalizedOfferTexts,
  imageFailures: report.imageFailures,
  underfilledImages: report.underfilledImages,
  reusedImageSets: report.reusedImageSets,
  publicOffers: finalPublicOffers,
  publicByMarket: finalPublicByMarket,
  refreshedByMarket,
  targetPublicOffers,
  targetPerMarket,
  targetReached: marketIds.every((market) => Number(finalPublicByMarket[market] || 0) >= targetPerMarket),
  targetReachedByMarket,
  missingByMarket,
  generationId: finalGenerationId,
  sources: report.sources,
  exchangeRates: { updatedAt: exchangeRates.updatedAt, rates: exchangeRates.rates, errors: exchangeRates.errors },
  durationMs: Date.now() - startedAt,
  reportPath: "catalog/imports/latest-public-markets.json",
};

if (process.env.CATALOG_IMPORT_REPORT_FILE) {
  const fs = await import("node:fs/promises");
  await fs.writeFile(process.env.CATALOG_IMPORT_REPORT_FILE, JSON.stringify(summary, null, 2));
}
console.log(JSON.stringify(summary, null, 2));

if (!report.sources?.some((source) => source.ok)) {
  console.error("catalog_import_all_sources_failed");
  process.exitCode = 1;
}
