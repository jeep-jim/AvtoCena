import fs from "node:fs/promises";

const { catalogImportSources } = await import("../apps/web/lib/catalog/importer.ts");
const { calculateOfferWithRussiaCustoms } = await import("../apps/web/lib/catalog/customs-pricing.ts");
const { credibleCatalogImages, isCrediblePublicOffer } = await import("../apps/web/lib/catalog/offer-quality.ts");
const { normalizeVehicleOfferSpecs } = await import("../apps/web/lib/catalog/spec-normalization.ts");
const { readAllOffersForMaintenance } = await import("../apps/web/lib/catalog/storage.ts");

const market = String(process.env.CATALOG_REBUILD_MARKET || "").trim();
const target = Math.max(1, Number(process.env.CATALOG_REBUILD_TARGET || 250));
const minimumImages = Math.max(4, Number(process.env.CATALOG_REBUILD_MIN_IMAGES_PER_OFFER || 4));
const requestedImages = Number(process.env.CATALOG_MAX_IMAGES_PER_OFFER || 1000);
const maxImages = Math.min(1000, Math.max(minimumImages, Number.isFinite(requestedImages) ? requestedImages : 1000));
const maxPages = Math.max(1, Number(process.env.CATALOG_REBUILD_MAX_PAGES || 500));
const seedScanLimit = Math.max(target, Number(process.env.CATALOG_REBUILD_SEED_SCAN_LIMIT || 1500));
const outputFile = process.env.CATALOG_REBUILD_OUTPUT || `catalog-rebuild-${market}.json`;

const sourcePlan = {
  korea: ["encar_direct"],
  china: ["che168_china_exact", "guazi_china_export"],
  japan: ["goonet_japan_exact", "beforward_japan", "beforward_public"],
  uae: ["dubicars_uae_exact", "beforward_uae"],
  europe: ["otomoto_europe_exact", "beforward_uk", "beforward_belgium"],
};

if (!Object.prototype.hasOwnProperty.call(sourcePlan, market)) throw new Error(`unsupported_rebuild_market_${market || "missing"}`);
const configuredSources = String(process.env.CATALOG_REBUILD_SOURCE_IDS || "").split(",").map((value) => value.trim()).filter(Boolean);
const sourceIds = configuredSources.length ? configuredSources : sourcePlan[market];
const adapters = new Map(catalogImportSources.map((source) => [source.sourceId, source]));
process.env.CATALOG_MAX_IMAGES_PER_OFFER = String(maxImages);

