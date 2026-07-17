process.env.CATALOG_MAX_IMAGES_PER_OFFER ||= "10";
process.env.CATALOG_IMPORT_SOURCES = [
  "encar_direct",
  "jpauc_japan",
  "dubicars_clean",
  "dubicars_uae",
  "sbt_uae",
].join(",");

const { catalogImportSources } = await import("../apps/web/lib/catalog/importer.ts");
const { reliableMarketSources } = await import("../apps/web/lib/catalog/reliable-market-sources.ts");
const { alternateMarketSources } = await import("../apps/web/lib/catalog/alternate-market-sources.ts");
const { publicFallbackSources } = await import("../apps/web/lib/catalog/public-fallback-sources.ts");
const {
  cacheImageFromUrl,
  persistCatalogOffers,
  readAllOffersForMaintenance,
  stableOfferId,
} = await import("../apps/web/lib/catalog/storage.ts");

const BAD_SOURCE_IDS = new Set([
  "goonet_japan",
  "japantransit_japan",
  "sbt_japan",
  "beforward_japan",
  "che168_clean",
  "che168_global",
  "che168_html",
  "sbt_china",
  "autouncle_europe",
  "autoscout_europe",
  "sbt_uk",
]);

const NON_VEHICLE_RE = /\b(?:other\s+technics?|fork\s*lift|forklift|generator|excavator|bulldozer|loader|tractor|crane|compressor|construction\s+machine|agricultural\s+machine|motorcycle|motorbike|scooter|snowmobile|jet\s*ski|boat|ship|trailer\s+only|car\s+parts?|spare\s+parts?|engine\s+only|body\s+shell)\b/i;
const IMAGE_JUNK_RE = /(?:logo|favicon|icon|sprite|banner|placeholder|avatar|tracking|pixel|cookie|qrcode|qr-code|qr_|weixin|wechat|scan|download[-_]?app|appstore|googleplay|whatsapp|loading|spinner|no[-_ ]?photo|no[-_ ]?image)/i;
const JP_MAKES = new Set([
  "TOYOTA", "LEXUS", "NISSAN", "INFINITI", "HONDA", "ACURA", "MAZDA", "MITSUBISHI", "SUBARU", "SUZUKI", "DAIHATSU", "ISUZU",
  "HINO", "MITSUOKA", "BMW", "MERCEDES-BENZ", "MERCEDES BENZ", "AUDI", "VOLKSWAGEN", "PORSCHE", "VOLVO", "MINI", "JEEP",
  "LAND ROVER", "RANGE ROVER", "JAGUAR", "FORD", "CHEVROLET", "CADILLAC", "CHRYSLER", "DODGE", "TESLA", "PEUGEOT", "RENAULT",
  "CITROEN", "FIAT", "ALFA ROMEO", "MASERATI", "FERRARI", "LAMBORGHINI", "BENTLEY", "ROLLS-ROYCE", "ASTON MARTIN", "LOTUS",
  "HYUNDAI", "KIA", "GENESIS", "BYD",
]);

