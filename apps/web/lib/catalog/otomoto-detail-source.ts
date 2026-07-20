import { cacheImageFromUrl } from "./storage";
import {
  OTOMOTO_HEADERS,
  OtomotoCurrentAdapter,
  cleanOtomoto,
  decodeOtomoto,
  extractOtomotoImages,
  normalizeOtomotoBody,
  normalizeOtomotoDrive,
  normalizeOtomotoFuel,
  normalizeOtomotoTransmission,
  otomotoInteger,
  parseOtomotoMileage,
  parseOtomotoPrice,
  type OtomotoRow,
} from "./otomoto-current-source";
import type { CatalogFetchResult, CatalogImage, VehicleOffer } from "./types";

function plausibleYear(value: unknown) {
  const match = String(value || "").match(/\b((?:19|20)\d{2})\b/);
  const year = Number(match?.[1] || 0);
  return Number.isInteger(year) && year >= 1950 && year <= new Date().getFullYear() + 1 ? year : undefined;
}

function scalar(value: unknown): unknown {
  if (value == null) return undefined;
  if (typeof value === "string" || typeof value === "number") return value;
  if (Array.isArray(value)) return value.map(scalar).find((item) => item !== undefined);
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    for (const key of ["value", "name", "label", "text", "amount", "valueReference"]) {
      const result = scalar(object[key]);
      if (result !== undefined) return result;
    }
  }
  return undefined;
}

