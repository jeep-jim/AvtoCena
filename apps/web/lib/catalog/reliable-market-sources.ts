import { cacheImageFromUrl, stableOfferId } from "./storage";
import type { CatalogFetchResult, CatalogImage, CatalogMarket, CatalogSourceAdapter, OfferStatus, VehicleOffer } from "./types";

type SourceRow = {
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
  status?: "active" | "sold";
};

type SourceConfig = {
  sourceId: string;
  market: CatalogMarket;
  label: string;
  baseUrl: string;
  currency: string;
  urls: (page: number) => string[];
  detailPattern: RegExp;
  forcedCharset?: string;
  referer?: string;
};

const HEADERS = {
  accept: "text/html,application/xhtml+xml,application/json;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9,ru;q=0.8,zh-CN;q=0.7,ja;q=0.6",
  "cache-control": "no-cache",
  pragma: "no-cache",
  "upgrade-insecure-requests": "1",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
};

const KNOWN_MAKES = [
  "Mercedes-Benz", "Mercedes Benz", "Land Rover", "Range Rover", "Rolls-Royce", "Rolls Royce", "Alfa Romeo", "Aston Martin",
  "Great Wall", "Li Auto", "Toyota", "Lexus", "Nissan", "Infiniti", "Honda", "Mazda", "Mitsubishi", "Subaru", "Suzuki",
  "Hyundai", "Genesis", "Kia", "KGM", "SsangYong", "BMW", "Audi", "Volkswagen", "Volvo", "Porsche", "Ford", "Chevrolet",
  "Cadillac", "Jeep", "Dodge", "Renault", "Peugeot", "Citroen", "Skoda", "SEAT", "MINI", "BYD", "Geely", "Changan", "Chery",
  "GAC", "Haval", "Zeekr", "Nio", "XPeng", "Jetour", "Denza", "Rox", "Opel", "Fiat", "Tesla",
];

const CHINESE_MAKES: Array<[RegExp, string]> = [
  [/雷克萨斯/g, "Lexus"], [/梅赛德斯[-·]?奔驰|奔驰/g, "Mercedes-Benz"], [/宝马/g, "BMW"], [/奥迪/g, "Audi"], [/大众/g, "Volkswagen"],
  [/丰田/g, "Toyota"], [/本田/g, "Honda"], [/日产/g, "Nissan"], [/马自达/g, "Mazda"], [/三菱/g, "Mitsubishi"], [/斯巴鲁/g, "Subaru"],
  [/现代/g, "Hyundai"], [/起亚/g, "Kia"], [/捷尼赛思/g, "Genesis"], [/沃尔沃/g, "Volvo"], [/保时捷/g, "Porsche"], [/福特/g, "Ford"],
  [/雪佛兰/g, "Chevrolet"], [/凯迪拉克/g, "Cadillac"], [/路虎/g, "Land Rover"], [/特斯拉/g, "Tesla"], [/比亚迪/g, "BYD"],
  [/吉利/g, "Geely"], [/长安/g, "Changan"], [/奇瑞/g, "Chery"], [/哈弗/g, "Haval"], [/广汽/g, "GAC"], [/理想/g, "Li Auto"],
  [/蔚来/g, "Nio"], [/小鹏/g, "XPeng"], [/极氪/g, "Zeekr"], [/捷途/g, "Jetour"], [/腾势/g, "Denza"],
];

