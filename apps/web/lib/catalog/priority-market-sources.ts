import { cacheImageFromUrl, stableOfferId } from "./storage";
import type { CatalogFetchResult, CatalogImage, CatalogMarket, CatalogSourceAdapter, OfferStatus, VehicleOffer } from "./types";

const HEADERS = {
  accept: "text/html,application/xhtml+xml,application/json;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9,zh-CN;q=0.8,ja;q=0.7,ru;q=0.6",
  "cache-control": "no-cache",
  pragma: "no-cache",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
};

const COMMERCIAL_RE = /\b(?:truck|dump|tipper|bus|minibus|kei\s*truck|commercial|cargo|lorry|tractor|forklift|excavator|machinery|canter|fighter|ranger|dutro|forward|giga|elf|profia)\b|(?:货车|卡车|客车|巴士|工程机械|商用车)/i;
const BAD_IMAGE_RE = /logo|favicon|icon|sprite|banner|placeholder|avatar|tracking|pixel|cookie|qrcode|qr-code|no[-_ ]?photo|no[-_ ]?image|app-code|wechat|footer|header/i;

const CHINESE_MAKES: Array<[RegExp, string]> = [
  [/^梅赛德斯[-·]?奔驰|^奔驰/, "Mercedes-Benz"], [/^宝马/, "BMW"], [/^奥迪/, "Audi"], [/^丰田/, "Toyota"], [/^本田/, "Honda"],
  [/^日产/, "Nissan"], [/^马自达/, "Mazda"], [/^三菱/, "Mitsubishi"], [/^斯巴鲁/, "Subaru"], [/^北京现代|^现代/, "Hyundai"],
  [/^起亚/, "Kia"], [/^雷克萨斯/, "Lexus"], [/^沃尔沃/, "Volvo"], [/^大众/, "Volkswagen"], [/^保时捷/, "Porsche"],
  [/^路虎/, "Land Rover"], [/^特斯拉/, "Tesla"], [/^比亚迪/, "BYD"], [/^吉利汽车|^吉利/, "Geely"], [/^长安汽车|^长安/, "Changan"],
  [/^奇瑞汽车|^奇瑞/, "Chery"], [/^哈弗/, "Haval"], [/^广汽传祺|^广汽/, "GAC"], [/^理想汽车|^理想/, "Li Auto"], [/^蔚来/, "Nio"],
  [/^小鹏/, "XPeng"], [/^极氪/, "Zeekr"], [/^捷途/, "Jetour"], [/^腾势/, "Denza"], [/^坦克/, "Tank"], [/^岚图/, "Voyah"],
  [/^问界/, "Aito"], [/^零跑汽车|^零跑/, "Leapmotor"], [/^极狐/, "Arcfox"], [/^哪吒/, "Neta"], [/^五菱汽车|^五菱/, "Wuling"],
  [/^红旗/, "Hongqi"], [/^别克/, "Buick"], [/^凯迪拉克/, "Cadillac"], [/^福特/, "Ford"], [/^雪佛兰/, "Chevrolet"],
  [/^斯柯达/, "Skoda"], [/^荣威/, "Roewe"], [/^星途/, "Exeed"], [/^东风/, "Dongfeng"], [/^传祺/, "GAC"],
];

const CHINESE_MODELS: Record<string, string> = {
  "雷凌": "Levin", "森林人": "Forester", "几何C": "Geometry C", "朗逸": "Lavida", "凯美瑞": "Camry", "卡罗拉": "Corolla",
  "宏光MINIEV": "Hongguang MINIEV", "五菱缤果": "Bingo", "缤果": "Bingo", "远景X6": "Vision X6", "帝豪": "Emgrand",
  "帕萨特": "Passat", "飞度": "Fit", "缤智": "Vezel", "科鲁泽": "Monza", "豪越L": "Haoyue L", "传祺M8": "M8",
};

type PriorityRow = {
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
};

type PrioritySourceConfig = {
  sourceId: string;
  market: CatalogMarket;
  label: string;
  baseUrl: string;
  currency: string;
  listUrl(page: number): string;
  detailPattern: RegExp;
  parse(markup: string, pageUrl: string): PriorityRow[];
  galleryScope?(markup: string): string;
  imageHost?: RegExp;
};

