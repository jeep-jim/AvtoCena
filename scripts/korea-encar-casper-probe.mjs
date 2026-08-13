import fs from "node:fs/promises";

const maxPages = Math.max(1, Math.min(1000, Number(process.env.ENCAR_PROBE_MAX_PAGES || 600)));
const pageSize = Math.max(20, Math.min(100, Number(process.env.ENCAR_PROBE_PAGE_SIZE || 100)));
const maxMatches = Math.max(1, Math.min(50, Number(process.env.ENCAR_PROBE_MAX_MATCHES || 20)));
const requestGapMs = Math.max(75, Number(process.env.ENCAR_PROBE_GAP_MS || 150));
const output = process.env.ENCAR_PROBE_OUTPUT || "korea-encar-casper-2022-probe.json";
const query = process.env.CATALOG_ENCAR_DIRECT_QUERY || "(And.Hidden.N._.CarType.A.)";

const headers = {
  accept: "application/json, text/plain, */*",
  "accept-language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
  origin: "https://m.encar.com",
  referer: "https://m.encar.com/",
  "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const text = (value) => value == null ? "" : String(value).trim();
const number = (value) => {
  const n = Number(String(value ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
};
const isHyundai = (value) => /hyundai|현대|хенд[эе]/i.test(text(value));
const isCasper = (value) => /casper|캐스퍼|каспер/i.test(text(value));

async function fetchJson(url, label) {
  let lastError;
  for (let attempt = 1; attempt <= 5; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25_000);
    try {
      const response = await fetch(url, { headers, signal: controller.signal });
      const body = await response.text();
      if (response.ok) return JSON.parse(body);
      const retryable = response.status === 429 || response.status >= 500;
      const error = new Error(`${label}_http_${response.status}:${body.replace(/\s+/g, " ").slice(0, 180)}`);
      if (!retryable || attempt === 5) throw error;
      lastError = error;
    } catch (error) {
      lastError = error;
      if (attempt === 5) throw error;
    } finally {
      clearTimeout(timer);
    }
    await sleep(Math.min(8000, 700 * (2 ** (attempt - 1))));
  }
  throw lastError;
}

function collectImageStrings(value, key = "", depth = 0, out = []) {
  if (value == null || depth > 14) return out;
  if (typeof value === "string") {
    const v = value.replace(/\\\//g, "/");
    if (/ci\.encar\.com|\/carpicture\/|\.(?:jpe?g|png|webp)(?:[?#]|$)/i.test(v) && /photo|image|picture|gallery|media|location|path|url|^$/i.test(key)) out.push(v);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectImageStrings(item, key, depth + 1, out);
    return out;
  }
  if (typeof value !== "object") return out;
  for (const [childKey, child] of Object.entries(value)) {
    if (/photo|image|picture|gallery|media|location|path|url/i.test(childKey) || depth < 7) collectImageStrings(child, childKey, depth + 1, out);
  }
  return out;
}

function deepFind(value, keys, depth = 0) {
  if (value == null || depth > 10 || typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = deepFind(item, keys, depth + 1);
      if (found !== undefined && found !== null && text(found)) return found;
    }
    return undefined;
  }
  for (const key of keys) if (value[key] !== undefined && value[key] !== null && text(value[key])) return value[key];
  for (const child of Object.values(value)) {
    const found = deepFind(child, keys, depth + 1);
    if (found !== undefined && found !== null && text(found)) return found;
  }
  return undefined;
}

const matches = [];
let pages = 0;
let seen = 0;
let count = null;
let finished = false;
let lastOffset = 0;

for (let page = 0; page < maxPages && matches.length < maxMatches; page++) {
  const offset = page * pageSize;
  lastOffset = offset;
  const url = new URL("https://api.encar.com/search/car/list/mobile");
  url.searchParams.set("count", "true");
  url.searchParams.set("q", query);
  url.searchParams.set("sr", `|MobileModifiedDate|${offset}|${pageSize}`);
  url.searchParams.set("inav", "|Metadata|Sort");
  const json = await fetchJson(url.toString(), `list_${offset}`);
  const items = json.SearchResults || json.searchResults || json.cars || json.items || [];
  if (count == null) count = Number(json.Count || json.count || 0) || null;
  pages++;
  seen += items.length;
  for (const raw of items) {
    const manufacturer = text(raw.Manufacturer || raw.ManufacturerName || raw.maker);
    const model = text(raw.Model || raw.ModelName);
    const year = Number(text(raw.FormYear || raw.Year || raw.YearMonth).slice(0, 4));
    if (year !== 2022 || !isHyundai(manufacturer) || !isCasper(model)) continue;
    const id = text(raw.Id || raw.CarId || raw.carId);
    if (!id || matches.some((row) => row.sourceOfferId === id)) continue;
    matches.push({
      sourceOfferId: id,
      manufacturer,
      model,
      year,
      badge: text(raw.Badge),
      badgeDetail: text(raw.BadgeDetail),
      priceRaw: raw.Price ?? null,
      mileage: number(raw.Mileage),
      modifiedDate: text(raw.ModifiedDate || raw.UpdatedDate),
      listPhoto: text(raw.Photo || raw.photo),
      offset,
    });
    if (matches.length >= maxMatches) break;
  }
  if (!items.length || items.length < pageSize) {
    finished = true;
    break;
  }
  if (page % 25 === 0 || matches.length) console.log(JSON.stringify({ event: "scan", pages, seen, count, offset, matches: matches.length }));
  await sleep(requestGapMs);
}

for (const match of matches) {
  try {
    const detail = await fetchJson(`https://api.encar.com/v1/readside/vehicle/${encodeURIComponent(match.sourceOfferId)}`, `detail_${match.sourceOfferId}`);
    const images = [...new Set(collectImageStrings(detail).map((value) => text(value)).filter(Boolean))];
    match.detail = {
      ok: true,
      imageStrings: images.length,
      imageSamples: images.slice(0, 8),
      displacement: number(deepFind(detail, ["displacement", "Displacement", "EngineDisplacement", "engineDisplacement", "cc"])),
      power: number(deepFind(detail, ["power", "Power", "horsePower", "horsepower", "ps"])),
      fuel: text(deepFind(detail, ["fuelType", "FuelType", "fuel", "Fuel"])),
      transmission: text(deepFind(detail, ["transmission", "Transmission", "gearbox", "Gearbox"])),
      registrationDate: text(deepFind(detail, ["registrationDate", "RegistrationDate", "formYear", "productionDate"])),
    };
  } catch (error) {
    match.detail = { ok: false, error: String(error?.message || error) };
  }
  await sleep(250);
}

const report = {
  version: 1,
  mode: "read_only_encar_raw_listing_probe",
  query,
  pageSize,
  maxPages,
  pages,
  seen,
  count,
  lastOffset,
  finished,
  casper2022: matches.length,
  exactDetailOk: matches.filter((row) => row.detail?.ok).length,
  matches,
};
await fs.writeFile(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, matches: report.matches.map((row) => ({ sourceOfferId: row.sourceOfferId, manufacturer: row.manufacturer, model: row.model, year: row.year, priceRaw: row.priceRaw, mileage: row.mileage, offset: row.offset, detail: row.detail })) }, null, 2));
