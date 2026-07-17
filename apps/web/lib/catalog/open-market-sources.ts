import { cacheImageFromUrl, stableOfferId } from "./storage";
import type { CatalogFetchResult, CatalogImage, CatalogMarket, CatalogSourceAdapter, OfferStatus, VehicleOffer } from "./types";

const HEADERS = {
  accept: "text/html,application/xhtml+xml,application/json;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9,ru;q=0.8,zh-CN;q=0.7,ja;q=0.6,de;q=0.5",
  "cache-control": "no-cache",
  pragma: "no-cache",
  "upgrade-insecure-requests": "1",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
};

const BLOCK_RE = /captcha|cloudflare|access denied|request blocked|robot check|verify you are human|temporarily unavailable|forbidden/i;
const NON_CAR_RE = /\b(?:motorcycle|motorbike|scooter|forklift|excavator|bulldozer|tractor|crane|generator|boat|ship|jet\s*ski|machinery|construction\s+equipment|spare\s+parts?|engine\s+only)\b/i;
const KNOWN_MAKES = [
  "Mercedes-Benz", "Mercedes Benz", "Land Rover", "Range Rover", "Rolls-Royce", "Rolls Royce", "Alfa Romeo", "Aston Martin", "Great Wall", "Li Auto",
  "Toyota", "Lexus", "Nissan", "Infiniti", "Honda", "Acura", "Mazda", "Mitsubishi", "Subaru", "Suzuki", "Daihatsu", "Isuzu", "Hino", "Mitsuoka",
  "Hyundai", "Genesis", "Kia", "KGM", "SsangYong", "BMW", "Audi", "Volkswagen", "Volvo", "Porsche", "Ford", "Chevrolet", "Cadillac", "Jeep",
  "Dodge", "Renault", "Peugeot", "Citroen", "Skoda", "SEAT", "MINI", "Fiat", "Opel", "Tesla", "BYD", "Geely", "Changan", "Chery", "GAC",
  "Haval", "Zeekr", "Nio", "XPeng", "Jetour", "Denza", "Rox", "Hongqi", "Tank", "Voyah", "Aito", "Leapmotor", "Arcfox", "Neta",
];

const CHINESE_REPLACEMENTS: Array<[RegExp, string]> = [
  [/雷克萨斯/g, "Lexus "], [/梅赛德斯[-·]?奔驰|奔驰/g, "Mercedes-Benz "], [/宝马/g, "BMW "], [/奥迪/g, "Audi "], [/大众/g, "Volkswagen "],
  [/丰田/g, "Toyota "], [/本田/g, "Honda "], [/日产/g, "Nissan "], [/马自达/g, "Mazda "], [/三菱/g, "Mitsubishi "], [/斯巴鲁/g, "Subaru "],
  [/现代/g, "Hyundai "], [/起亚/g, "Kia "], [/捷尼赛思/g, "Genesis "], [/沃尔沃/g, "Volvo "], [/保时捷/g, "Porsche "], [/福特/g, "Ford "],
  [/雪佛兰/g, "Chevrolet "], [/凯迪拉克/g, "Cadillac "], [/路虎/g, "Land Rover "], [/特斯拉/g, "Tesla "], [/比亚迪/g, "BYD "],
  [/吉利/g, "Geely "], [/长安/g, "Changan "], [/奇瑞/g, "Chery "], [/哈弗/g, "Haval "], [/广汽/g, "GAC "], [/理想/g, "Li Auto "],
  [/蔚来/g, "Nio "], [/小鹏/g, "XPeng "], [/极氪/g, "Zeekr "], [/捷途/g, "Jetour "], [/腾势/g, "Denza "], [/坦克/g, "Tank "],
  [/岚图/g, "Voyah "], [/问界/g, "Aito "], [/零跑/g, "Leapmotor "], [/极狐/g, "Arcfox "], [/哪吒/g, "Neta "],
];

export type OpenMarketSourceConfig = {
  sourceId: string;
  market: CatalogMarket;
  label: string;
  baseUrl: string;
  currency: string;
  listUrls: (page: number) => string[];
  detailPattern: RegExp;
  referer?: string;
  forcedCharset?: string;
};

type OpenRow = {
  id: string;
  title: string;
  make: string;
  model: string;
  year: number;
  mileageKm?: number;
  engineCc?: number;
  powerHp?: number;
  fuel?: string;
  transmission?: string;
  drive?: string;
  bodyType?: string;
  price?: number;
  currency: string;
  images: string[];
  detailUrl: string;
  location?: string;
  status: "active" | "sold";
};

function text(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  if (Array.isArray(value)) return value.map(text).find(Boolean) || "";
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    for (const key of ["name", "title", "label", "value", "text", "displayName"]) {
      const resolved = text(object[key]);
      if (resolved) return resolved;
    }
  }
  return "";
}