function deepFind(value: unknown, keys: string[], depth = 0): unknown {
  if (value == null || depth > 14) return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = deepFind(item, keys, depth + 1);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (typeof value !== "object") return undefined;
  const object = value as Record<string, unknown>;
  const wanted = new Set(keys.map((key) => key.toLowerCase()));
  for (const [key, child] of Object.entries(object)) {
    if (wanted.has(key.toLowerCase())) {
      const result = scalar(child);
      if (result !== undefined && String(result).trim()) return result;
    }
  }
  for (const child of Object.values(object)) {
    const found = deepFind(child, keys, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

function expandEncodedUrls(markup: string) {
  const decoded = decodeOtomoto(markup)
    .replace(/\\x2f/gi, "/")
    .replace(/\\x3a/gi, ":")
    .replace(/\\x26/gi, "&");
  return decoded.replace(/https?%3A%2F%2F[^"'<>\s\\]+/gi, (value) => {
    try { return decodeURIComponent(value); } catch { return value; }
  });
}

function jsonValues(markup: string) {
  const values: unknown[] = [];
  const expanded = expandEncodedUrls(markup);
  for (const match of expanded.matchAll(/<script[^>]+type=["'](?:application\/ld\+json|application\/json)["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    const payload = decodeOtomoto(match[1]);
    try { values.push(JSON.parse(payload)); } catch { /* continue */ }
  }
  return values;
}

function collectStrings(value: unknown, output: string[], depth = 0) {
  if (value == null || depth > 15) return;
  if (typeof value === "string") {
    const expanded = expandEncodedUrls(value);
    if (/https?:\/\//i.test(expanded) && /apollo\.olxcdn\.com|otomoto|\/image(?:[;/?#]|$)/i.test(expanded)) output.push(expanded);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, output, depth + 1);
    return;
  }
  if (typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (/image|photo|gallery|media|url|src|original|large|full/i.test(key) || depth < 7) collectStrings(child, output, depth + 1);
  }
}

function normalizeGalleryUrl(value: string, base: string) {
  try {
    const url = new URL(value, base);
    if (/apollo\.olxcdn\.com$/i.test(url.hostname) || /\.apollo\.olxcdn\.com$/i.test(url.hostname)) {
      url.pathname = url.pathname.replace(/\/image(?:;[^/?#]*)?$/i, "/image;s=1200x800");
    }
    return url.toString();
  } catch { return ""; }
}

function galleryKey(value: string) {
  try {
    const url = new URL(value);
    const file = url.pathname.match(/\/v1\/files\/([^/]+)\/image/i)?.[1];
    return file ? `${url.hostname.toLowerCase()}:${file.toLowerCase()}` : `${url.hostname.toLowerCase()}${url.pathname.replace(/;s=\d+x\d+/i, "")}`;
  } catch { return value.replace(/[?#].*$/, ""); }
}

function exactGallery(markup: string, base: string, fallback: string[] = []) {
  const expanded = expandEncodedUrls(markup);
  const values = [...extractOtomotoImages(expanded, base), ...fallback];
  for (const payload of jsonValues(expanded)) collectStrings(payload, values);
  for (const match of expanded.matchAll(/https?:\/\/[^"'<>\s\\]+(?:apollo\.olxcdn\.com|\/v1\/files\/)[^"'<>\s\\]*/gi)) values.push(match[0]);
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const url = normalizeGalleryUrl(value, base);
    if (!url || !/apollo\.olxcdn\.com|otomoto|\/image(?:[;/?#]|$)/i.test(url)) continue;
    const key = galleryKey(url);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(url);
  }
  return result;
}

function embeddedPrice(markup: string) {
  for (const value of jsonValues(markup)) {
    const price = otomotoInteger(deepFind(value, ["price", "lowPrice"]));
    const currency = String(deepFind(value, ["priceCurrency", "currency"]) || "").toUpperCase();
    if (price && /^[A-Z]{3}$/.test(currency)) return { price, currency };
  }
  const metaAmount = markup.match(/(?:property|itemprop)=["'](?:product:price:amount|price)["'][^>]+content=["']([0-9 .]+)["']/i)?.[1]
    || markup.match(/content=["']([0-9 .]+)["'][^>]+(?:property|itemprop)=["'](?:product:price:amount|price)["']/i)?.[1];
  const metaCurrency = markup.match(/(?:property|itemprop)=["'](?:product:price:currency|priceCurrency)["'][^>]+content=["']([A-Z]{3})["']/i)?.[1]
    || markup.match(/content=["']([A-Z]{3})["'][^>]+(?:property|itemprop)=["'](?:product:price:currency|priceCurrency)["']/i)?.[1];
  const price = otomotoInteger(metaAmount);
  if (price && metaCurrency) return { price, currency: metaCurrency.toUpperCase() };
  return null;
}

function validMileage(value: unknown) {
  const mileage = otomotoInteger(value);
  return mileage !== undefined && mileage >= 0 && mileage <= 5_000_000 ? mileage : undefined;
}

function mileageFromParameterObject(value: unknown, depth = 0): number | undefined {
  if (value == null || depth > 16) return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const mileage = mileageFromParameterObject(item, depth + 1);
      if (mileage !== undefined) return mileage;
    }
    return undefined;
  }
  if (typeof value !== "object") return undefined;
  const object = value as Record<string, unknown>;
  const identity = [object.key, object.code, object.name, object.label, object.displayName, object.parameter, object.slug]
    .map((item) => String(item || "").toLocaleLowerCase("pl-PL"))
    .join(" ");
  if (/\b(?:przebieg|mileage|mileagefromodometer|odometer)\b/i.test(identity)) {
    for (const key of ["value", "displayValue", "formattedValue", "amount", "text", "values"]) {
      const mileage = validMileage(object[key]);
      if (mileage !== undefined) return mileage;
    }
  }
  for (const child of Object.values(object)) {
    const mileage = mileageFromParameterObject(child, depth + 1);
    if (mileage !== undefined) return mileage;
  }
  return undefined;
}

function exactMileage(markup: string, values = jsonValues(markup)) {
  const expanded = expandEncodedUrls(markup);
  const directCandidates = [
    expanded.match(/itemprop=["']mileageFromOdometer["'][^>]*(?:content|value)=["']([0-9 .\u00a0\u202f]+)["']/i)?.[1],
    expanded.match(/(?:content|value)=["']([0-9 .\u00a0\u202f]+)["'][^>]*itemprop=["']mileageFromOdometer["']/i)?.[1],
    expanded.match(/["']mileageFromOdometer["']\s*:\s*\{[\s\S]{0,260}?["']value["']\s*:\s*["']?([0-9 .\u00a0\u202f]+)/i)?.[1],
    expanded.match(/["'](?:mileage|mileageKm|odometer|przebieg)["']\s*:\s*["']?([0-9 .\u00a0\u202f]+)/i)?.[1],
    cleanOtomoto(markup).match(/\bPrzebieg\s*[:：]?\s*([0-9][0-9 .\u00a0\u202f]{0,14})\s*km\b/i)?.[1],
  ];
  for (const candidate of directCandidates) {
    const mileage = validMileage(candidate);
    if (mileage !== undefined) return mileage;
  }
  for (const value of values) {
    const mileage = mileageFromParameterObject(value);
    if (mileage !== undefined) return mileage;
  }
  return validMileage(parseOtomotoMileage(markup));
}

function visibleLabelValue(plain: string, label: string, pattern: string) {
  return plain.match(new RegExp(`${label}\\s*[:：]?\\s*(${pattern})`, "i"))?.[1]?.trim();
}

function visibleDetails(markup: string, values = jsonValues(markup)) {
  const plain = cleanOtomoto(markup);
  const year = plausibleYear(visibleLabelValue(plain, "(?:Rok produkcji|Production year|Model year|Year)", "(?:19|20)\\d{2}"));
  const engineCc = otomotoInteger(visibleLabelValue(plain, "(?:Pojemność skokowa|Engine displacement)", "[0-9 .\\u00a0\\u202f]{2,12}(?=\\s*cm(?:3|³))"));
  const powerHp = otomotoInteger(visibleLabelValue(plain, "(?:Moc|Power)", "[0-9]{2,4}(?=\\s*(?:KM|HP|PS))"));
  const fuelText = visibleLabelValue(plain, "(?:Rodzaj paliwa|Fuel type)", "[^|•]{2,40}?(?=\\s+(?:Skrzynia biegów|Gearbox|Typ nadwozia|Body type|Pojemność|Moc|Napęd|$))") || "";
  const transmissionText = visibleLabelValue(plain, "(?:Skrzynia biegów|Gearbox|Transmission)", "[^|•]{2,40}?(?=\\s+(?:Typ nadwozia|Body type|Pojemność|Moc|Napęd|Rodzaj paliwa|$))") || "";
  const bodyText = visibleLabelValue(plain, "(?:Typ nadwozia|Body type)", "[^|•]{2,40}?(?=\\s+(?:Pojemność|Moc|Napęd|Rodzaj paliwa|Skrzynia|$))") || "";
  const driveText = visibleLabelValue(plain, "(?:Napęd|Drive)", "[^|•]{2,50}?(?=\\s+(?:Typ nadwozia|Pojemność|Moc|Rodzaj paliwa|Skrzynia|$))") || "";
  return {
    year,
    mileageKm: exactMileage(markup, values),
    engineCc,
    powerHp,
    fuel: normalizeOtomotoFuel(fuelText || plain),
    transmission: normalizeOtomotoTransmission(transmissionText || plain),
    bodyType: normalizeOtomotoBody(bodyText || plain),
    drive: normalizeOtomotoDrive(driveText || plain),
  };
}

function embeddedDetails(markup: string, values = jsonValues(markup)) {
  const root: unknown = values.length === 1 ? values[0] : values;
  const fuelText = String(deepFind(root, ["fuelType", "fuel"]) || "");
  const transmissionText = String(deepFind(root, ["vehicleTransmission", "transmission", "gearbox"]) || "");
  const bodyText = String(deepFind(root, ["bodyType", "vehicleConfiguration", "category"]) || "");
  const driveText = String(deepFind(root, ["driveWheelConfiguration", "driveType", "drivetrain", "drive"]) || "");
  const publishedRaw = deepFind(root, ["datePublished", "dateCreated", "publicationDate", "createdAt"]);
  const publishedTimestamp = Date.parse(String(publishedRaw || ""));
  return {
    year: plausibleYear(deepFind(root, ["productionYear", "modelYear", "vehicleModelDate", "productionDate", "dateVehicleFirstRegistered", "dateFirstRegistered"])),
    mileageKm: exactMileage(markup, values),
    engineCc: otomotoInteger(deepFind(root, ["engineDisplacement", "displacement", "engineCc", "capacity"])),
    powerHp: otomotoInteger(deepFind(root, ["enginePower", "horsePower", "horsepower", "powerHp", "power"])),
    fuel: normalizeOtomotoFuel(fuelText),
    transmission: normalizeOtomotoTransmission(transmissionText),
    bodyType: normalizeOtomotoBody(bodyText),
    drive: normalizeOtomotoDrive(driveText),
    publishedAt: Number.isFinite(publishedTimestamp) ? new Date(publishedTimestamp).toISOString() : undefined,
  };
}

async function fetchMarkup(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.CATALOG_SOURCE_TIMEOUT_MS || 35_000));
  try {
    const response = await fetch(url, { headers: { ...OTOMOTO_HEADERS, referer: "https://www.otomoto.pl/osobowe" }, redirect: "follow", signal: controller.signal });
    return response.ok ? await response.text() : "";
  } finally { clearTimeout(timeout); }
}

function enrichRow(row: OtomotoRow, markup: string): OtomotoRow {
  const values = jsonValues(markup);
  const embedded = embeddedDetails(markup, values);
  const visible = visibleDetails(markup, values);
  const parsedPrice = row.price && row.currency ? null : embeddedPrice(markup) || parseOtomotoPrice(markup.slice(0, 300_000));
  const detailImages = exactGallery(markup, row.url, row.images);
  return {
    ...row,
    year: embedded.year || visible.year || row.year,
    publishedAt: embedded.publishedAt || row.publishedAt,
    price: parsedPrice?.price || row.price,
    currency: parsedPrice?.currency || row.currency,
    mileageKm: embedded.mileageKm ?? visible.mileageKm ?? row.mileageKm,
    engineCc: embedded.engineCc || visible.engineCc || row.engineCc,
    powerHp: embedded.powerHp || visible.powerHp || row.powerHp,
    fuel: embedded.fuel || visible.fuel || row.fuel,
    transmission: embedded.transmission || visible.transmission || row.transmission,
    drive: embedded.drive || visible.drive || row.drive,
    bodyType: embedded.bodyType || visible.bodyType || row.bodyType,
    images: detailImages.length ? detailImages : row.images,
  };
}

export class OtomotoDetailAdapter extends OtomotoCurrentAdapter {
  async fetchPage(cursor?: string | null): Promise<CatalogFetchResult> {
    const result = await super.fetchPage(cursor);
    const rows: OtomotoRow[] = [];
    for (let index = 0; index < result.items.length; index += 3) {
      const batch = await Promise.all(result.items.slice(index, index + 3).map(async (raw) => {
        const row = raw as OtomotoRow;
        if (!row.url) return row;
        const markup = await fetchMarkup(row.url).catch(() => "");
        return markup ? enrichRow(row, markup) : row;
      }));
      rows.push(...batch);
      if (index + 3 < result.items.length) await new Promise((resolve) => setTimeout(resolve, 180));
    }
    return {
      ...result,
      items: rows,
      count: rows.length,
      health: {
        ...(result.health || { ok: true, checkedAt: new Date().toISOString() }),
        message: `${result.health?.message || "OTOMOTO"}; exact details, mileage and galleries checked`,
      },
    };
  }

  async fetchImages(offer: VehicleOffer): Promise<CatalogImage[]> {
    const row = offer.operational.raw as OtomotoRow;
    const requested = Number(process.env.CATALOG_MAX_IMAGES_PER_OFFER || 30);
    const limit = Math.min(30, Math.max(4, Number.isFinite(requested) ? requested : 30));
    const markup = row.url ? await fetchMarkup(row.url).catch(() => "") : "";
    const urls = exactGallery(markup, row.url, row.images).slice(0, limit);
    row.images = urls;
    (offer.operational as any).raw = row;

    const saved: CatalogImage[] = [];
    const seen = new Set<string>();
    for (let index = 0; index < urls.length && saved.length < limit; index += 2) {
      const batch = await Promise.all(urls.slice(index, index + 2).map((url) =>
        cacheImageFromUrl(url, "europe", { headers: { ...OTOMOTO_HEADERS, accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8", referer: row.url } }).catch(() => null),
      ));
      for (const image of batch) {
        if (!image || image.size <= 8_000) continue;
        const key = String(image.checksum || image.id || image.objectKey || image.url || "");
        if (!key || seen.has(key)) continue;
        seen.add(key);
        saved.push(image);
      }
      if (index + 2 < urls.length) await new Promise((resolve) => setTimeout(resolve, 300));
    }
    return saved.slice(0, limit);
  }
}

export const otomotoEuropeDetailSource = new OtomotoDetailAdapter();
