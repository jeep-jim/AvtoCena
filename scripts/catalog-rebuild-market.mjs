import fs from "node:fs/promises";

const { catalogImportSources } = await import("../apps/web/lib/catalog/importer.ts");
const { buildEncarImageUrl, calculateOffer } = await import("../apps/web/lib/catalog/adapters.ts");
const { credibleCatalogImages, isCrediblePublicOffer } = await import("../apps/web/lib/catalog/offer-quality.ts");
const { normalizeVehicleOfferSpecs } = await import("../apps/web/lib/catalog/spec-normalization.ts");
const { cacheImageFromUrl, readAllOffersForMaintenance } = await import("../apps/web/lib/catalog/storage.ts");

const market = String(process.env.CATALOG_REBUILD_MARKET || "").trim();
const target = Math.max(1, Number(process.env.CATALOG_REBUILD_TARGET || 250));
const minimumImages = Math.max(4, Number(process.env.CATALOG_REBUILD_MIN_IMAGES_PER_OFFER || 4));
const maxImages = Math.min(120, Math.max(minimumImages, Number(process.env.CATALOG_MAX_IMAGES_PER_OFFER || 120)));
const maxPages = Math.max(1, Number(process.env.CATALOG_REBUILD_MAX_PAGES || 400));
const seedScanLimit = Math.max(target, Number(process.env.CATALOG_REBUILD_SEED_SCAN_LIMIT || 700));
const outputFile = process.env.CATALOG_REBUILD_OUTPUT || `catalog-rebuild-${market}.json`;
const timeoutMs = Math.max(10_000, Number(process.env.CATALOG_SOURCE_TIMEOUT_MS || 60_000));
const imageConcurrency = Math.max(1, Math.min(10, Number(process.env.CATALOG_IMAGE_FETCH_CONCURRENCY || 8)));

const sourcePlan = {
  korea: ["encar_direct"],
  china: ["che168_china_exact", "guazi_china_export"],
  japan: ["goonet_japan_exact", "beforward_japan", "beforward_public"],
  uae: ["dubicars_uae_exact"],
  europe: ["otomoto_europe_exact"],
};

if (!Object.prototype.hasOwnProperty.call(sourcePlan, market)) {
  throw new Error(`unsupported_rebuild_market_${market || "missing"}`);
}