function decodeHtml(value: string) {
  return String(value || "")
    .replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&#x2F;/gi, "/")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function plainText(value: string) {
  return decodeHtml(value).replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/[\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim();
}

function absoluteUrl(value: string, baseUrl: string) {
  if (!value || /^(?:data:|javascript:|mailto:|tel:)/i.test(value)) return "";
  try { return new URL(value.replace(/\\\//g, "/"), baseUrl).toString(); } catch { return ""; }
}

function number(value: string | undefined) {
  const parsed = Number(String(value || "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function integer(value: string | undefined) {
  const parsed = Number(String(value || "").replace(/[^0-9]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : undefined;
}

function pageAnchors(markup: string, pageUrl: string, detailPattern: RegExp) {
  const matches = [...markup.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
  return matches.map((match) => ({
    href: absoluteUrl(match[1], pageUrl),
    inner: match[2],
    index: match.index || 0,
  })).filter((row) => {
    try { const url = new URL(row.href); return detailPattern.test(`${url.pathname}${url.search}`); } catch { return false; }
  });
}

function cardWindow(markup: string, anchors: ReturnType<typeof pageAnchors>, index: number) {
  const anchor = anchors[index];
  const previous = index > 0 ? anchors[index - 1].index : Math.max(0, anchor.index - 2_000);
  const next = index + 1 < anchors.length ? anchors[index + 1].index : Math.min(markup.length, anchor.index + 16_000);
  return markup.slice(Math.max(previous, anchor.index - 5_000), Math.min(next + 2_000, anchor.index + 18_000));
}

function imageUrls(markup: string, baseUrl: string, host?: RegExp) {
  const candidates: string[] = [];
  for (const match of markup.matchAll(/<(?:img|source)[^>]+(?:data-original|data-lazy-src|data-src|src)\s*=\s*["']([^"']+)["']/gi)) candidates.push(match[1]);
  for (const match of markup.matchAll(/(?:data-srcset|srcset)\s*=\s*["']([^"']+)["']/gi)) match[1].split(",").forEach((item) => candidates.push(item.trim().split(/\s+/)[0]));
  for (const match of markup.matchAll(/https?:\\?\/\\?\/[^"'\\\s<>]+?\.(?:jpe?g|png|webp|avif)(?:\?[^"'\\\s<>]*)?/gi)) candidates.push(match[0].replace(/\\\//g, "/"));
  return [...new Set(candidates.map((url) => absoluteUrl(url, baseUrl)).filter((url) => /^https?:/i.test(url) && !BAD_IMAGE_RE.test(url) && (!host || host.test(url))))];
}

function englishTitle(value: string) {
  return value.split(/[-_\s]+/).filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function commercial(title: string, make = "", model = "") {
  return COMMERCIAL_RE.test(`${title} ${make} ${model}`) || /^(?:Hino|Mitsubishi Fuso)$/i.test(make);
}

function parseGuazi(markup: string, pageUrl: string) {
  const detailPattern = /\/car-detail\/c\d+\.html/i;
  const anchors = pageAnchors(markup, pageUrl, detailPattern);
  const rows: PriorityRow[] = [];
  const seen = new Set<string>();
  anchors.forEach((anchor, index) => {
    if (seen.has(anchor.href)) return;
    const card = cardWindow(markup, anchors, index);
    const text = plainText(anchor.inner).length > 20 ? plainText(anchor.inner) : plainText(card);
    const year = Number(text.match(/\b(20\d{2}|19\d{2})年/)?.[1]);
    const makeMatch = CHINESE_MAKES.find(([pattern]) => pattern.test(text));
    if (!year || !makeMatch) return;
    const [makePattern, make] = makeMatch;
    const remainder = text.replace(makePattern, "").replace(/^\s+/, "");
    const rawModel = (remainder.match(/^(.+?)(?=\s+(?:19|20)\d{2}款|\s+(?:19|20)\d{2}年|\s*\|)/)?.[1] || remainder.split(/\s+/)[0] || "").trim();
    const model = CHINESE_MODELS[rawModel] || rawModel;
    if (!model || commercial(text, make, model)) return;
    const priceWan = text.match(/(?:^|\s)(\d+(?:\.\d+)?)\s*万(?:元)?/);
    const mileageWan = text.match(/(\d+(?:\.\d+)?)\s*万公里/);
    const id = anchor.href.match(/\/car-detail\/(c\d+)\.html/i)?.[1] || stableOfferId("guazi_china_open", anchor.href);
    seen.add(anchor.href);
    rows.push({
      id,
      title: text.slice(0, 260),
      make,
      model,
      year,
      mileageKm: mileageWan ? Math.round(Number(mileageWan[1]) * 10_000) : undefined,
      engineCc: number(text.match(/(\d+(?:\.\d+)?)L/)?.[1]) ? Math.round(Number(text.match(/(\d+(?:\.\d+)?)L/)?.[1]) * 1_000) : undefined,
      fuel: /纯电/.test(text) ? "Electric" : /插电混动/.test(text) ? "PHEV" : /混动|双擎/.test(text) ? "Hybrid" : /柴油/.test(text) ? "Diesel" : "Petrol",
      transmission: /手动/.test(text) ? "Manual" : /CVT/i.test(text) ? "CVT" : /DCT|双离合/i.test(text) ? "DCT" : "Automatic",
      drive: /四驱/.test(text) ? "4WD" : /后驱/.test(text) ? "RWD" : /前驱|两驱/.test(text) ? "2WD" : undefined,
      price: priceWan ? Math.round(Number(priceWan[1]) * 10_000) : undefined,
      currency: "CNY",
      images: imageUrls(card, pageUrl, /guazi|guazistatic/i),
      detailUrl: anchor.href,
      location: text.match(/\|\s*([^|\s]{2,12})\s*(?:已检测|高保值|纯电动|\d)/)?.[1],
    });
  });
  return rows;
}

function parseCarused(markup: string, pageUrl: string) {
  const detailPattern = /\/car-list\/detail\/[^/?]+\/[^/?]+\/[^/?]+\/[^/?]+/i;
  const anchors = pageAnchors(markup, pageUrl, detailPattern);
  const rows: PriorityRow[] = [];
  const seen = new Set<string>();
  anchors.forEach((anchor, index) => {
    if (seen.has(anchor.href)) return;
    const url = new URL(anchor.href);
    const parts = url.pathname.split("/").filter(Boolean);
    const detailIndex = parts.indexOf("detail");
    if (detailIndex < 0 || parts.length < detailIndex + 5) return;
    const make = englishTitle(decodeURIComponent(parts[detailIndex + 1]));
    const model = englishTitle(decodeURIComponent(parts[detailIndex + 2]));
    const card = cardWindow(markup, anchors, index);
    const text = plainText(anchor.inner).length > 20 ? plainText(anchor.inner) : plainText(card);
    const year = Number(text.match(/\b(19\d{2}|20\d{2})\b/)?.[1]);
    if (!year || commercial(text, make, model)) return;
    const id = parts.at(-1) || stableOfferId("carused_japan_open", anchor.href);
    const price = integer(text.match(/(?:US\$|USD|\$)\s*([0-9][0-9, ]+)/i)?.[1]);
    seen.add(anchor.href);
    rows.push({
      id,
      title: text.slice(0, 260),
      make,
      model,
      year,
      mileageKm: integer(text.match(/([0-9][0-9, ]+)\s*km/i)?.[1]),
      engineCc: integer(text.match(/([0-9][0-9, ]+)\s*cc/i)?.[1]),
      fuel: /diesel/i.test(text) ? "Diesel" : /hybrid/i.test(text) ? "Hybrid" : /electric|\bEV\b/i.test(text) ? "Electric" : "Petrol",
      transmission: text.match(/\b(CVT|DCT|AT|MT|Automatic|Manual)\b/i)?.[1],
      drive: text.match(/\b(4WD|AWD|2WD|FWD|RWD)\b/i)?.[1],
      price,
      currency: "USD",
      images: imageUrls(card, pageUrl, /carused|carpaydiem|cloudfront/i),
      detailUrl: anchor.href,
      location: "Japan",
    });
  });
  return rows;
}

function parseTcv(markup: string, pageUrl: string) {
  const detailPattern = /\/used_car\/[^/?]+\/[^/?]+\/\d+\/?/i;
  const anchors = pageAnchors(markup, pageUrl, detailPattern);
  const rows: PriorityRow[] = [];
  const seen = new Set<string>();
  anchors.forEach((anchor, index) => {
    if (seen.has(anchor.href)) return;
    const url = new URL(anchor.href);
    const parts = url.pathname.split("/").filter(Boolean);
    const usedIndex = parts.indexOf("used_car");
    if (usedIndex < 0 || parts.length < usedIndex + 4) return;
    const make = englishTitle(decodeURIComponent(parts[usedIndex + 1]));
    const model = englishTitle(decodeURIComponent(parts[usedIndex + 2]));
    const card = cardWindow(markup, anchors, index);
    const text = plainText(card);
    const year = Number(text.match(/\b(19\d{2}|20\d{2})(?:\/\d{1,2})?\b/)?.[1]);
    if (!year || commercial(text, make, model)) return;
    const id = parts[usedIndex + 3] || stableOfferId("tcv_japan_open", anchor.href);
    seen.add(anchor.href);
    rows.push({
      id,
      title: plainText(anchor.inner).slice(0, 260) || `${year} ${make} ${model}`,
      make,
      model,
      year,
      mileageKm: integer(text.match(/Mileage\s*([0-9][0-9, ]+)\s*km/i)?.[1] || text.match(/([0-9][0-9, ]+)\s*km/i)?.[1]),
      engineCc: integer(text.match(/Engine Capacity\s*([0-9][0-9, ]+)\s*cc/i)?.[1] || text.match(/([0-9][0-9, ]+)\s*cc/i)?.[1]),
      fuel: text.match(/\b(Gasoline|Petrol|Diesel|Hybrid|Electric|EV)\b/i)?.[1],
      transmission: text.match(/\b(CVT|DCT|AT|MT|Automatic|Manual)\b/i)?.[1],
      drive: text.match(/\b(4WD|AWD|2WD|FWD|RWD)\b/i)?.[1],
      price: integer(text.match(/FOB Price\s*(?:US\$|USD|\$)\s*([0-9][0-9, ]+)/i)?.[1]),
      currency: "USD",
      images: imageUrls(card, pageUrl, /tc-v|tradecarview|cloudfront|amazonaws/i),
      detailUrl: anchor.href,
      location: "Japan",
    });
  });
  return rows;
}

class PriorityHtmlAdapter implements CatalogSourceAdapter {
  sourceId: string;
  market: CatalogMarket;
  accessMode = "public_html" as const;
  private config: PrioritySourceConfig;

  constructor(config: PrioritySourceConfig) {
    this.sourceId = config.sourceId;
    this.market = config.market;
    this.config = config;
  }

  private async request(url: string) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Number(process.env.CATALOG_SOURCE_TIMEOUT_MS || 25_000));
    try {
      const response = await fetch(url, { headers: { ...HEADERS, referer: `${this.config.baseUrl}/` }, redirect: "follow", signal: controller.signal });
      const markup = await response.text();
      if (!response.ok) throw new Error(`${this.sourceId}_http_${response.status}`);
      if (/captcha|verify you are human|access denied|request blocked|cloudflare/i.test(markup.slice(0, 4_000))) throw new Error(`${this.sourceId}_blocked_${response.status}`);
      return { response, markup };
    } finally { clearTimeout(timer); }
  }

  async fetchPage(cursor?: string | null): Promise<CatalogFetchResult> {
    const page = Math.max(1, Number(cursor || 1));
    const url = this.config.listUrl(page);
    const { response, markup } = await this.request(url);
    const items = this.config.parse(markup, response.url || url);
    if (!items.length) throw new Error(`${this.sourceId}_live_parser_zero_status_${response.status}_bytes_${markup.length}`);
    return {
      items,
      nextCursor: String(page + 1),
      finished: false,
      count: items.length,
      health: { ok: true, message: `${this.config.label}: parsed ${items.length}`, checkedAt: new Date().toISOString(), httpStatus: response.status, contentType: response.headers.get("content-type") || "" },
    };
  }

  mapStatus(): OfferStatus { return "active"; }

  normalizeOffer(raw: unknown): VehicleOffer | null {
    const row = raw as PriorityRow;
    if (!row.id || !row.make || !row.model || !row.year || !row.detailUrl || !row.price) return null;
    const now = new Date().toISOString();
    return {
      id: stableOfferId(this.sourceId, row.id), sourceId: this.sourceId, sourceOfferId: row.id, market: this.market,
      offerType: "fixed", status: "active", make: row.make, model: row.model, trim: row.title, year: row.year,
      mileageKm: row.mileageKm, engineCc: row.engineCc, powerHp: row.powerHp, fuel: row.fuel, transmission: row.transmission,
      drive: row.drive, bodyType: row.bodyType, sourcePrice: row.price, sourceCurrency: row.currency, priceMode: "fixed", images: [],
      totalRub: null, calculationStatus: "ready", firstSeenAt: now, updatedAt: now,
      operational: { sourceUrl: row.detailUrl, sourceVenueName: row.location || this.config.label, raw: row },
    };
  }

  async fetchImages(offer: VehicleOffer): Promise<CatalogImage[]> {
    const row = (offer.operational.raw || {}) as PriorityRow;
    const limit = Math.min(30, Math.max(1, Number(process.env.CATALOG_MAX_IMAGES_PER_OFFER || 30)));
    let urls = [...(row.images || [])];
    if (row.detailUrl) {
      const detail = await this.request(row.detailUrl).catch(() => null);
      if (detail) {
        const scope = this.config.galleryScope ? this.config.galleryScope(detail.markup) : detail.markup;
        urls = [...urls, ...imageUrls(scope, detail.response.url || row.detailUrl, this.config.imageHost)];
        const text = plainText(detail.markup);
        offer.powerHp ||= integer(text.match(/(\d{2,4})\s*(?:马力|HP|PS|л\.с\.)/i)?.[1]);
        const liters = number(text.match(/(\d+(?:\.\d+)?)\s*L\b/i)?.[1]);
        offer.engineCc ||= integer(text.match(/([0-9][0-9, ]+)\s*(?:cc|cm3|cm³)/i)?.[1]) || (liters ? Math.round(liters * 1_000) : undefined);
        offer.mileageKm ||= integer(text.match(/([0-9][0-9, ]+)\s*km/i)?.[1]);
      }
    }
    const cached: CatalogImage[] = [];
    for (const url of [...new Set(urls)].slice(0, limit * 3)) {
      const image = await cacheImageFromUrl(url, offer.market, { headers: { ...HEADERS, referer: row.detailUrl || `${this.config.baseUrl}/` } }).catch(() => null);
      if (image && image.size > 8_000) cached.push(image);
      if (cached.length >= limit) break;
    }
    return cached;
  }

  async healthCheck() { return { ok: true, message: `${this.config.label}: live parser`, checkedAt: new Date().toISOString() }; }
}

export const priorityMarketSources: CatalogSourceAdapter[] = [
  new PriorityHtmlAdapter({
    sourceId: "guazi_china_open", market: "china", label: "Guazi China live", baseUrl: "https://www.guazi.com", currency: "CNY",
    listUrl: (page) => page <= 1 ? "https://www.guazi.com/" : `https://www.guazi.com/?page=${page}`,
    detailPattern: /\/car-detail\/c\d+\.html/i, parse: parseGuazi,
    galleryScope: (markup) => markup.slice(0, Math.max(0, markup.search(/车况详解|本车卖点/)) || markup.length), imageHost: /guazi|guazistatic/i,
  }),
  new PriorityHtmlAdapter({
    sourceId: "carused_japan_open", market: "japan", label: "Carused Japan live", baseUrl: "https://carused.jp", currency: "USD",
    listUrl: (page) => `https://carused.jp/car-list?page=${page}`,
    detailPattern: /\/car-list\/detail\/[^/?]+\/[^/?]+\/[^/?]+\/[^/?]+/i, parse: parseCarused, imageHost: /carused|carpaydiem|cloudfront/i,
  }),
  new PriorityHtmlAdapter({
    sourceId: "tcv_japan_open", market: "japan", label: "TCV Japan live", baseUrl: "https://www.tc-v.com", currency: "USD",
    listUrl: (page) => page <= 1 ? "https://www.tc-v.com/used_car/all/all/" : `https://www.tc-v.com/used_car/all/all/?pn=${page - 1}`,
    detailPattern: /\/used_car\/[^/?]+\/[^/?]+\/\d+\/?/i, parse: parseTcv, imageHost: /tc-v|tradecarview|cloudfront|amazonaws/i,
  }),
];