function decodeEntities(value: string) {
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

function cleanText(value: string) {
  return decodeEntities(value)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/[\u0000-\u001f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeChinese(value: string) {
  let result = value;
  for (const [pattern, replacement] of CHINESE_MAKES) result = result.replace(pattern, replacement);
  return result.replace(/二手车|准新车|新车|在售|报价|图片|详情/g, " ").replace(/\s+/g, " ").trim();
}

function isBrokenText(value: string) {
  if (!value || value.length < 3) return true;
  const broken = (value.match(/[�□]/g) || []).length;
  const questions = (value.match(/\?{2,}|\uFFFD/g) || []).length;
  return broken > 0 || questions > 0 || /(?:Ã.|Â.|Ð.|Ñ.){2,}/.test(value);
}

function absoluteUrl(value: string, baseUrl: string) {
  if (!value || /^(?:data:|javascript:|mailto:|tel:)/i.test(value)) return "";
  try {
    return new URL(decodeEntities(value).replace(/\\\//g, "/"), baseUrl).toString();
  } catch {
    return "";
  }
}

function validImage(url: string) {
  if (!/^https?:/i.test(url)) return false;
  if (!/\.(?:jpe?g|webp|avif|png)(?:[?#]|$)/i.test(url)) return false;
  if (/logo|favicon|icon|sprite|banner|placeholder|avatar|tracking|pixel|cookie|qrcode|qr-code|qr_|weixin|wechat|scan|download[-_]?app|appstore|googleplay|watermark\.png/i.test(url)) return false;
  return true;
}

function collectImages(markup: string, baseUrl: string) {
  const result: string[] = [];
  for (const match of markup.matchAll(/<(?:img|source)[^>]+(?:data-original|data-lazy-src|data-src|src)\s*=\s*["']([^"']+)["']/gi)) result.push(match[1]);
  for (const match of markup.matchAll(/(?:data-srcset|srcset)\s*=\s*["']([^"']+)["']/gi)) {
    for (const part of match[1].split(",")) result.push(part.trim().split(/\s+/)[0]);
  }
  for (const match of markup.matchAll(/https?:\\?\/\\?\/[^"'\\\s<>]+?\.(?:jpe?g|webp|avif|png)(?:\?[^"'\\\s<>]*)?/gi)) result.push(match[0].replace(/\\\//g, "/"));
  return [...new Set(result.map((item) => absoluteUrl(item, baseUrl)).filter(validImage))];
}

function number(value: string | undefined) {
  if (!value) return undefined;
  const parsed = Number(value.replace(/[^0-9.]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function integer(value: string | undefined) {
  if (!value) return undefined;
  const parsed = Number(value.replace(/[^0-9]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function mileage(text: string) {
  const tenThousands = text.match(/([0-9]+(?:[.,][0-9]+)?)\s*万\s*(?:公里|km)?/i);
  if (tenThousands) return Math.round(Number(tenThousands[1].replace(",", ".")) * 10_000);
  const match = text.match(/([0-9]{1,3}(?:[ ,.'][0-9]{3})+|[0-9]{2,7})\s*(?:km|公里|キロ)/i);
  return integer(match?.[1]);
}

function deriveMakeModel(rawTitle: string) {
  const title = normalizeChinese(rawTitle)
    .replace(/^(?:used|new|gebraucht|neu|premium|promoted|featured)\s+/i, "")
    .replace(/^(?:19|20)\d{2}\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
  const lower = title.toLocaleLowerCase("en-US");
  const make = KNOWN_MAKES.find((item) => lower === item.toLocaleLowerCase("en-US") || lower.startsWith(`${item.toLocaleLowerCase("en-US")} `));
  if (make) {
    const normalizedMake = make === "Mercedes Benz" ? "Mercedes-Benz" : make === "Rolls Royce" ? "Rolls-Royce" : make;
    const rest = title.slice(make.length).trim().replace(/^(?:[-–—·|])+/, "").trim();
    return { title, make: normalizedMake, model: rest.split(/\s+/).slice(0, 5).join(" ") || normalizedMake };
  }
  const parts = title.split(/\s+/).filter(Boolean);
  return { title, make: parts[0] || "", model: parts.slice(1, 6).join(" ") || parts[0] || "" };
}

function detectPrice(text: string, fallbackCurrency: string) {
  const wan = text.match(/(?:￥|¥|RMB|CNY)?\s*([0-9]+(?:[.,][0-9]+)?)\s*万(?:元)?/i);
  if (wan) return { price: Math.round(Number(wan[1].replace(",", ".")) * 10_000), currency: "CNY" };
  const patterns: Array<[RegExp, string]> = [
    [/(?:AED|د\.?إ\.?)\s*([0-9][0-9 ,.']{2,})/i, "AED"],
    [/(?:USD|US\$|\$)\s*([0-9][0-9 ,.']{2,})/i, "USD"],
    [/(?:EUR|€)\s*([0-9][0-9 ,.']{2,})/i, "EUR"],
    [/(?:JPY|JP¥|円|¥)\s*([0-9][0-9 ,.']{2,})/i, "JPY"],
    [/(?:CNY|RMB|CN¥|￥)\s*([0-9][0-9 ,.']{2,})/i, "CNY"],
    [/([0-9][0-9 ,.']{2,})\s*(?:AED|USD|EUR|JPY|円|CNY|RMB)/i, fallbackCurrency],
  ];
  for (const [pattern, currency] of patterns) {
    const value = integer(text.match(pattern)?.[1]);
    if (value) return { price: value, currency };
  }
  return { price: undefined, currency: fallbackCurrency };
}

function detectBody(text: string) {
  return text.match(/\b(SUV\/Crossover|SUV|Crossover|Sedan|Saloon|Hatchback|Coupe|Convertible|Cabrio|Pickup|Pick Up Truck|Wagon|Estate|Kombi|Minivan|Van|Bus|Truck|Liftback)\b/i)?.[1]
    || text.match(/(轿车|跑车|两厢|三厢|旅行车|越野车|SUV|MPV|皮卡)/i)?.[1]
    || "";
}

function detectFuel(text: string) {
  return text.match(/\b(Petrol|Gasoline|Diesel|Hybrid|Electric|EV|PHEV|LPG|Benzin|Elektro)\b/i)?.[1]
    || text.match(/(汽油|柴油|混合动力|纯电|增程)/)?.[1]
    || "";
}

function detectTransmission(text: string) {
  return text.match(/\b(Automatic|Manual|CVT|DCT|AT|MT|Automatik|Schaltgetriebe)\b/i)?.[1]
    || text.match(/(自动|手动|无级变速|双离合)/)?.[1]
    || "";
}

function detectDrive(text: string) {
  return text.match(/\b(AWD|4WD|2WD|FWD|RWD|Allrad|Frontantrieb|Heckantrieb)\b/i)?.[1]
    || text.match(/(四驱|前驱|后驱|两驱)/)?.[1]
    || "";
}

function anchors(markup: string, config: SourceConfig) {
  return [...markup.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .map((match) => ({ href: absoluteUrl(match[1], config.baseUrl), inner: match[2], index: match.index || 0 }))
    .filter((item) => item.href && config.detailPattern.test(new URL(item.href).pathname));
}

function titleFromCard(inner: string, card: string) {
  const candidates = [
    cleanText(inner),
    decodeEntities(card.match(/<img[^>]+alt\s*=\s*["']([^"']+)["']/i)?.[1] || ""),
    cleanText(card.match(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/i)?.[1] || ""),
    decodeEntities(card.match(/(?:aria-label|title)\s*=\s*["']([^"']+)["']/i)?.[1] || ""),
  ].map((item) => item.replace(/\s+/g, " ").trim());
  return candidates.find((item) => item.length >= 4 && item.length <= 240 && !/^(?:details?|view|save|call|whatsapp|image|loading|next|previous|zum angebot)$/i.test(item)) || "";
}

function rowsFromHtml(markup: string, config: SourceConfig) {
  const links = anchors(markup, config);
  const rows: SourceRow[] = [];
  const seen = new Set<string>();
  links.forEach((anchor, index) => {
    if (seen.has(anchor.href)) return;
    const previous = index > 0 ? links[index - 1].index : 0;
    const next = index + 1 < links.length ? links[index + 1].index : markup.length;
    const card = markup.slice(Math.max(previous, anchor.index - 4_500), Math.min(next + 2_500, anchor.index + 14_000));
    const plain = cleanText(card);
    const rawTitle = titleFromCard(anchor.inner, card);
    const derived = deriveMakeModel(rawTitle);
    const year = Number((`${derived.title} ${plain}`).match(/\b(?:19|20)\d{2}\b/)?.[0]);
    if (!year || !derived.make || !derived.model || isBrokenText(derived.title)) return;
    const amount = detectPrice(plain, config.currency);
    const liters = plain.match(/\b([0-9]+(?:[.,][0-9]+)?)\s*(?:L|リッター)\b/i);
    const cc = plain.match(/\b([0-9][0-9 ,.']{2,5})\s*(?:cc|cm3|cm³|куб\.см)/i);
    const power = plain.match(/\b([0-9]{2,4})\s*(?:HP|PS|л\.с\.)\b/i);
    const id = anchor.href.match(/(?:-|\/)(\d{5,})(?:\.html|[/?#]|$)/i)?.[1] || stableOfferId(config.sourceId, anchor.href);
    const images = collectImages(card, config.baseUrl);
    seen.add(anchor.href);
    rows.push({
      id,
      title: derived.title,
      make: derived.make,
      model: derived.model,
      year,
      mileageKm: mileage(plain),
      engineCc: cc ? integer(cc[1]) : liters ? Math.round(Number(liters[1].replace(",", ".")) * 1_000) : undefined,
      powerHp: integer(power?.[1]),
      fuel: detectFuel(plain),
      transmission: detectTransmission(plain),
      drive: detectDrive(plain),
      bodyType: detectBody(plain),
      price: amount.price,
      currency: amount.currency,
      images,
      detailUrl: anchor.href,
      location: plain.match(/\b(Dubai|Abu Dhabi|Sharjah|Ajman|Fujairah|Al Ain|Germany|Deutschland|France|Italy|Spain|Netherlands|Japan|Tokyo|Osaka|Nagoya|China|Beijing|Shanghai|Guangzhou|Shenzhen)\b/i)?.[1],
      status: /\b(?:sold|unavailable|reserved|verkauft|продан)\b/i.test(plain) ? "sold" : "active",
    });
  });
  return rows;
}

function parseEmbeddedRows(markup: string, config: SourceConfig) {
  const result: SourceRow[] = [];
  const visit = (value: any, depth = 0) => {
    if (value == null || depth > 10) return;
    if (Array.isArray(value)) return value.forEach((item) => visit(item, depth + 1));
    if (typeof value !== "object") return;
    const titleValue = String(value.name || value.title || value.vehicleName || value.carName || value.productName || "").trim();
    const url = absoluteUrl(String(value.url || value.detailUrl || value.link || value.href || ""), config.baseUrl);
    const year = Number(String(value.vehicleModelDate || value.modelYear || value.year || titleValue).match(/(?:19|20)\d{2}/)?.[0]);
    if (titleValue && year && url && config.detailPattern.test(new URL(url).pathname)) {
      const derived = deriveMakeModel(titleValue);
      const images = collectImages(JSON.stringify(value), config.baseUrl);
      const amount = detectPrice(JSON.stringify(value), config.currency);
      if (derived.make && derived.model && !isBrokenText(derived.title)) result.push({
        id: String(value.sku || value.productID || value.vehicleId || value.id || url.match(/\d{5,}/)?.[0] || stableOfferId(config.sourceId, url)),
        title: derived.title,
        make: derived.make,
        model: derived.model,
        year,
        mileageKm: mileage(JSON.stringify(value)),
        fuel: String(value.fuelType || value.fuel || ""),
        transmission: String(value.vehicleTransmission || value.transmission || ""),
        bodyType: String(value.bodyType || value.vehicleConfiguration || ""),
        price: amount.price,
        currency: String(value.priceCurrency || amount.currency || config.currency),
        images,
        detailUrl: url,
        status: /sold|unavailable|reserved/i.test(String(value.availability || value.status || "")) ? "sold" : "active",
      });
    }
    Object.values(value).forEach((item) => visit(item, depth + 1));
  };
  for (const match of markup.matchAll(/<script[^>]*(?:type=["'](?:application\/ld\+json|application\/json)["']|id=["']__NEXT_DATA__["'])[^>]*>([\s\S]*?)<\/script>/gi)) {
    try { visit(JSON.parse(match[1].trim())); } catch { /* ignore malformed embedded JSON */ }
  }
  return result;
}

function parseRows(markup: string, config: SourceConfig) {
  const unique = new Map<string, SourceRow>();
  for (const row of [...parseEmbeddedRows(markup, config), ...rowsFromHtml(markup, config)]) {
    const previous = unique.get(row.id);
    if (!previous || row.images.length > previous.images.length || (!previous.price && row.price)) unique.set(row.id, row);
  }
  return [...unique.values()].filter((row) => row.year >= 1990 && row.year <= new Date().getFullYear() + 1 && !isBrokenText(row.title));
}

async function decodedResponse(response: Response, forcedCharset?: string) {
  const bytes = await response.arrayBuffer();
  const declared = response.headers.get("content-type")?.match(/charset=([^;\s]+)/i)?.[1]?.replace(/["']/g, "");
  const utf8 = new TextDecoder("utf-8").decode(bytes);
  const brokenRatio = (utf8.match(/�/g) || []).length / Math.max(1, utf8.length);
  const charset = forcedCharset || declared || (brokenRatio > 0.0005 ? "gb18030" : "utf-8");
  try { return new TextDecoder(charset).decode(bytes); } catch { return utf8; }
}

class ReliableMarketAdapter implements CatalogSourceAdapter {
  sourceId: string;
  market: CatalogMarket;
  accessMode = "public_html" as const;
  private config: SourceConfig;

  constructor(config: SourceConfig) {
    this.sourceId = config.sourceId;
    this.market = config.market;
    this.config = config;
  }

  private headers(referer?: string) {
    return { ...HEADERS, referer: referer || this.config.referer || `${this.config.baseUrl}/` };
  }

  private async request(url: string) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Number(process.env.CATALOG_SOURCE_TIMEOUT_MS || 30_000));
    try {
      const response = await fetch(url, { headers: this.headers(), redirect: "follow", signal: controller.signal });
      const html = await decodedResponse(response, this.config.forcedCharset);
      return { response, html };
    } finally {
      clearTimeout(timer);
    }
  }

  async fetchPage(cursor?: string | null): Promise<CatalogFetchResult> {
    const page = Math.max(1, Number(cursor || 1));
    let lastStatus = 0;
    let lastBytes = 0;
    for (const url of this.config.urls(page)) {
      const result = await this.request(url).catch(() => null);
      if (!result) continue;
      lastStatus = result.response.status;
      lastBytes = result.html.length;
      if (!result.response.ok) continue;
      const items = parseRows(result.html, this.config);
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

  mapStatus(raw: unknown): OfferStatus {
    return (raw as SourceRow).status === "sold" ? "sold" : "active";
  }

  normalizeOffer(raw: unknown): VehicleOffer | null {
    const row = raw as SourceRow;
    if (!row.id || !row.make || !row.model || !row.year || isBrokenText(row.title)) return null;
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
    const row = (offer.operational.raw || {}) as SourceRow;
    const limit = Math.max(1, Number(process.env.CATALOG_MAX_IMAGES_PER_OFFER || 10));
    let urls = [...(row.images || [])];
    if (row.detailUrl && urls.length < limit) {
      const detail = await this.request(row.detailUrl).catch(() => null);
      if (detail?.response.ok) urls = [...urls, ...collectImages(detail.html, this.config.baseUrl)];
    }
    const cached: CatalogImage[] = [];
    for (const url of [...new Set(urls.filter(validImage))].slice(0, limit)) {
      const image = await cacheImageFromUrl(url, offer.market, { headers: this.headers(row.detailUrl) }).catch(() => null);
      if (image && image.width !== 1 && image.height !== 1 && image.size > 8_000) cached.push(image);
    }
    return cached;
  }

  async healthCheck() {
    return { ok: true, message: `${this.config.label}: checked during import`, checkedAt: new Date().toISOString() };
  }
}

const gooMakes = ["TOYOTA", "NISSAN", "HONDA", "MAZDA", "MITSUBISHI", "SUBARU", "SUZUKI", "DAIHATSU", "LEXUS", "BMW", "MERCEDES_BENZ", "VOLKSWAGEN"];

export const reliableMarketSources: CatalogSourceAdapter[] = [
  new ReliableMarketAdapter({
    sourceId: "goonet_japan",
    market: "japan",
    label: "Goo-net Exchange Japan",
    baseUrl: "https://www.goo-net-exchange.com",
    currency: "USD",
    detailPattern: /\/usedcars\/(?:detail\/|[^?#]*\d{6,})/i,
    referer: "https://www.goo-net-exchange.com/usedcars/",
    urls: (page) => {
      const make = gooMakes[(page - 1) % gooMakes.length];
      const makePage = Math.floor((page - 1) / gooMakes.length) + 1;
      return [
        `https://www.goo-net-exchange.com/usedcars/${make}/index-${makePage}.html`,
        `https://www.goo-net-exchange.com/usedcars/${make}/?page=${makePage}`,
        `https://www.goo-net-exchange.com/usedcars/${make}/`,
      ];
    },
  }),
  new ReliableMarketAdapter({
    sourceId: "che168_clean",
    market: "china",
    label: "Che168 China clean",
    baseUrl: "https://www.che168.com",
    currency: "CNY",
    forcedCharset: "gb18030",
    detailPattern: /\/(?:dealer|ershouche|usedcar|car|detail|spec)\/|\/\d{6,}\.html/i,
    referer: "https://www.che168.com/china/",
    urls: (page) => [
      `https://www.che168.com/china/list/?page=${page}`,
      `https://www.che168.com/china/?page=${page}`,
      `https://www.che168.com/china/a0_0msdgscncgpi1ltocsp${page}exx0/`,
    ],
  }),
  new ReliableMarketAdapter({
    sourceId: "dubicars_clean",
    market: "uae",
    label: "DubiCars UAE clean",
    baseUrl: "https://www.dubicars.com",
    currency: "AED",
    detailPattern: /\/[^/?#]+-\d{5,}\.html$/i,
    referer: "https://www.dubicars.com/uae/used",
    urls: (page) => [
      `https://www.dubicars.com/uae/used?page=${page}`,
      `https://www.dubicars.com/uae/used/toyota?page=${page}`,
      `https://www.dubicars.com/uae/used/nissan?page=${page}`,
    ],
  }),
  new ReliableMarketAdapter({
    sourceId: "autouncle_europe",
    market: "europe",
    label: "AutoUncle Europe",
    baseUrl: "https://www.autouncle.de",
    currency: "EUR",
    detailPattern: /\/de\/d\/\d+/i,
    referer: "https://www.autouncle.de/de/gebrauchtwagen",
    urls: (page) => [
      `https://www.autouncle.de/de/gebrauchtwagen?page=${page}`,
      `https://www.autouncle.de/de/gebrauchtwagen?search%5Border%5D=listing_date_desc&page=${page}`,
    ],
  }),
];

export const RELIABLE_MARKET_SOURCE_IDS = reliableMarketSources.map((source) => source.sourceId);