const configuredSources = String(process.env.CATALOG_REBUILD_SOURCE_IDS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const sourceIds = configuredSources.length ? configuredSources : sourcePlan[market];
const adapters = new Map(catalogImportSources.map((source) => [source.sourceId, source]));
process.env.CATALOG_MAX_IMAGES_PER_OFFER = String(maxImages);

const badImage = /(?:logo|icon|avatar|qrcode|qr-code|placeholder|banner|tracking|pixel|seller|dealer|recommend|related|similar|favicon|badge|social|share|twitter|facebook|instagram|linkedin|youtube|tiktok|whatsapp|telegram|pinterest|threads|appstore|googleplay)/i;
const headers = {
  accept: "text/html,application/xhtml+xml,application/json,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9,ko;q=0.8,ja;q=0.8,pl;q=0.8,zh-CN;q=0.8",
  "cache-control": "no-cache",
  pragma: "no-cache",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150.0.0.0 Safari/537.36",
};

function text(value) {
  return String(value ?? "")
    .replace(/\\u002f/gi, "/")
    .replace(/\\u003a/gi, ":")
    .replace(/\\u0026/gi, "&")
    .replace(/\\\//g, "/")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function imageIdentity(image) {
  return String(image?.checksum || image?.id || image?.objectKey || image?.url || "");
}

function mergeImages(...sets) {
  const result = [];
  const seen = new Set();
  for (const image of sets.flat()) {
    const key = imageIdentity(image);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(image);
    if (result.length >= maxImages) break;
  }
  return credibleCatalogImages(result);
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
  return sourceLower === prefixLower
    ? ""
    : sourceLower.startsWith(`${prefixLower} `)
      ? source.slice(prefix.length).trim()
      : source;
}

function cleanOfferText(offer) {
  const make = collapseRepeatedPhrases(offer.make);
  const model = collapseRepeatedPhrases(removeLeading(offer.model, make));
  const base = [make, model].filter(Boolean).join(" ");
  let trim = collapseRepeatedPhrases(offer.trim);
  trim = removeLeading(trim, base);
  trim = removeLeading(trim, make);
  trim = removeLeading(trim, model);
  return { ...offer, make, model, trim: trim || undefined };
}

function absoluteUrl(value, base) {
  try {
    return new URL(text(value), base).toString();
  } catch {
    return "";
  }
}

function imageUrl(value, base) {
  const url = absoluteUrl(value, base);
  if (!url || badImage.test(url)) return "";
  return /\.(?:jpe?g|png|webp|avif)(?:[?#]|$)/i.test(url)
    || /olxcdn\.com|ci\.encar\.com|picture\d*\.goo-net\.com|\/image(?:[;/?#]|$)/i.test(url)
    ? url
    : "";
}

function galleryGroup(value) {
  try {
    const url = new URL(value);
    const path = decodeURIComponent(url.pathname)
      .replace(/\/(?:w|f)?_?\d+x\d+\//i, "/size/")
      .replace(/;s=\d+x\d+/i, "")
      .replace(/(?:\d{3})(\.(?:jpe?g|png|webp))$/i, "{seq}$1")
      .replace(/\/[^/]+$/, "/");
    return `${url.hostname.toLowerCase()}${path.toLowerCase()}`;
  } catch {
    return "";
  }
}

function uniqueUrls(values) {
  const result = [];
  const seen = new Set();
  for (const value of values) {
    const url = text(value);
    const key = url.replace(/[?#].*$/, "").toLowerCase();
    if (!url || seen.has(key) || badImage.test(url)) continue;
    seen.add(key);
    result.push(url);
    if (result.length >= maxImages) break;
  }
  return result;
}

async function requestText(url, referer = url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { ...headers, referer },
      redirect: "follow",
      signal: controller.signal,
    });
    return response.ok ? await response.text() : "";
  } finally {
    clearTimeout(timer);
  }
}

async function requestJson(url, referer = url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { ...headers, accept: "application/json,text/plain,*/*", referer },
      redirect: "follow",
      signal: controller.signal,
    });
    return response.ok ? await response.json() : null;
  } finally {
    clearTimeout(timer);
  }
}

function deepStrings(value, output = [], depth = 0) {
  if (value == null || depth > 14) return output;
  if (typeof value === "string") {
    const candidate = text(value);
    if (/^https?:|^\/\/|^\/?carpicture\//i.test(candidate)
      && /(?:image|photo|picture|carpicture|\.(?:jpe?g|png|webp)(?:[?#]|$))/i.test(candidate)) {
      output.push(candidate);
    }
    return output;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => deepStrings(item, output, depth + 1));
    return output;
  }
  if (typeof value === "object") {
    Object.values(value).forEach((item) => deepStrings(item, output, depth + 1));
  }
  return output;
}

function deepNumber(value, keys, depth = 0) {
  if (value == null || depth > 14 || typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const result = deepNumber(item, keys, depth + 1);
      if (result) return result;
    }
    return undefined;
  }
  for (const key of keys) {
    const number = Number(value[key]);
    if (Number.isFinite(number) && number > 0) return number;
  }
  for (const item of Object.values(value)) {
    const result = deepNumber(item, keys, depth + 1);
    if (result) return result;
  }
  return undefined;
}

function rawImageValues(offer) {
  const raw = offer?.operational?.raw;
  const result = [];
  for (const field of [raw?.images, raw?.photos, raw?.gallery, raw?.imageUrls, raw?.photoUrls]) {
    if (!Array.isArray(field)) continue;
    for (const item of field) {
      if (typeof item === "string") result.push(item);
      else if (item && typeof item === "object") {
        for (const key of ["url", "src", "path", "location", "large", "original"]) {
          if (typeof item[key] === "string") result.push(item[key]);
        }
      }
    }
  }
  return result;
}

function collectHtmlImages(markup, pageUrl) {
  const values = [];
  const decoded = text(markup);
  for (const match of decoded.matchAll(/<(?:img|source)[^>]+(?:data-src|data-original|data-lazy-src|data-image|data-large|data-full|src|content)\s*=\s*["']([^"']+)["']/gi)) {
    values.push(match[1]);
  }
  for (const match of decoded.matchAll(/(?:srcset|data-srcset)\s*=\s*["']([^"']+)["']/gi)) {
    for (const part of match[1].split(",")) values.push(part.trim().split(/\s+/)[0]);
  }
  for (const match of decoded.matchAll(/https?:\/\/[^"'<>\s\\]+(?:\.(?:jpe?g|png|webp|avif)|\/image(?:[;/?#]|$))[^"'<>\s\\]*/gi)) {
    values.push(match[0]);
  }
  return uniqueUrls(values.map((value) => imageUrl(value, pageUrl)).filter(Boolean));
}

async function discoverKoreaUrls(offer) {
  const detailUrl = `https://api.encar.com/v1/readside/vehicle/${offer.sourceOfferId}`;
  const detail = await requestJson(detailUrl, "https://fem.encar.com/").catch(() => null);
  if (!detail) return [];
  const values = deepStrings(detail).map((value) => value.startsWith("//") ? `https:${value}` : value);
  const raw = offer.operational?.raw || {};
  const cover = text(raw.Photo || raw.photo || raw.PhotoPath || raw.photoPath || values[0]);
  const count = Math.min(maxImages, Math.max(0,
    deepNumber(detail, ["photoCount", "PhotoCount", "imageCount", "ImageCount", "pictureCount", "PictureCount"]) || 0));
  if (cover) {
    for (let index = 1; index <= (count || maxImages); index++) {
      if (/^https?:\/\//i.test(cover) && /(\d{3})(\.(?:jpe?g|png|webp))$/i.test(cover)) {
        values.push(cover.replace(/(\d{3})(\.(?:jpe?g|png|webp))$/i, `${String(index).padStart(3, "0")}$2`));
      } else {
        values.push(buildEncarImageUrl(cover, index));
      }
    }
  }
  return uniqueUrls(values
    .map((value) => /^https?:\/\//i.test(value) ? value : buildEncarImageUrl(value, 1))
    .filter((value) => /ci\.encar\.com|\/carpicture\//i.test(value)));
}

async function discoverDetailUrls(offer) {
  if (market === "korea") return discoverKoreaUrls(offer);
  const sourceUrl = text(offer.operational?.sourceUrl);
  if (!sourceUrl) return [];
  const markup = await requestText(sourceUrl, sourceUrl).catch(() => "");
  if (!markup) return [];

  let values = collectHtmlImages(markup, sourceUrl);
  if (market === "uae") {
    values = values.filter((value) => /\/images\/[a-f0-9]{6}\/(?:w_?\d+x\d+|\d+x\d+|f_?\d+x\d+)\/[^/?#]+\/[a-f0-9-]+\.(?:jpe?g|webp)/i.test(value)
      && !\/(?:130x76|f_500x282)\//i.test(value));
  }

  const rawValues = rawImageValues(offer)
    .map((value) => imageUrl(value, sourceUrl))
    .filter(Boolean);
  const preferredGroup = galleryGroup(rawValues[0] || "");
  const groups = new Map();
  for (const value of [...rawValues, ...values]) {
    const group = galleryGroup(value);
    if (!group) continue;
    groups.set(group, [...(groups.get(group) || []), value]);
  }

  const preferred = preferredGroup ? groups.get(preferredGroup) || [] : [];
  const best = [...groups.values()].sort((left, right) => right.length - left.length)[0] || [];
  const selected = preferred.length >= minimumImages
    ? preferred
    : best.length >= minimumImages
      ? best
      : rawValues;
  return uniqueUrls(selected.filter(Boolean));
}

async function cacheUrls(urls, offer) {
  const result = [];
  const referer = text(offer.operational?.sourceUrl);
  for (let index = 0; index < urls.length && result.length < maxImages; index += imageConcurrency) {
    const batch = await Promise.all(urls.slice(index, index + imageConcurrency).map((url) =>
      cacheImageFromUrl(url, market, { headers: { ...headers, referer } }).catch(() => null)));
    for (const image of batch) {
      if (!image || image.size <= 8_000) continue;
      result.push(image);
      if (result.length >= maxImages) break;
    }
  }
  return credibleCatalogImages(result);
}

function advanceCursor(cursor) {
  const numeric = Number(cursor || 1);
  return Number.isFinite(numeric) ? String(numeric + 1) : null;
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
  skipped: 0,
  rejected: 0,
  imageFailures: 0,
  sourceErrors: [],
  sources: [],
};

function recordError(row) {
  if (report.sourceErrors.length < 600) report.sourceErrors.push(row);
}

async function prepareCandidate(input, source, origin) {
  let offer = cleanOfferText(normalizeVehicleOfferSpecs({ ...input }));
  if (!offer || offer.market !== market || !offer.id) return null;

  let nativeImages = [];
  if (source?.fetchImages) {
    try {
      nativeImages = credibleCatalogImages(await source.fetchImages(offer));
    } catch (error) {
      report.imageFailures++;
      recordError({ sourceId: offer.sourceId, offerId: offer.id, origin, stage: "source_gallery", error: String(error?.message || error) });
    }
  }

  let extraImages = [];
  try {
    const urls = await discoverDetailUrls(offer);
    extraImages = await cacheUrls(urls, offer);
  } catch (error) {
    recordError({ sourceId: offer.sourceId, offerId: offer.id, origin, stage: "detail_gallery", error: String(error?.message || error) });
  }

  // Only freshly fetched photos from this exact listing are allowed. Old galleries are
  // deliberately not merged because a previous broken pass could have mixed vehicles.
  const images = mergeImages(nativeImages, extraImages);
  if (images.length < minimumImages) {
    report.imageFailures++;
    return null;
  }

  const rebuiltAt = new Date().toISOString();
  offer = cleanOfferText(normalizeVehicleOfferSpecs({
    ...offer,
    status: "active",
    images,
    operational: {
      ...offer.operational,
      fullRebuildAt: rebuiltAt,
      galleryVerified: true,
      galleryImageCount: images.length,
      gallerySourceImageCount: Math.max(nativeImages.length, extraImages.length),
      galleryRebuiltFrom: origin,
    },
  }));

  try {
    offer = cleanOfferText(normalizeVehicleOfferSpecs(await calculateOffer(offer)));
  } catch (error) {
    recordError({ sourceId: offer.sourceId, offerId: offer.id, origin, stage: "calculation", error: String(error?.message || error) });
    if (!Number(offer.totalRub || 0)) return null;
  }

  if (!isCrediblePublicOffer(offer)) return null;
  return offer;
}

// First re-read the last working catalog restored by the previous workflow job. This
// immediately brings Japan back into the candidate pool, then every accepted card is
// re-fetched from its own source page so no three-photo or mixed-car gallery survives.
const restored = (await readAllOffersForMaintenance())
  .filter((offer) => offer && offer.market === market && ["active", "stale"].includes(String(offer.status || "")))
  .sort((left, right) => freshness(right) - freshness(left)
    || Number(right.images?.length || 0) - Number(left.images?.length || 0))
  .slice(0, seedScanLimit);

for (const seed of restored) {
  if (offers.size >= target) break;
  report.seedSeen++;
  const source = adapters.get(seed.sourceId);
  const prepared = await prepareCandidate(seed, source, "restored_catalog");
  if (!prepared || offers.has(prepared.id)) {
    report.skipped++;
    continue;
  }
  offers.set(prepared.id, prepared);
  report.seedSaved++;
  report.saved = offers.size;
  if (offers.size % 10 === 0) {
    console.log(`[seed:${market}] ${offers.size}/${target}; ${prepared.sourceId}; photos=${prepared.images.length}`);
  }
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
  let consecutiveErrors = 0;
  const sourceStart = offers.size;

  while (offers.size < target && pages < maxPages) {
    let fetched;
    try {
      fetched = await source.fetchPage(cursor);
      consecutiveErrors = 0;
    } catch (error) {
      consecutiveErrors++;
      recordError({ sourceId, cursor, stage: "list", error: String(error?.message || error) });
      const next = advanceCursor(cursor);
      if (!next || consecutiveErrors >= 12) break;
      cursor = next;
      continue;
    }

    pages++;
    report.pages++;
    const rows = Array.isArray(fetched?.items) ? fetched.items : [];
    if (!rows.length && fetched?.finished && !fetched?.nextCursor) break;

    for (const raw of rows) {
      if (offers.size >= target) break;
      report.seen++;
      let base;
      try {
        base = source.normalizeOffer(raw);
      } catch {
        base = null;
      }
      if (!base || base.market !== market || !base.id || offers.has(base.id)) {
        report.skipped++;
        continue;
      }

      const prepared = await prepareCandidate(base, source, "fresh_source");
      if (!prepared) {
        report.rejected++;
        continue;
      }
      offers.set(prepared.id, prepared);
      report.saved = offers.size;
      if (offers.size % 10 === 0) {
        console.log(`[fresh:${market}] ${offers.size}/${target}; ${sourceId}; photos=${prepared.images.length}`);
      }
    }

    cursor = fetched?.nextCursor || null;
    if (fetched?.finished && !cursor) break;
    if (!cursor) break;
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
  version: 2,
  market,
  generatedAt: report.finishedAt,
  target,
  count: offers.size,
  sourceIds,
  report,
  offers: [...offers.values()].slice(0, target),
}, null, 2));
console.log(JSON.stringify(report, null, 2));

if (offers.size < target) {
  throw new Error(`catalog_rebuild_under_target_${market}_${offers.size}_of_${target}`);
}