function text(value) {
  if (value == null) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

function numberValue(value) {
  const parsed = Number(text(value).replace(/[^0-9.]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function integerValue(value) {
  const parsed = Number(text(value).replace(/[^0-9]/g, ""));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function decodeHtml(value) {
  return text(value)
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function stripHtml(value) {
  return decodeHtml(String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " "));
}

function absoluteUrl(value, baseUrl) {
  const raw = decodeHtml(value).replace(/\\\//g, "/");
  if (!raw || /^(?:data:|javascript:|mailto:|tel:)/i.test(raw)) return "";
  try {
    return new URL(raw, baseUrl).toString();
  } catch {
    return "";
  }
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function isImageUrl(url) {
  return /^https?:/i.test(url)
    && /\.(?:jpe?g|png|webp|avif)(?:[?#]|$)/i.test(url)
    && !IMAGE_JUNK_RE.test(url);
}

function vehicleText(offer) {
  return [offer?.make, offer?.model, offer?.trim, offer?.bodyType, offer?.operational?.raw?.title]
    .map(text)
    .filter(Boolean)
    .join(" ");
}

function isNonVehicleOffer(offer) {
  const value = vehicleText(offer);
  if (!value || NON_VEHICLE_RE.test(value)) return true;
  const year = Number(offer?.year || 0);
  return year < 1990 || year > new Date().getFullYear() + 1;
}

function removeBadSources(list) {
  for (let index = list.length - 1; index >= 0; index--) {
    if (BAD_SOURCE_IDS.has(list[index]?.sourceId)) list.splice(index, 1);
  }
}

removeBadSources(reliableMarketSources);
removeBadSources(alternateMarketSources);
removeBadSources(publicFallbackSources);
removeBadSources(catalogImportSources);

const HEADERS = {
  accept: "text/html,application/xhtml+xml,application/json;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9,ja;q=0.8",
  "cache-control": "no-cache",
  pragma: "no-cache",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
};

async function requestHtml(url, referer = url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(process.env.CATALOG_SOURCE_TIMEOUT_MS || 30_000));
  try {
    const response = await fetch(url, {
      headers: { ...HEADERS, referer },
      redirect: "follow",
      signal: controller.signal,
    });
    return { response, html: await response.text() };
  } finally {
    clearTimeout(timer);
  }
}

function attributes(tag) {
  const result = {};
  for (const match of tag.matchAll(/([:\w-]+)\s*=\s*["']([^"']*)["']/g)) result[match[1].toLowerCase()] = match[2];
  return result;
}

function collectImageValues(value, result, depth = 0) {
  if (value == null || depth > 9) return;
  if (typeof value === "string") {
    if (/\.(?:jpe?g|png|webp|avif)(?:[?#]|$)/i.test(value)) result.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectImageValues(item, result, depth + 1);
    return;
  }
  if (typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (/image|photo|picture|gallery|media|thumb|src|url/i.test(key)) collectImageValues(child, result, depth + 1);
    else if (depth < 4) collectImageValues(child, result, depth + 1);
  }
}

function collectDubicarsGallery(html, offer) {
  const result = [];
  const baseUrl = text(offer?.operational?.sourceUrl) || "https://www.dubicars.com/";
  const listingId = text(offer?.sourceOfferId || baseUrl.match(/-(\d{5,})\.html/i)?.[1]);
  const make = text(offer?.make).toLowerCase();
  const model = text(offer?.model).toLowerCase();

  for (const match of html.matchAll(/<script[^>]*(?:type=["'](?:application\/ld\+json|application\/json)["']|id=["']__NEXT_DATA__["'])[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(match[1].trim());
      const visit = (value, depth = 0) => {
        if (value == null || depth > 11) return;
        if (Array.isArray(value)) return value.forEach((item) => visit(item, depth + 1));
        if (typeof value !== "object") return;
        const object = value;
        const identity = [object.id, object._id, object.listingId, object.vehicleId, object.url, object.name, object.title]
          .map(text)
          .join(" ")
          .toLowerCase();
        const exactId = listingId && identity.includes(listingId);
        const exactName = make && model && identity.includes(make) && identity.includes(model);
        if (exactId || exactName) collectImageValues(object, result);
        for (const child of Object.values(object)) visit(child, depth + 1);
      };
      visit(parsed);
    } catch {
      // Ignore one malformed embedded JSON block.
    }
  }

  for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
    const attr = attributes(match[0]);
    const alt = text(attr.alt).toLowerCase();
    if (!(make && model && alt.includes(make) && alt.includes(model))) continue;
    for (const key of ["data-original", "data-lazy-src", "data-src", "src"]) if (attr[key]) result.push(attr[key]);
    for (const key of ["data-srcset", "srcset"]) {
      for (const item of text(attr[key]).split(",")) result.push(item.trim().split(/\s+/)[0]);
    }
  }

  for (const match of html.matchAll(/<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)["'][^>]+content=["']([^"']+)["']/gi)) result.push(match[1]);

  return unique(result
    .map((item) => absoluteUrl(item, baseUrl))
    .filter((url) => isImageUrl(url) && /dubicars|dubizzle|cloudfront|amazonaws/i.test(url)));
}

function wrapDubicarsAdapter(adapter) {
  const originalNormalize = adapter.normalizeOffer.bind(adapter);
  adapter.normalizeOffer = (raw) => {
    const offer = originalNormalize(raw);
    return offer && !isNonVehicleOffer(offer) ? offer : null;
  };

  adapter.fetchImages = async (offer) => {
    const detailUrl = text(offer?.operational?.sourceUrl);
    if (!detailUrl) return [];
    const detail = await requestHtml(detailUrl, "https://www.dubicars.com/uae/used").catch(() => null);
    if (!detail?.response.ok) return [];
    const urls = collectDubicarsGallery(detail.html, offer).slice(0, Number(process.env.CATALOG_MAX_IMAGES_PER_OFFER || 10));
    const saved = [];
    for (const url of urls) {
      const image = await cacheImageFromUrl(url, "uae", { headers: { ...HEADERS, referer: detailUrl } }).catch(() => null);
      if (!image || image.width === 1 || image.height === 1 || Number(image.size || 0) < 8_000) continue;
      saved.push(image);
      if (saved.length >= Number(process.env.CATALOG_MAX_IMAGES_PER_OFFER || 10)) break;
    }
    return saved;
  };
}

for (const source of [...reliableMarketSources, ...publicFallbackSources, ...catalogImportSources]) {
  if (["dubicars_clean", "dubicars_uae"].includes(source?.sourceId)) wrapDubicarsAdapter(source);
}

function parseJpaucDetail(html, detailUrl) {
  const plain = stripHtml(html);
  const maker = text(plain.match(/Maker:\s*([A-Z0-9& .'-]+?)\s+Year:/i)?.[1]).toUpperCase();
  const model = text(plain.match(/Model:\s*(.*?)\s+Model Grade:/i)?.[1]);
  const grade = text(plain.match(/Model Grade:\s*(.*?)\s+Model Code:/i)?.[1]);
  const modelCode = text(plain.match(/Model Code:\s*(.*?)\s+KM:/i)?.[1]);
  const year = Number(plain.match(/Year:\s*((?:19|20)\d{2})/i)?.[1]);
  const lotNumber = text(plain.match(/Lot No\.:\s*([0-9]+)/i)?.[1]);
  const location = text(plain.match(/Location:\s*(.*?)\s+Maker:/i)?.[1]);
  const mileageKm = integerValue(plain.match(/KM:\s*([0-9,]+)\s*km/i)?.[1]);
  const engineCc = integerValue(plain.match(/CC:\s*([0-9,]+)\s*cc/i)?.[1]);
  const startPrice = integerValue(plain.match(/Start Price:\s*¥\s*([0-9,]+)/i)?.[1]);
  const transmission = text(plain.match(/Shift:\s*(.*?)\s+Color:/i)?.[1]);
  const color = text(plain.match(/Color:\s*(.*?)\s+Steering:/i)?.[1]);
  const auctionGrade = text(plain.match(/Auc\. Grade:\s*(.*?)\s+Status:/i)?.[1]);
  const statusText = text(plain.match(/Status:\s*(.*?)\s+Time:/i)?.[1]);
  const date = text(plain.match(/Date:\s*((?:19|20)\d{2}-\d{2}-\d{2})/i)?.[1]);

  if (!JP_MAKES.has(maker) || !model || !year || !lotNumber) return null;
  if (NON_VEHICLE_RE.test(`${maker} ${model} ${grade}`)) return null;
  if (year < 1990 || year > new Date().getFullYear() + 1) return null;
  if (engineCc != null && (engineCc < 300 || engineCc > 10_000)) return null;
  if (mileageKm != null && mileageKm > 800_000) return null;

  const imageCandidates = [];
  for (const match of html.matchAll(/<(?:img|source)\b[^>]*(?:data-original|data-lazy-src|data-src|src)\s*=\s*["']([^"']+)["']/gi)) imageCandidates.push(match[1]);
  for (const match of html.matchAll(/(?:data-srcset|srcset)\s*=\s*["']([^"']+)["']/gi)) {
    for (const item of match[1].split(",")) imageCandidates.push(item.trim().split(/\s+/)[0]);
  }
  for (const match of html.matchAll(/https?:\\?\/\\?\/[^"'\\\s<>]+?\.(?:jpe?g|png|webp)(?:\?[^"'\\\s<>]*)?/gi)) imageCandidates.push(match[0].replace(/\\\//g, "/"));

  const images = unique(imageCandidates
    .map((item) => absoluteUrl(item, detailUrl))
    .filter((url) => isImageUrl(url) && /(?:auction|vehicle|stock|photo|image|car|sheet|\d{6,})/i.test(url)));

  return {
    id: detailUrl.match(/\/auction\/detail\/(\d+)/i)?.[1] || `${date}-${location}-${lotNumber}`,
    lotNumber,
    maker,
    model,
    grade,
    modelCode,
    year,
    mileageKm,
    engineCc,
    startPrice: startPrice && startPrice >= 100_000 ? startPrice : undefined,
    transmission,
    color,
    auctionGrade,
    status: /sold|finished|closed/i.test(statusText) ? "sold" : "active",
    location,
    date,
    detailUrl,
    images,
  };
}

function jpaucLotNumbers(page) {
  const start = (Math.max(1, page) - 1) * 40 + 1;
  const sequential = Array.from({ length: 40 }, (_, index) => start + index);
  const rotating = [100, 500, 1000, 1500, 3000, 5000, 8000, 10000, 15000, 20000, 30000, 50000, 80000]
    .map((value) => value + page - 1);
  return unique([...sequential, ...rotating]).join(",");
}

const jpaucJapanSource = {
  sourceId: "jpauc_japan",
  market: "japan",
  accessMode: "public_html",

  async fetchPage(cursor) {
    const page = Math.max(1, Number(cursor || 1));
    const searchUrl = new URL("https://jpauc.com/auction/search");
    searchUrl.searchParams.set("lots", jpaucLotNumbers(page));
    searchUrl.searchParams.set("submit", "submitlot");
    const listing = await requestHtml(searchUrl.toString(), "https://jpauc.com/auction");
    if (!listing.response.ok) throw new Error(`jpauc_search_http_${listing.response.status}`);

    const detailUrls = unique([
      ...[...listing.html.matchAll(/href\s*=\s*["']([^"']*\/auction\/detail\/\d+[^"']*)["']/gi)].map((match) => absoluteUrl(match[1], searchUrl.toString())),
      ...[...listing.html.matchAll(/https?:\\?\/\\?\/[^"'\\\s<>]*\/auction\/detail\/\d+[^"'\\\s<>]*/gi)].map((match) => absoluteUrl(match[0], searchUrl.toString())),
    ]).slice(0, 24);

    if (!detailUrls.length) throw new Error(`jpauc_parsed_zero_status_${listing.response.status}_bytes_${listing.html.length}`);

    const rows = [];
    for (let index = 0; index < detailUrls.length; index += 4) {
      const batch = detailUrls.slice(index, index + 4);
      const details = await Promise.all(batch.map(async (url) => {
        const result = await requestHtml(url, searchUrl.toString()).catch(() => null);
        return result?.response.ok ? parseJpaucDetail(result.html, url) : null;
      }));
      rows.push(...details.filter(Boolean));
    }

    if (!rows.length) throw new Error("jpauc_details_parsed_zero");
    return {
      items: rows,
      nextCursor: String(page + 1),
      finished: false,
      count: rows.length,
      health: {
        ok: true,
        message: `JPAuc exact lots: parsed ${rows.length}`,
        checkedAt: new Date().toISOString(),
        httpStatus: listing.response.status,
        contentType: listing.response.headers.get("content-type") || "",
      },
    };
  },

  mapStatus(raw) {
    return raw?.status === "sold" ? "sold" : "active";
  },

  normalizeOffer(raw) {
    if (!raw?.id || !raw?.maker || !raw?.model || !raw?.year || !raw?.detailUrl) return null;
    const now = new Date().toISOString();
    const sourcePrice = raw.startPrice || null;
    return {
      id: stableOfferId(this.sourceId, raw.id),
      sourceId: this.sourceId,
      sourceOfferId: raw.id,
      market: "japan",
      offerType: "auction",
      status: this.mapStatus(raw),
      make: raw.maker,
      model: raw.model,
      trim: [raw.grade, raw.modelCode, raw.auctionGrade ? `grade ${raw.auctionGrade}` : ""].filter(Boolean).join(" "),
      year: raw.year,
      productionDate: raw.date,
      mileageKm: raw.mileageKm,
      engineCc: raw.engineCc,
      transmission: raw.transmission,
      color: raw.color,
      sourcePrice,
      sourceCurrency: sourcePrice ? "JPY" : null,
      priceMode: sourcePrice ? "auction_start" : "estimated",
      images: [],
      totalRub: null,
      calculationStatus: sourcePrice ? "auction_start" : "needs_data",
      firstSeenAt: now,
      updatedAt: now,
      operational: {
        sourceUrl: raw.detailUrl,
        sourceVenueName: [raw.location, raw.lotNumber ? `lot ${raw.lotNumber}` : ""].filter(Boolean).join(" · "),
        raw,
      },
    };
  },

  async fetchImages(offer) {
    const raw = offer?.operational?.raw || {};
    const limit = Math.max(1, Number(process.env.CATALOG_MAX_IMAGES_PER_OFFER || 10));
    const saved = [];
    for (const url of unique(raw.images || []).slice(0, limit)) {
      const image = await cacheImageFromUrl(url, "japan", { headers: { ...HEADERS, referer: raw.detailUrl } }).catch(() => null);
      if (!image || image.width === 1 || image.height === 1 || Number(image.size || 0) < 8_000) continue;
      saved.push(image);
    }
    return saved;
  },

  async healthCheck() {
    return { ok: true, message: "JPAuc health is recorded during exact-lot import", checkedAt: new Date().toISOString() };
  },
};

catalogImportSources.push(jpaucJapanSource);

const storedOffers = await readAllOffersForMaintenance().catch(() => []);
if (storedOffers.length) {
  const filtered = storedOffers.filter((offer) => {
    if (BAD_SOURCE_IDS.has(text(offer?.sourceId))) return false;
    if (isNonVehicleOffer(offer)) return false;
    if (["dubicars_clean", "dubicars_uae"].includes(text(offer?.sourceId)) && (offer?.images || []).length < 2) return false;
    return true;
  });
  if (filtered.length !== storedOffers.length) {
    await persistCatalogOffers(filtered);
    console.log(`[catalog] strict pre-import purge removed ${storedOffers.length - filtered.length} unreliable or non-vehicle offers`);
  }
}

await import("./catalog-import-sample.mjs");
