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
import type { CatalogFetchResult } from "./types";

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
  if (value == null || depth > 12) return undefined;
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

function jsonValues(markup: string) {
  const values: unknown[] = [];
  for (const match of markup.matchAll(/<script[^>]+type=["'](?:application\/ld\+json|application\/json)["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    const payload = decodeOtomoto(match[1]);
    try { values.push(JSON.parse(payload)); } catch { /* continue */ }
  }
  return values;
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

function visibleLabelValue(plain: string, label: string, pattern: string) {
  return plain.match(new RegExp(`${label}\\s*[:：]?\\s*(${pattern})`, "i"))?.[1]?.trim();
}

function visibleDetails(markup: string) {
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
    mileageKm: parseOtomotoMileage(markup),
    engineCc,
    powerHp,
    fuel: normalizeOtomotoFuel(fuelText || plain),
    transmission: normalizeOtomotoTransmission(transmissionText || plain),
    bodyType: normalizeOtomotoBody(bodyText || plain),
    drive: normalizeOtomotoDrive(driveText || plain),
  };
}

function embeddedDetails(markup: string) {
  const values = jsonValues(markup);
  const root: unknown = values.length === 1 ? values[0] : values;
  const fuelText = String(deepFind(root, ["fuelType", "fuel"]) || "");
  const transmissionText = String(deepFind(root, ["vehicleTransmission", "transmission", "gearbox"]) || "");
  const bodyText = String(deepFind(root, ["bodyType", "vehicleConfiguration", "category"]) || "");
  const driveText = String(deepFind(root, ["driveWheelConfiguration", "driveType", "drivetrain", "drive"]) || "");
  const publishedRaw = deepFind(root, ["datePublished", "dateCreated", "publicationDate", "createdAt"]);
  const publishedTimestamp = Date.parse(String(publishedRaw || ""));
  const mileage = otomotoInteger(deepFind(root, ["mileageFromOdometer", "mileage", "mileageKm", "odometer", "przebieg"]));
  return {
    year: plausibleYear(deepFind(root, ["productionYear", "modelYear", "vehicleModelDate", "productionDate", "dateVehicleFirstRegistered", "dateFirstRegistered"])),
    mileageKm: mileage !== undefined && mileage <= 5_000_000 ? mileage : undefined,
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
  } finally {
    clearTimeout(timeout);
  }
}

function enrichRow(row: OtomotoRow, markup: string): OtomotoRow {
  const embedded = embeddedDetails(markup);
  const visible = visibleDetails(markup);
  const parsedPrice = row.price && row.currency ? null : embeddedPrice(markup) || parseOtomotoPrice(markup.slice(0, 220_000));
  const detailImages = extractOtomotoImages(markup, row.url);
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
    for (let index = 0; index < result.items.length; index += 6) {
      const batch = await Promise.all(result.items.slice(index, index + 6).map(async (raw) => {
        const row = raw as OtomotoRow;
        if (!row.url) return row;
        const markup = await fetchMarkup(row.url).catch(() => "");
        return markup ? enrichRow(row, markup) : row;
      }));
      rows.push(...batch);
    }
    return {
      ...result,
      items: rows,
      count: rows.length,
      health: {
        ...(result.health || { ok: true, checkedAt: new Date().toISOString() }),
        message: `${result.health?.message || "OTOMOTO"}; detail price, mileage, specs and full galleries checked`,
      },
    };
  }
}

export const otomotoEuropeDetailSource = new OtomotoDetailAdapter();