function decodeHtml(value: string) {
  return value
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#x2F;/gi, "/")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function stripHtml(value: string) {
  return decodeHtml(value)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/[\u0000-\u001f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeText(value: string) {
  let result = decodeHtml(value || "");
  for (const [pattern, replacement] of CHINESE_REPLACEMENTS) result = result.replace(pattern, replacement);
  return result
    .replace(/新上架|二手车|准新车|在售|报价|图片|详情|立即购买|查看详情/g, " ")
    .replace(/[\u0000-\u001f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function absoluteUrl(value: unknown, baseUrl: string) {
  const raw = text(value);
  if (!raw || /^(?:data:|javascript:|mailto:|tel:)/i.test(raw)) return "";
  try { return new URL(raw.replace(/\\\//g, "/"), baseUrl).toString(); } catch { return ""; }
}

function first(object: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = object[key];
    if (value !== undefined && value !== null && text(value)) return value;
  }
  return undefined;
}

function collectObjects(value: unknown, output: Record<string, unknown>[], depth = 0) {
  if (value == null || depth > 11) return;
  if (Array.isArray(value)) { value.forEach((item) => collectObjects(item, output, depth + 1)); return; }
  if (typeof value !== "object") return;
  const object = value as Record<string, unknown>;
  output.push(object);
  Object.values(object).forEach((item) => collectObjects(item, output, depth + 1));
}

function collectImages(value: unknown, baseUrl: string) {
  const candidates: string[] = [];
  const visit = (current: unknown, depth = 0) => {
    if (current == null || depth > 8) return;
    if (typeof current === "string") {
      if (/\.(?:jpe?g|png|webp|avif)(?:[?#]|$)/i.test(current) || /\/image\//i.test(current)) candidates.push(current);
      return;
    }
    if (Array.isArray(current)) { current.forEach((item) => visit(item, depth + 1)); return; }
    if (typeof current === "object") {
      for (const [key, child] of Object.entries(current as Record<string, unknown>)) {
        if (/image|photo|picture|gallery|media|thumb|src|url/i.test(key)) visit(child, depth + 1);
        else if (depth < 3) visit(child, depth + 1);
      }
    }
  };
  visit(value);
  return [...new Set(candidates.map((item) => absoluteUrl(item, baseUrl)).filter((url) =>
    /^https?:/i.test(url) && !/logo|favicon|icon|sprite|banner|placeholder|avatar|tracking|pixel|cookie|qrcode|qr-code|no[-_ ]?photo|no[-_ ]?image/i.test(url),
  ))];
}

function collectMarkupImages(markup: string, baseUrl: string) {
  const candidates: string[] = [];
  for (const match of markup.matchAll(/<(?:img|source)[^>]+(?:data-original|data-lazy-src|data-src|src)\s*=\s*["']([^"']+)["']/gi)) candidates.push(match[1]);
  for (const match of markup.matchAll(/(?:data-srcset|srcset)\s*=\s*["']([^"']+)["']/gi)) match[1].split(",").forEach((item) => candidates.push(item.trim().split(/\s+/)[0]));
  for (const match of markup.matchAll(/https?:\\?\/\\?\/[^"'\\\s<>]+?\.(?:jpe?g|png|webp|avif)(?:\?[^"'\\\s<>]*)?/gi)) candidates.push(match[0].replace(/\\\//g, "/"));
  return [...new Set(candidates.map((item) => absoluteUrl(item, baseUrl)).filter((url) =>
    /^https?:/i.test(url) && !/logo|favicon|icon|sprite|banner|placeholder|avatar|tracking|pixel|cookie|qrcode|qr-code|no[-_ ]?photo|no[-_ ]?image/i.test(url),
  ))];
}

function integer(value: unknown) {
  const number = Number(text(value).replace(/[^0-9]/g, ""));
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function decimal(value: unknown) {
  const number = Number(text(value).replace(/[^0-9.,]/g, "").replace(",", "."));
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function mileage(value: unknown) {
  const raw = text(value);
  const wan = raw.match(/([0-9]+(?:[.,][0-9]+)?)\s*万\s*(?:公里|km)?/i);
  if (wan) return Math.round(Number(wan[1].replace(",", ".")) * 10_000);
  return integer(raw);
}

function deriveMakeModel(rawTitle: string) {
  const title = normalizeText(rawTitle)
    .replace(/^(?:used|new|gebraucht|neu|occasion|usato|voiture|auto|samoch[oó]d|featured|promoted|premium)\s+/i, "")
    .replace(/^(?:19|20)\d{2}(?:\/\d+)?\s+/, "")
    .replace(/^\d{1,2}\/\d{4}\s+/, "")
    .trim();
  const lower = title.toLocaleLowerCase("en-US");
  const matched = KNOWN_MAKES.find((make) => lower === make.toLocaleLowerCase("en-US") || lower.startsWith(`${make.toLocaleLowerCase("en-US")} `));
  if (matched) {
    const make = matched === "Mercedes Benz" ? "Mercedes-Benz" : matched === "Rolls Royce" ? "Rolls-Royce" : matched;
    const rest = title.slice(matched.length).replace(/^[\s\-–—·|]+/, "").trim();
    return { title, make, model: rest.split(/\s+/).slice(0, 5).join(" ") || make };
  }
  const parts = title.split(/\s+/).filter(Boolean);
  return { title, make: parts[0] || "", model: parts.slice(1, 6).join(" ") || parts[0] || "" };
}

function detectPrice(value: string, fallbackCurrency: string) {
  const plain = normalizeText(value);
  const wan = plain.match(/(?:￥|¥|RMB|CNY)?\s*([0-9]+(?:[.,][0-9]+)?)\s*万(?:元)?/i);
  if (wan) return { price: Math.round(Number(wan[1].replace(",", ".")) * 10_000), currency: "CNY" };
  const patterns: Array<[RegExp, string]> = [
    [/(?:AED|د\.?إ\.?)\s*([0-9][0-9 ,.']{2,})/i, "AED"],
    [/(?:USD|US\$|\$)\s*([0-9][0-9 ,.']{2,})/i, "USD"],
    [/(?:EUR|€)\s*([0-9][0-9 ,.']{2,})/i, "EUR"],
    [/(?:GBP|£)\s*([0-9][0-9 ,.']{2,})/i, "GBP"],
    [/(?:PLN|zł)\s*([0-9][0-9 ,.']{2,})/i, "PLN"],
    [/(?:CHF)\s*([0-9][0-9 ,.']{2,})/i, "CHF"],
    [/(?:SEK|kr)\s*([0-9][0-9 ,.']{2,})/i, fallbackCurrency],
    [/(?:NOK|DKK|HUF|CZK)\s*([0-9][0-9 ,.']{2,})/i, fallbackCurrency],
    [/(?:JPY|JP¥|円|¥)\s*([0-9][0-9 ,.']{2,})/i, "JPY"],
    [/(?:CNY|RMB|CN¥|￥)\s*([0-9][0-9 ,.']{2,})/i, "CNY"],
    [/([0-9][0-9 ,.']{2,})\s*(?:AED|USD|EUR|GBP|PLN|CHF|SEK|NOK|DKK|HUF|CZK|JPY|円|CNY|RMB|zł)/i, fallbackCurrency],
  ];
  for (const [pattern, currency] of patterns) {
    const amount = integer(plain.match(pattern)?.[1]);
    if (amount) return { price: amount, currency };
  }
  return { price: undefined, currency: fallbackCurrency };
}

function detectFuel(value: string) {
  return value.match(/\b(Petrol|Gasoline|Benzin|Essence|Benzina|Gasolina|Diesel|Hybrid|Plug[- ]?in Hybrid|PHEV|Electric|EV|BEV|LPG|GPL)\b/i)?.[1]
    || value.match(/(汽油|柴油|混合动力|插电混动|纯电|增程|бензин|дизель|гибрид|электро)/i)?.[1]
    || "";
}

function detectTransmission(value: string) {
  return value.match(/\b(Automatic|Automatik|Automatique|Automatica|Automático|Manual|Schaltgetriebe|Manuelle|CVT|DCT|DSG|AT|MT)\b/i)?.[1]
    || value.match(/(自动|手动|无级变速|双离合|автомат|механика|вариатор|робот)/i)?.[1]
    || "";
}

function detectDrive(value: string) {
  return value.match(/\b(AWD|4WD|4x4|2WD|FWD|RWD|Allrad|Frontantrieb|Heckantrieb)\b/i)?.[1]
    || value.match(/(四驱|前驱|后驱|两驱|полный|передний|задний)/i)?.[1]
    || "";
}

function detectBody(value: string) {
  return value.match(/\b(SUV\/Crossover|SUV|Crossover|Sedan|Saloon|Hatchback|Coupe|Convertible|Cabrio|Roadster|Pickup|Pick Up|Wagon|Estate|Kombi|Minivan|MPV|Van|Liftback)\b/i)?.[1]
    || value.match(/(轿车|跑车|两厢|三厢|旅行车|越野车|皮卡|минивэн|седан|кроссовер|универсал|хэтчбек|купе)/i)?.[1]
    || "";
}

function parseEmbeddedObjects(markup: string) {
  const result: Record<string, unknown>[] = [];
  for (const match of markup.matchAll(/<script[^>]*(?:type=["'](?:application\/ld\+json|application\/json)["']|id=["'](?:__NEXT_DATA__|__NUXT_DATA__)["'])[^>]*>([\s\S]*?)<\/script>/gi)) {
    try { collectObjects(JSON.parse(match[1].trim()), result); } catch { /* one malformed block must not stop the source */ }
  }
  return result;
}

function objectScalar(object: Record<string, unknown>, keys: string[]) {
  const value = first(object, keys);
  if (typeof value === "object" && value && !Array.isArray(value)) return first(value as Record<string, unknown>, ["name", "title", "value", "label", "price"]);
  return value;
}

function rowFromObject(object: Record<string, unknown>, config: OpenMarketSourceConfig): OpenRow | null {
  const rawTitle = text(objectScalar(object, ["name", "title", "vehicleName", "carName", "productName", "displayName", "fullName"]));
  const explicitMake = normalizeText(text(objectScalar(object, ["brand", "make", "maker", "manufacturer", "vehicleMake", "mark"]))).replace(/\s+$/, "");
  const explicitModel = normalizeText(text(objectScalar(object, ["model", "modelName", "vehicleModel", "series", "seriesName"]))).replace(/\s+$/, "");
  const derived = deriveMakeModel(rawTitle);
  const make = explicitMake || derived.make;
  const model = explicitModel || derived.model;
  const detailUrl = absoluteUrl(objectScalar(object, ["url", "detailUrl", "link", "href", "canonicalUrl", "webUrl"]), config.baseUrl);
  const year = Number(text(objectScalar(object, ["year", "modelYear", "registrationYear", "manufactureYear", "productionYear", "vehicleModelDate"])).match(/(?:19|20)\d{2}/)?.[0] || rawTitle.match(/(?:19|20)\d{2}/)?.[0]);
  if (!make || !model || !year || !detailUrl || !config.detailPattern.test(`${new URL(detailUrl).pathname}${new URL(detailUrl).search}`)) return null;
  const serialized = JSON.stringify(object);
  const priceObject = first(object, ["offers", "offer"]);
  const explicitPrice = objectScalar(object, ["price", "vehiclePrice", "salePrice", "fobPrice", "currentPrice", "amount", "lowPrice"])
    || (typeof priceObject === "object" && priceObject ? objectScalar(priceObject as Record<string, unknown>, ["price", "lowPrice", "highPrice"]) : undefined);
  const detected = detectPrice(`${text(explicitPrice)} ${serialized}`, text(objectScalar(object, ["priceCurrency", "currency", "currencyCode"])) || config.currency);
  const images = collectImages(object, config.baseUrl);
  const id = text(objectScalar(object, ["stockNo", "stockNumber", "stockId", "refNo", "reference", "sku", "productID", "vehicleId", "carId", "id", "objectId"]))
    || detailUrl.match(/(?:-|\/)([a-z0-9]{5,})(?:\.[a-z]+|[/?#]|$)/i)?.[1]
    || stableOfferId(config.sourceId, detailUrl);
  const title = normalizeText(rawTitle || `${year} ${make} ${model}`);
  if (NON_CAR_RE.test(title)) return null;
  return {
    id,
    title,
    make,
    model,
    year,
    mileageKm: mileage(objectScalar(object, ["mileage", "mileageKm", "odometer", "run", "mileageFromOdometer"])),
    engineCc: integer(objectScalar(object, ["engine", "engineCc", "displacement", "engineVolume", "vehicleEngine"])),
    powerHp: integer(objectScalar(object, ["powerHp", "horsepower", "power", "enginePower"])),
    fuel: text(objectScalar(object, ["fuel", "fuelType", "engineType"])) || detectFuel(serialized),
    transmission: text(objectScalar(object, ["transmission", "gearbox", "trans", "vehicleTransmission"])) || detectTransmission(serialized),
    drive: text(objectScalar(object, ["drive", "drivetrain", "driveType"])) || detectDrive(serialized),
    bodyType: text(objectScalar(object, ["body", "bodyType", "vehicleType", "category", "vehicleConfiguration"])) || detectBody(serialized),
    price: detected.price,
    currency: detected.currency,
    images,
    detailUrl,
    location: text(objectScalar(object, ["location", "inventoryLocation", "country", "city", "yard", "seller"])),
    status: /sold|unavailable|reserved|verkauft|vendu|sprzedane|продан/i.test(text(objectScalar(object, ["status", "availability"]))) ? "sold" : "active",
  };
}

function titleFromCard(anchorText: string, card: string) {
  const candidates = [
    stripHtml(anchorText),
    normalizeText(card.match(/<img[^>]+alt\s*=\s*["']([^"']+)["']/i)?.[1] || ""),
    stripHtml(card.match(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/i)?.[1] || ""),
    normalizeText(card.match(/(?:aria-label|title)\s*=\s*["']([^"']+)["']/i)?.[1] || ""),
  ];
  return candidates.find((candidate) => candidate.length >= 4 && candidate.length <= 260 && !/^(?:call|whatsapp|email|save|details?|view|image|loading|next|previous|contact|compare)$/i.test(candidate)) || "";
}

function rowsFromHtml(markup: string, config: OpenMarketSourceConfig) {
  const anchors = [...markup.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .map((match) => ({ href: absoluteUrl(match[1], config.baseUrl), inner: match[2], index: match.index || 0 }))
    .filter((item) => {
      if (!item.href) return false;
      try { const url = new URL(item.href); return config.detailPattern.test(`${url.pathname}${url.search}`); } catch { return false; }
    });
  const rows: OpenRow[] = [];
  const seen = new Set<string>();
  anchors.forEach((anchor, index) => {
    if (seen.has(anchor.href)) return;
    const previous = index > 0 ? anchors[index - 1].index : 0;
    const next = index + 1 < anchors.length ? anchors[index + 1].index : markup.length;
    const card = markup.slice(Math.max(previous, anchor.index - 6_000), Math.min(next + 3_000, anchor.index + 18_000));
    const plain = normalizeText(stripHtml(card));
    const rawTitle = titleFromCard(anchor.inner, card);
    const derived = deriveMakeModel(rawTitle);
    const year = Number((`${derived.title} ${plain}`).match(/\b(?:19|20)\d{2}\b/)?.[0]);
    if (!year || !derived.make || !derived.model || NON_CAR_RE.test(`${derived.title} ${plain}`)) return;
    const detected = detectPrice(plain, config.currency);
    const liters = plain.match(/\b([0-9]+(?:[.,][0-9]+)?)\s*(?:L|リッター)\b/i);
    const cc = plain.match(/\b([0-9][0-9 ,.']{2,5})\s*(?:cc|cm3|cm³|куб\.см)/i);
    const powerHp = plain.match(/\b([0-9]{2,4})\s*(?:HP|PS|KM|CV|л\.с\.)\b/i);
    const powerKw = plain.match(/\b([0-9]{2,4})\s*kW\b/i);
    const id = anchor.href.match(/(?:-|\/)([a-z0-9]{5,})(?:\.[a-z]+|[/?#]|$)/i)?.[1] || stableOfferId(config.sourceId, anchor.href);
    seen.add(anchor.href);
    rows.push({
      id,
      title: derived.title,
      make: derived.make,
      model: derived.model,
      year,
      mileageKm: mileage(plain.match(/([0-9]+(?:[.,][0-9]+)?\s*万|[0-9]{1,3}(?:[ ,.'][0-9]{3})+|[0-9]{2,8})\s*(?:km|公里|キロ)/i)?.[1]),
      engineCc: cc ? integer(cc[1]) : liters ? Math.round(Number(liters[1].replace(",", ".")) * 1_000) : undefined,
      powerHp: integer(powerHp?.[1]) || (powerKw ? Math.round(Number(powerKw[1]) * 1.35962) : undefined),
      fuel: detectFuel(plain),
      transmission: detectTransmission(plain),
      drive: detectDrive(plain),
      bodyType: detectBody(plain),
      price: detected.price,
      currency: detected.currency,
      images: collectMarkupImages(card, config.baseUrl),
      detailUrl: anchor.href,
      location: plain.match(/\b(Tokyo|Yokohama|Nagoya|Osaka|Kobe|Fukuoka|Hokkaido|Beijing|Shanghai|Guangzhou|Shenzhen|Germany|France|Italy|Spain|Netherlands|Belgium|Austria|Poland|Portugal|Sweden|Norway|Denmark|United Kingdom)\b/i)?.[1],
      status: /\b(?:sold|unavailable|reserved|verkauft|vendu|sprzedane|продан)\b/i.test(plain) ? "sold" : "active",
    });
  });
  return rows;
}

export function parseOpenMarketPage(markup: string, config: OpenMarketSourceConfig) {
  const unique = new Map<string, OpenRow>();
  for (const object of parseEmbeddedObjects(markup)) {
    const row = rowFromObject(object, config);
    if (!row) continue;
    const previous = unique.get(row.id);
    if (!previous || row.images.length > previous.images.length || (!previous.price && row.price)) unique.set(row.id, row);
  }
  for (const row of rowsFromHtml(markup, config)) {
    const previous = unique.get(row.id);
    if (!previous || row.images.length > previous.images.length || (!previous.price && row.price)) unique.set(row.id, row);
  }
  return [...unique.values()].filter((row) => row.year >= 1990 && row.year <= new Date().getFullYear() + 1);
}

async function decodedResponse(response: Response, forcedCharset?: string) {
  const bytes = await response.arrayBuffer();
  const declared = response.headers.get("content-type")?.match(/charset=([^;\s]+)/i)?.[1]?.replace(/["']/g, "");
  const utf8 = new TextDecoder("utf-8").decode(bytes);
  const brokenRatio = (utf8.match(/�/g) || []).length / Math.max(1, utf8.length);
  const charset = forcedCharset || declared || (brokenRatio > 0.0005 ? "gb18030" : "utf-8");
  try { return new TextDecoder(charset).decode(bytes); } catch { return utf8; }
}

export class OpenMarketAdapter implements CatalogSourceAdapter {
  sourceId: string;
  market: CatalogMarket;
  accessMode = "public_html" as const;
  private config: OpenMarketSourceConfig;

  constructor(config: OpenMarketSourceConfig) {
    this.sourceId = config.sourceId;
    this.market = config.market;
    this.config = config;
  }

  private headers(referer?: string) { return { ...HEADERS, referer: referer || this.config.referer || `${this.config.baseUrl}/` }; }

  private async request(url: string) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Number(process.env.CATALOG_SOURCE_TIMEOUT_MS || 25_000));
    try {
      const response = await fetch(url, { headers: this.headers(), redirect: "follow", signal: controller.signal });
      const markup = await decodedResponse(response, this.config.forcedCharset);
      if ([401, 403, 429].includes(response.status) || BLOCK_RE.test(markup.slice(0, 2_000))) {
        const error = new Error(`${this.sourceId}_blocked_${response.status}`) as Error & { blocked?: boolean; status?: number };
        error.blocked = true; error.status = response.status; throw error;
      }
      return { response, markup };
    } finally { clearTimeout(timer); }
  }

  async fetchPage(cursor?: string | null): Promise<CatalogFetchResult> {
    const page = Math.max(1, Number(cursor || 1));
    let lastStatus = 0;
    let lastBytes = 0;
    for (const url of this.config.listUrls(page)) {
      const result = await this.request(url).catch((error) => { if ((error as any)?.blocked) throw error; return null; });
      if (!result) continue;
      lastStatus = result.response.status;
      lastBytes = result.markup.length;
      if (!result.response.ok) continue;
      const items = parseOpenMarketPage(result.markup, this.config);
      if (!items.length) continue;
      return {
        items,
        nextCursor: String(page + 1),
        finished: false,
        count: items.length,
        health: { ok: true, message: `${this.config.label}: parsed ${items.length}`, checkedAt: new Date().toISOString(), httpStatus: result.response.status, contentType: result.response.headers.get("content-type") || "" },
      };
    }
    throw new Error(`${this.sourceId}_parsed_zero_status_${lastStatus}_bytes_${lastBytes}`);
  }

  mapStatus(raw: unknown): OfferStatus { return (raw as OpenRow).status === "sold" ? "sold" : "active"; }

  normalizeOffer(raw: unknown): VehicleOffer | null {
    const row = raw as OpenRow;
    if (!row.id || !row.make || !row.model || !row.year || !row.detailUrl) return null;
    const now = new Date().toISOString();
    return {
      id: stableOfferId(this.sourceId, row.id),
      sourceId: this.sourceId,
      sourceOfferId: row.id,
      market: this.market,
      offerType: "fixed",
      status: this.mapStatus(row),
      make: row.make,
      model: row.model,
      trim: row.title,
      year: row.year,
      mileageKm: row.mileageKm,
      engineCc: row.engineCc,
      powerHp: row.powerHp,
      fuel: row.fuel,
      transmission: row.transmission,
      drive: row.drive,
      bodyType: row.bodyType,
      sourcePrice: row.price || null,
      sourceCurrency: row.price ? row.currency : null,
      priceMode: row.price ? "fixed" : "estimated",
      images: [],
      totalRub: null,
      calculationStatus: row.price ? "ready" : "needs_data",
      firstSeenAt: now,
      updatedAt: now,
      operational: { sourceUrl: row.detailUrl, sourceVenueName: row.location || this.config.label, raw: row },
    };
  }

  async fetchImages(offer: VehicleOffer): Promise<CatalogImage[]> {
    const row = (offer.operational.raw || {}) as OpenRow;
    const limit = Math.max(1, Number(process.env.CATALOG_MAX_IMAGES_PER_OFFER || 10));
    let urls = [...(row.images || [])];
    if (row.detailUrl) {
      const detail = await this.request(row.detailUrl).catch(() => null);
      if (detail?.response.ok) {
        const details = parseOpenMarketPage(detail.markup, this.config);
        const enriched = details.find((item) => item.id === row.id) || details[0];
        if (enriched) {
          offer.mileageKm ||= enriched.mileageKm;
          offer.engineCc ||= enriched.engineCc;
          offer.powerHp ||= enriched.powerHp;
          offer.fuel ||= enriched.fuel;
          offer.transmission ||= enriched.transmission;
          offer.drive ||= enriched.drive;
          offer.bodyType ||= enriched.bodyType;
          if (!offer.sourcePrice && enriched.price) { offer.sourcePrice = enriched.price; offer.sourceCurrency = enriched.currency; offer.priceMode = "fixed"; offer.calculationStatus = "ready"; }
          urls = [...urls, ...enriched.images];
        }
        urls = [...urls, ...collectMarkupImages(detail.markup, this.config.baseUrl)];
        parseEmbeddedObjects(detail.markup).forEach((object) => urls.push(...collectImages(object, this.config.baseUrl)));
      }
    }
    const cached: CatalogImage[] = [];
    for (const url of [...new Set(urls)].slice(0, limit)) {
      const image = await cacheImageFromUrl(url, offer.market, { headers: this.headers(row.detailUrl) }).catch(() => null);
      if (image && image.size > 8_000) cached.push(image);
      if (cached.length >= limit) break;
    }
    return cached;
  }

  async healthCheck() { return { ok: true, message: `${this.config.label}: checked during import`, checkedAt: new Date().toISOString() }; }
}

function pageQuery(base: string, page: number, key = "page") { const url = new URL(base); url.searchParams.set(key, String(page)); return url.toString(); }
function pathPage(base: string, page: number) { return page <= 1 ? base : `${base.replace(/\/$/, "")}/page/${page}`; }

const japanConfigs: OpenMarketSourceConfig[] = [
  { sourceId: "beforward_japan_open", market: "japan", label: "BE FORWARD Japan", baseUrl: "https://www.beforward.jp", currency: "USD", detailPattern: /\/(?:auto|stocklist)\/[^?#]*[A-Z]{1,4}\d{4,}/i, listUrls: (p) => [`https://www.beforward.jp/stocklist/stock_country%3D47/page%3D${p}/sortkey%3Dn`, `https://www.beforward.jp/stocklist/page%3D${p}/sortkey%3Dn`] },
  { sourceId: "tcv_japan_open", market: "japan", label: "TCV Japan", baseUrl: "https://www.tc-v.com", currency: "USD", detailPattern: /\/used_car\/(?:[^/]+\/){2,}|\/stock\/|\/spec\//i, listUrls: (p) => [pageQuery("https://www.tc-v.com/used_car/all/", p), pageQuery("https://www.tc-v.com/pr/search.aspx", p)] },
  { sourceId: "japan_partner_open", market: "japan", label: "Japan Partner", baseUrl: "https://www.japan-partner.com", currency: "USD", detailPattern: /\/(?:Auto|AAuto)\/\d+\/|\/car-for-sale\.html/i, listUrls: (p) => [pageQuery("https://www.japan-partner.com/stocklist.html", p, "page"), pageQuery("https://jpcar.japan-partner.com/stocklist.html", p, "page")] },
  { sourceId: "carused_japan_open", market: "japan", label: "Carused.jp", baseUrl: "https://carused.jp", currency: "USD", detailPattern: /\/car-detail\/|\/car-list\/[^/?]+\/[^/?]+/i, listUrls: (p) => [pageQuery("https://carused.jp/car-list", p), pageQuery("https://carused.jp/car-list/Toyota", p)] },
  { sourceId: "carfromjapan_open", market: "japan", label: "Car From Japan", baseUrl: "https://carfromjapan.com", currency: "USD", detailPattern: /\/cheap-used-[^/?]+-for-sale\/|\/used-car\//i, listUrls: (p) => [pageQuery("https://carfromjapan.com/cheap-used-cars-for-sale", p), pageQuery("https://carfromjapan.com/cheap-used-toyota-for-sale", p)] },
  { sourceId: "cardealpage_japan_open", market: "japan", label: "Car Deal Page", baseUrl: "https://www.cardealpage.com", currency: "USD", detailPattern: /\/used-car\/[^/?]+\/\d+|\/car\/\d+/i, listUrls: (p) => [pageQuery("https://www.cardealpage.com/used-car/", p), pageQuery("https://www.cardealpage.com/used-car/toyota/", p)] },
  { sourceId: "picknbuy24_japan_open", market: "japan", label: "PicknBuy24", baseUrl: "https://www.picknbuy24.com", currency: "USD", detailPattern: /\/detail\/\d+|\/used-car\/[^/?]+/i, listUrls: (p) => [pageQuery("https://www.picknbuy24.com/search/", p), pageQuery("https://www.picknbuy24.com/used-car/", p)] },
  { sourceId: "autocom_japan_open", market: "japan", label: "Autocom Japan", baseUrl: "https://autocomjapan.com", currency: "USD", detailPattern: /\/used-cars\/[^/?]+|\/stock\/\d+/i, listUrls: (p) => [pageQuery("https://autocomjapan.com/used-cars", p), pageQuery("https://autocomjapan.com/used-cars/toyota", p)] },
  { sourceId: "everycar_japan_open", market: "japan", label: "EveryCar Japan", baseUrl: "https://www.everycar.jp", currency: "USD", detailPattern: /\/stock\/\d+|\/vehicle\/\d+/i, listUrls: (p) => [pageQuery("https://www.everycar.jp/stock/", p), pageQuery("https://www.everycar.jp/stock/toyota/", p)] },
  { sourceId: "autorec_japan_open", market: "japan", label: "Autorec Japan", baseUrl: "https://www.autorec.co.jp", currency: "USD", detailPattern: /\/used-cars\/[^/?]+|\/stock\/\d+/i, listUrls: (p) => [pageQuery("https://www.autorec.co.jp/used-cars/", p), pageQuery("https://www.autorec.co.jp/stock/", p)] },
  { sourceId: "nikkyo_japan_open", market: "japan", label: "Nikkyo Japan", baseUrl: "https://www.nikkyo.com", currency: "USD", detailPattern: /\/stock\/[^/?]+|\/vehicle\/[^/?]+/i, listUrls: (p) => [pageQuery("https://www.nikkyo.com/stock/", p), pageQuery("https://www.nikkyo.com/used-cars/", p)] },
  { sourceId: "providecars_japan_open", market: "japan", label: "Provide Cars", baseUrl: "https://www.providecars.com", currency: "JPY", detailPattern: /\/stock\/[^/?]+|\/vehicle\/[^/?]+/i, listUrls: (p) => [pageQuery("https://www.providecars.com/stock", p), pageQuery("https://www.providecars.com/vehicles", p)] },
  { sourceId: "dvm_japan_open", market: "japan", label: "DVM Japan", baseUrl: "https://www.dvmjapan.com", currency: "USD", detailPattern: /\/inventory\/[^/?]+|\/vehicle\/[^/?]+/i, listUrls: (p) => [pageQuery("https://www.dvmjapan.com/inventory", p), pageQuery("https://www.dvmjapan.com/vehicles", p)] },
  { sourceId: "jvsglobal_japan_open", market: "japan", label: "JVS Global", baseUrl: "https://jvsglobal.net", currency: "USD", detailPattern: /\/inventory\/[^/?]+|\/vehicle\/[^/?]+/i, listUrls: (p) => [pageQuery("https://jvsglobal.net/inventory", p), pageQuery("https://jvsglobal.net/vehicles", p)] },
  { sourceId: "buymycar_japan_open", market: "japan", label: "BuyMyCar Japan", baseUrl: "https://buymycar.co.jp", currency: "JPY", detailPattern: /\/stock\/[^/?]+|\/vehicle\/[^/?]+|\/car\/[^/?]+/i, listUrls: (p) => [pageQuery("https://buymycar.co.jp/stock", p), pageQuery("https://buymycar.co.jp/vehicles", p)] },
  { sourceId: "japanese_car_trade_open", market: "japan", label: "Japanese Car Trade", baseUrl: "https://www.japanesecartrade.com", currency: "USD", detailPattern: /\/vehicle\/[^/?]+|\/stock\/[^/?]+|\/used-car\/[^/?]+/i, listUrls: (p) => [pageQuery("https://www.japanesecartrade.com/stock", p), pageQuery("https://www.japanesecartrade.com/used-cars", p)] },
  { sourceId: "royal_trading_japan_open", market: "japan", label: "Royal Trading Japan", baseUrl: "https://www.royal-trading.jp", currency: "USD", detailPattern: /\/stock\/[^/?]+|\/vehicle\/[^/?]+/i, listUrls: (p) => [pageQuery("https://www.royal-trading.jp/stock", p), pageQuery("https://www.royal-trading.jp/vehicles", p)] },
];

const chinaConfigs: OpenMarketSourceConfig[] = [
  { sourceId: "guazi_china_open", market: "china", label: "Guazi China", baseUrl: "https://www.guazi.com", currency: "CNY", forcedCharset: "utf-8", detailPattern: /\/buy\/(?:[^/?]+\/)?\d+|\/detail\/\d+|\/ershouche\/\d+/i, listUrls: (p) => [pageQuery("https://www.guazi.com/buy/", p), pageQuery("https://www.guazi.com/bj/buy/", p)] },
  { sourceId: "taoche_china_open", market: "china", label: "Taoche China", baseUrl: "https://www.taoche.com", currency: "CNY", forcedCharset: "gb18030", detailPattern: /\/buycar\/[^/?]+|\/ershouche\/\d+|\/car\/\d+/i, listUrls: (p) => [pageQuery("https://www.taoche.com/buycar/", p), pageQuery("https://www.taoche.com/beijing/buycar/", p)] },
  { sourceId: "uxin_china_open", market: "china", label: "Uxin China", baseUrl: "https://www.xin.com", currency: "CNY", detailPattern: /\/ershouche\/\d+|\/car\/\d+|\/detail\/\d+/i, listUrls: (p) => [pageQuery("https://www.xin.com/ershouche/", p), pageQuery("https://www.xin.com/beijing/ershouche/", p)] },
  { sourceId: "renrenche_china_open", market: "china", label: "Renrenche China", baseUrl: "https://www.renrenche.com", currency: "CNY", detailPattern: /\/ershouche\/\d+|\/car\/\d+/i, listUrls: (p) => [pageQuery("https://www.renrenche.com/cn/ershouche/", p), pageQuery("https://www.renrenche.com/bj/ershouche/", p)] },
  { sourceId: "dongchedi_china_open", market: "china", label: "Dongchedi Used Cars", baseUrl: "https://www.dongchedi.com", currency: "CNY", detailPattern: /\/usedcar\/\d+|\/auto\/series\/\d+|\/car\/\d+/i, listUrls: (p) => [pageQuery("https://www.dongchedi.com/usedcar", p), pageQuery("https://www.dongchedi.com/auto/library/x-x-x-x-x-x-x-x-x-x-x", p)] },
  { sourceId: "autohome_used_china_open", market: "china", label: "Autohome Used Cars", baseUrl: "https://www.che168.com", currency: "CNY", forcedCharset: "gb18030", detailPattern: /\/dealer\/\d+\/\d+\.html|\/ershouche\/\d+|\/car\/\d+/i, listUrls: (p) => [pageQuery("https://www.che168.com/china/list/", p), `https://www.che168.com/china/a0_0msdgscncgpi1ltocsp${p}exx0/`] },
  { sourceId: "autohome_new_china_open", market: "china", label: "Autohome China", baseUrl: "https://www.autohome.com.cn", currency: "CNY", forcedCharset: "gb18030", detailPattern: /\/spec\/\d+|\/series\/\d+|\/config\/series\/\d+/i, listUrls: (p) => [pageQuery("https://car.autohome.com.cn/price/list-0-0-0-0-0-0-0-0-0-0-0-0-0-0-0-1.html", p), pageQuery("https://www.autohome.com.cn/grade/carhtml/", p)] },
  { sourceId: "58che_china_open", market: "china", label: "58che China", baseUrl: "https://www.58che.com", currency: "CNY", forcedCharset: "gb18030", detailPattern: /\/ershouche\/\d+|\/usedcar\/\d+|\/car\/\d+/i, listUrls: (p) => [pageQuery("https://www.58che.com/ershouche/", p), pageQuery("https://www.58che.com/beijing/ershouche/", p)] },
  { sourceId: "58market_china_open", market: "china", label: "58 Used Cars", baseUrl: "https://www.58.com", currency: "CNY", detailPattern: /\/ershouche\/\d+|\/che\/\d+|\/car\/\d+/i, listUrls: (p) => [pageQuery("https://bj.58.com/ershouche/", p), pageQuery("https://sh.58.com/ershouche/", p)] },
  { sourceId: "ganji_china_open", market: "china", label: "Ganji Used Cars", baseUrl: "https://www.ganji.com", currency: "CNY", forcedCharset: "gb18030", detailPattern: /\/ershouche\/\d+|\/car\/\d+/i, listUrls: (p) => [pageQuery("https://bj.ganji.com/ershouche/", p), pageQuery("https://sh.ganji.com/ershouche/", p)] },
  { sourceId: "273_china_open", market: "china", label: "273 Used Cars", baseUrl: "https://www.273.cn", currency: "CNY", forcedCharset: "gb18030", detailPattern: /\/car\/\d+|\/ershouche\/\d+/i, listUrls: (p) => [pageQuery("https://www.273.cn/usedcar/", p), pageQuery("https://www.273.cn/beijing/usedcar/", p)] },
  { sourceId: "cn2che_china_open", market: "china", label: "China Second Hand Car", baseUrl: "https://www.cn2che.com", currency: "CNY", forcedCharset: "gb18030", detailPattern: /\/ershouche\/\d+|\/car\/\d+|\/detail\/\d+/i, listUrls: (p) => [pageQuery("https://www.cn2che.com/ershouche/", p), pageQuery("https://www.cn2che.com/buycar/", p)] },
  { sourceId: "xcar_china_open", market: "china", label: "XCar Used Cars", baseUrl: "https://www.xcar.com.cn", currency: "CNY", forcedCharset: "gb18030", detailPattern: /\/usedcar\/\d+|\/ershouche\/\d+|\/car\/\d+/i, listUrls: (p) => [pageQuery("https://used.xcar.com.cn/", p), pageQuery("https://www.xcar.com.cn/usedcar/", p)] },
  { sourceId: "yiche_china_open", market: "china", label: "Yiche China", baseUrl: "https://www.yiche.com", currency: "CNY", detailPattern: /\/chexing\/\d+|\/car\/\d+|\/ershouche\/\d+/i, listUrls: (p) => [pageQuery("https://car.yiche.com/", p), pageQuery("https://www.yiche.com/ershouche/", p)] },
  { sourceId: "cheyipai_china_open", market: "china", label: "Cheyipai China", baseUrl: "https://www.cheyipai.com", currency: "CNY", detailPattern: /\/car\/\d+|\/detail\/\d+|\/auction\/\d+/i, listUrls: (p) => [pageQuery("https://www.cheyipai.com/car/", p), pageQuery("https://www.cheyipai.com/auction/", p)] },
  { sourceId: "che300_china_open", market: "china", label: "Che300 China", baseUrl: "https://www.che300.com", currency: "CNY", detailPattern: /\/buycar\/\d+|\/car\/\d+|\/detail\/\d+/i, listUrls: (p) => [pageQuery("https://www.che300.com/buycar/", p), pageQuery("https://www.che300.com/usedcar/", p)] },
  { sourceId: "haoche_china_open", market: "china", label: "Haoche China", baseUrl: "https://www.haoche.cn", currency: "CNY", detailPattern: /\/car\/\d+|\/usedcar\/\d+|\/detail\/\d+/i, listUrls: (p) => [pageQuery("https://www.haoche.cn/usedcar/", p), pageQuery("https://www.haoche.cn/car/", p)] },
  { sourceId: "iautos_china_open", market: "china", label: "iAutos China", baseUrl: "https://www.iautos.cn", currency: "CNY", forcedCharset: "gb18030", detailPattern: /\/usedcar\/\d+|\/car\/\d+|\/detail\/\d+/i, listUrls: (p) => [pageQuery("https://www.iautos.cn/usedcar/", p), pageQuery("https://www.iautos.cn/car/", p)] },
  { sourceId: "sohu_auto_china_open", market: "china", label: "Sohu Auto China", baseUrl: "https://auto.sohu.com", currency: "CNY", detailPattern: /\/usedcar\/\d+|\/model_\d+|\/car\/\d+/i, listUrls: (p) => [pageQuery("https://auto.sohu.com/usedcar/", p), pageQuery("https://db.auto.sohu.com/", p)] },
  { sourceId: "autocango_china_open", market: "china", label: "AutoCango China Export", baseUrl: "https://www.autocango.com", currency: "USD", detailPattern: /\/used-car\/[^/?]+|\/vehicle\/[^/?]+|\/car\/\d+/i, listUrls: (p) => [pageQuery("https://www.autocango.com/used-cars", p), pageQuery("https://www.autocango.com/cars", p)] },
];

const europeConfigs: OpenMarketSourceConfig[] = [
  { sourceId: "autoscout_europe_open", market: "europe", label: "AutoScout24 Europe", baseUrl: "https://www.autoscout24.com", currency: "EUR", detailPattern: /\/offers\//i, listUrls: (p) => [pageQuery("https://www.autoscout24.com/lst?atype=C&ustate=N%2CU", p)] },
  { sourceId: "mobile_de_open", market: "europe", label: "mobile.de", baseUrl: "https://suchen.mobile.de", currency: "EUR", detailPattern: /\/fahrzeuge\/details\.html|\/auto-inserat\//i, listUrls: (p) => [pageQuery("https://suchen.mobile.de/fahrzeuge/search.html?dam=false&isSearchRequest=true&ref=srpHead", p)] },
  { sourceId: "otomoto_pl_open", market: "europe", label: "Otomoto Poland", baseUrl: "https://www.otomoto.pl", currency: "PLN", detailPattern: /\/osobowe\/oferta\//i, listUrls: (p) => [pathPage("https://www.otomoto.pl/osobowe/uzywane", p), pageQuery("https://www.otomoto.pl/osobowe", p)] },
  { sourceId: "lacentrale_fr_open", market: "europe", label: "La Centrale France", baseUrl: "https://www.lacentrale.fr", currency: "EUR", detailPattern: /\/auto-occasion-annonce-|\/fiche-auto\//i, listUrls: (p) => [pageQuery("https://www.lacentrale.fr/listing", p), pageQuery("https://www.lacentrale.fr/occasion-voiture.html", p)] },
  { sourceId: "leboncoin_fr_open", market: "europe", label: "Leboncoin France", baseUrl: "https://www.leboncoin.fr", currency: "EUR", detailPattern: /\/ad\/voitures\/\d+/i, listUrls: (p) => [pageQuery("https://www.leboncoin.fr/recherche?category=2", p)] },
  { sourceId: "subito_it_open", market: "europe", label: "Subito Italy", baseUrl: "https://www.subito.it", currency: "EUR", detailPattern: /\/auto\/[^/?]+-\d+\.htm/i, listUrls: (p) => [pageQuery("https://www.subito.it/annunci-italia/vendita/auto/", p), pageQuery("https://www.subito.it/auto/", p)] },
  { sourceId: "coches_es_open", market: "europe", label: "Coches.net Spain", baseUrl: "https://www.coches.net", currency: "EUR", detailPattern: /\/segunda-mano\/[^/?]+\/\d+|\/ficha\/\d+/i, listUrls: (p) => [pageQuery("https://www.coches.net/segunda-mano/", p), pageQuery("https://www.coches.net/coches-de-segunda-mano/", p)] },
  { sourceId: "standvirtual_pt_open", market: "europe", label: "Standvirtual Portugal", baseUrl: "https://www.standvirtual.com", currency: "EUR", detailPattern: /\/carros\/anuncio\//i, listUrls: (p) => [pageQuery("https://www.standvirtual.com/carros", p), pageQuery("https://www.standvirtual.com/carros/usados", p)] },
  { sourceId: "marktplaats_nl_open", market: "europe", label: "Marktplaats Netherlands", baseUrl: "https://www.marktplaats.nl", currency: "EUR", detailPattern: /\/v\/auto-s\/[^/?]+\/m\d+/i, listUrls: (p) => [pageQuery("https://www.marktplaats.nl/l/auto-s/", p), pageQuery("https://www.marktplaats.nl/l/auto-s/personenauto-s/", p)] },
  { sourceId: "gaspedaal_nl_open", market: "europe", label: "Gaspedaal Netherlands", baseUrl: "https://www.gaspedaal.nl", currency: "EUR", detailPattern: /\/occasion\/[^/?]+|\/auto\/[^/?]+/i, listUrls: (p) => [pageQuery("https://www.gaspedaal.nl/", p), pageQuery("https://www.gaspedaal.nl/occasion", p)] },
  { sourceId: "bilbasen_dk_open", market: "europe", label: "Bilbasen Denmark", baseUrl: "https://www.bilbasen.dk", currency: "DKK", detailPattern: /\/brugt\/bil\/[^/?]+\/\d+/i, listUrls: (p) => [pageQuery("https://www.bilbasen.dk/brugt/bil", p), pageQuery("https://www.bilbasen.dk/brugt/bil?IncludeEngrosCVR=true", p)] },
  { sourceId: "finn_no_open", market: "europe", label: "FINN Norway", baseUrl: "https://www.finn.no", currency: "NOK", detailPattern: /\/mobility\/item\/\d+|\/car\/used\/ad\.html\?finnkode=\d+/i, listUrls: (p) => [pageQuery("https://www.finn.no/mobility/search/car", p), pageQuery("https://www.finn.no/car/used/search.html", p)] },
  { sourceId: "blocket_se_open", market: "europe", label: "Blocket Sweden", baseUrl: "https://www.blocket.se", currency: "SEK", detailPattern: /\/annons\/[^/?]+\/\d+|\/mobility\/item\/\d+/i, listUrls: (p) => [pageQuery("https://www.blocket.se/bilar/sok", p), pageQuery("https://www.blocket.se/mobility/search/car", p)] },
  { sourceId: "bytbil_se_open", market: "europe", label: "Bytbil Sweden", baseUrl: "https://www.bytbil.com", currency: "SEK", detailPattern: /\/bil\/[^/?]+-\d+|\/objekt\/\d+/i, listUrls: (p) => [pageQuery("https://www.bytbil.com/bil", p), pageQuery("https://www.bytbil.com/bilar", p)] },
  { sourceId: "willhaben_at_open", market: "europe", label: "Willhaben Austria", baseUrl: "https://www.willhaben.at", currency: "EUR", detailPattern: /\/iad\/gebrauchtwagen\/d\/auto\/[^/?]+-\d+/i, listUrls: (p) => [pageQuery("https://www.willhaben.at/iad/gebrauchtwagen/auto/gebrauchtwagenboerse", p)] },
  { sourceId: "cargr_open", market: "europe", label: "Car.gr Greece", baseUrl: "https://www.car.gr", currency: "EUR", detailPattern: /\/classifieds\/cars\/view\/\d+|\/cars\/view\/\d+/i, listUrls: (p) => [pageQuery("https://www.car.gr/classifieds/cars/", p), pageQuery("https://www.car.gr/used-cars/", p)] },
  { sourceId: "autotrader_uk_open", market: "europe", label: "Auto Trader UK", baseUrl: "https://www.autotrader.co.uk", currency: "GBP", detailPattern: /\/car-details\/\d+/i, listUrls: (p) => [pageQuery("https://www.autotrader.co.uk/car-search?advertising-location=at_cars&postcode=SW1A1AA", p)] },
  { sourceId: "motors_uk_open", market: "europe", label: "Motors UK", baseUrl: "https://www.motors.co.uk", currency: "GBP", detailPattern: /\/car-\d+|\/used-cars\/[^/?]+\/\d+/i, listUrls: (p) => [pageQuery("https://www.motors.co.uk/used-cars/", p), pageQuery("https://www.motors.co.uk/used-cars/?sort=published-desc", p)] },
  { sourceId: "hasznaltauto_hu_open", market: "europe", label: "Használtautó Hungary", baseUrl: "https://www.hasznaltauto.hu", currency: "HUF", detailPattern: /\/szemelyauto\/[^/?]+\/[^/?]+\/[^/?]+-\d+/i, listUrls: (p) => [pageQuery("https://www.hasznaltauto.hu/szemelyauto", p), pageQuery("https://www.hasznaltauto.hu/talalatilista/", p)] },
  { sourceId: "tipcars_cz_open", market: "europe", label: "TipCars Czechia", baseUrl: "https://www.tipcars.com", currency: "CZK", detailPattern: /\/[^/?]+\/[^/?]+\/[^/?]+-\d+\.html|\/detail\/\d+/i, listUrls: (p) => [pageQuery("https://www.tipcars.com/ojete/", p), pageQuery("https://www.tipcars.com/osobni/", p)] },
  { sourceId: "bazos_cz_open", market: "europe", label: "Bazoš Czechia", baseUrl: "https://auto.bazos.cz", currency: "CZK", detailPattern: /\/inzerat\/\d+\//i, listUrls: (p) => [`https://auto.bazos.cz/${Math.max(0, (p - 1) * 20)}/`] },
];

export const openMarketSources: CatalogSourceAdapter[] = [...japanConfigs, ...chinaConfigs, ...europeConfigs].map((config) => new OpenMarketAdapter(config));
export const OPEN_MARKET_SOURCE_IDS = openMarketSources.map((source) => source.sourceId);
export const OPEN_MARKET_SOURCE_COUNTS = {
  japan: japanConfigs.length,
  china: chinaConfigs.length,
  europe: europeConfigs.length,
};