function text(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizedToken(value) {
  return text(value).toLocaleLowerCase("en-US").replace(/[^\p{L}\p{N}]+/gu, "");
}

function collapseRepeatedPhrases(value) {
  const tokens = text(value).split(/\s+/).filter(Boolean);
  let changed = true;
  while (changed) {
    changed = false;
    const maxPhrase = Math.min(12, Math.floor(tokens.length / 2));
    outer: for (let length = maxPhrase; length >= 1; length--) {
      for (let start = 0; start + length * 2 <= tokens.length; start++) {
        const left = tokens.slice(start, start + length).map(normalizedToken).join(" ");
        const right = tokens.slice(start + length, start + length * 2).map(normalizedToken).join(" ");
        if (!left || left !== right) continue;
        tokens.splice(start + length, length);
        changed = true;
        break outer;
      }
    }
  }
  return tokens.join(" ").trim();
}

function removeLeading(value, phrase) {
  const source = text(value);
  const prefix = text(phrase);
  if (!source || !prefix) return source;
  const sourceLower = source.toLocaleLowerCase("en-US");
  const prefixLower = prefix.toLocaleLowerCase("en-US");
  if (sourceLower === prefixLower) return "";
  return sourceLower.startsWith(`${prefixLower} `) ? source.slice(prefix.length).trim() : source;
}

function cleanOffer(offer) {
  const make = collapseRepeatedPhrases(offer.make);
  const model = collapseRepeatedPhrases(removeLeading(offer.model, make));
  const base = [make, model].filter(Boolean).join(" ");
  let trim = collapseRepeatedPhrases(offer.trim);
  trim = removeLeading(removeLeading(removeLeading(trim, base), make), model);
  return normalizeVehicleOfferSpecs({ ...offer, make, model, trim: trim || undefined });
}

function imageKey(image) {
  return String(image?.checksum || image?.id || image?.objectKey || image?.url || "");
}

function uniqueImages(images) {
  const result = [];
  const seen = new Set();
  for (const image of credibleCatalogImages(Array.isArray(images) ? images : [])) {
    const key = imageKey(image);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(image);
    if (result.length >= maxImages) break;
  }
  return result;
}

function freshness(offer) {
  return Date.parse(String(offer?.operational?.sourcePublishedAt || offer?.updatedAt || offer?.firstSeenAt || "")) || 0;
}

const offers = new Map();
const report = {
  market,
  target,
  minimumImages,
  maxImages,
  sourceIds,
  startedAt: new Date().toISOString(),
  pages: 0,
  seen: 0,
  seedSeen: 0,
  seedSaved: 0,
  saved: 0,
  rejected: 0,
  imageFailures: 0,
  sourceErrors: [],
  sources: [],
};

function recordError(row) {
  if (report.sourceErrors.length < 500) report.sourceErrors.push(row);
}

async function prepareCandidate(input, source, origin) {
  if (!source?.fetchImages) return null;
  let offer = cleanOffer({ ...input });
  if (!offer || offer.market !== market || !offer.id) return null;

  let images = [];
  try {
    images = uniqueImages(await source.fetchImages(offer));
  } catch (error) {
    report.imageFailures++;
    recordError({ sourceId: offer.sourceId, offerId: offer.id, origin, stage: "exact_listing_gallery", error: String(error?.message || error) });
    return null;
  }
  if (images.length < minimumImages) {
    report.imageFailures++;
    return null;
  }

  offer = cleanOffer({
    ...offer,
    status: "active",
    images,
    operational: {
      ...offer.operational,
      fullRebuildAt: new Date().toISOString(),
      galleryVerified: true,
      galleryImageCount: images.length,
      gallerySourceImageCount: images.length,
      galleryRebuiltFrom: origin,
    },
  });

  try {
    offer = cleanOffer(await calculateOfferWithRussiaCustoms(offer));
  } catch (error) {
    recordError({ sourceId: offer.sourceId, offerId: offer.id, origin, stage: "calculation", error: String(error?.message || error) });
    if (!Number(offer.totalRub || 0)) return null;
  }
  return isCrediblePublicOffer(offer) ? offer : null;
}

const restored = (await readAllOffersForMaintenance())
  .filter((offer) => offer && offer.market === market && ["active", "stale"].includes(String(offer.status || "")))
  .sort((left, right) => freshness(right) - freshness(left) || Number(right.images?.length || 0) - Number(left.images?.length || 0))
  .slice(0, seedScanLimit);

for (const seed of restored) {
  if (offers.size >= target) break;
  report.seedSeen++;
  const source = adapters.get(seed.sourceId);
  const prepared = await prepareCandidate(seed, source, "restored_listing");
  if (!prepared || offers.has(prepared.id)) continue;
  offers.set(prepared.id, prepared);
  report.seedSaved++;
  report.saved = offers.size;
  if (offers.size % 10 === 0) console.log(`[seed:${market}] ${offers.size}/${target}; photos=${prepared.images.length}`);
}

for (const sourceId of sourceIds) {
  if (offers.size >= target) break;
  const source = adapters.get(sourceId);
  if (!source) {
    recordError({ sourceId, stage: "registry", error: `catalog_source_not_found_${sourceId}` });
    continue;
  }
  let cursor = null;
  let pages = 0;
  let errors = 0;
  const sourceStart = offers.size;

  while (offers.size < target && pages < maxPages) {
    let fetched;
    try {
      fetched = await source.fetchPage(cursor);
      errors = 0;
    } catch (error) {
      errors++;
      recordError({ sourceId, cursor, stage: "list", error: String(error?.message || error) });
      if (errors >= 10) break;
      const numeric = Number(cursor || 1);
      cursor = Number.isFinite(numeric) ? String(numeric + 1) : null;
      if (!cursor) break;
      continue;
    }

    pages++;
    report.pages++;
    const rows = Array.isArray(fetched?.items) ? fetched.items : [];
    for (const raw of rows) {
      if (offers.size >= target) break;
      report.seen++;
      let base = null;
      try { base = source.normalizeOffer(raw); } catch { base = null; }
      if (!base || base.market !== market || !base.id || offers.has(base.id)) continue;
      const prepared = await prepareCandidate(base, source, "fresh_listing");
      if (!prepared) {
        report.rejected++;
        continue;
      }
      offers.set(prepared.id, prepared);
      report.saved = offers.size;
      if (offers.size % 10 === 0) console.log(`[fresh:${market}] ${offers.size}/${target}; ${sourceId}; photos=${prepared.images.length}`);
    }

    cursor = fetched?.nextCursor || null;
    if ((fetched?.finished && !cursor) || !cursor) break;
  }
  report.sources.push({ sourceId, pages, saved: offers.size - sourceStart });
}

report.finishedAt = new Date().toISOString();
report.saved = offers.size;
report.publicBySource = [...offers.values()].reduce((totals, offer) => {
  totals[offer.sourceId] = (totals[offer.sourceId] || 0) + 1;
  return totals;
}, {});
report.imageStats = [...offers.values()].reduce((stats, offer) => {
  const count = Array.isArray(offer.images) ? offer.images.length : 0;
  stats.min = Math.min(stats.min, count);
  stats.max = Math.max(stats.max, count);
  stats.total += count;
  return stats;
}, { min: Number.POSITIVE_INFINITY, max: 0, total: 0 });
if (!Number.isFinite(report.imageStats.min)) report.imageStats.min = 0;
report.imageStats.average = offers.size ? Number((report.imageStats.total / offers.size).toFixed(2)) : 0;

await fs.writeFile(outputFile, JSON.stringify({
  version: 3,
  market,
  generatedAt: report.finishedAt,
  target,
  count: offers.size,
  sourceIds,
  report,
  offers: [...offers.values()].slice(0, target),
}, null, 2));
console.log(JSON.stringify(report, null, 2));
if (offers.size < target) throw new Error(`catalog_rebuild_under_target_${market}_${offers.size}_of_${target}`);
