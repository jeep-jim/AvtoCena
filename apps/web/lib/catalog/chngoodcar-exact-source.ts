import type { CatalogFetchResult, CatalogImage, CatalogSourceAdapter, OfferStatus, SourceRunHealth, VehicleOffer } from "./types";

const BASE_URL = "https://www.chngoodcar.com";
const HOME_URL = `${BASE_URL}/`;
const CURRENCY_URL = `${BASE_URL}/Home/CarsList`;
const DETAIL_RE = /\/Home\/Cars\?id=(\d+)/i;
const USER_AGENT = "AvtoCenaGoodCarExactAdapter/1.0 (+read-only until source promotion)";
const HEADERS = {
  accept: "text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.5",
  "accept-language": "zh-CN,zh;q=0.9,en;q=0.6",
  "cache-control": "no-cache",
  pragma: "no-cache",
  "user-agent": USER_AGENT,
};
const BAD_IMAGE = /logo|icon|avatar|qrcode|qr-code|banner|sprite|tracking|pixel|favicon|appstore|googleplay|placeholder|default|dealer|seller|brand|wechat|weixin|badge|flag|douyin|whatsapp|telegram|facebook|twitter|social|\/vk[./_\-]/i;
const IMAGE_EXTENSION = /\.(?:jpe?g|png|webp|avif)(?:[?#]|$)/i;
const ICE_FUELS = new Set(["汽油", "柴油", "液化天然气", "液化石油气", "天然气"]);
const PASSENGER_BODY_TYPES = new Set(["轿车", "SUV", "MPV", "两厢车", "三厢车", "旅行车", "跑车"]);
const TRANSMISSION_VALUES = new Set(["手动", "自动", "手自一体", "CVT", "E-CVT", "双离合", "AMT", "DCT", "无级变速"]);
const DRIVE_VALUES = new Set(["前置前驱", "前置后驱", "后置后驱", "中置后驱", "前轮驱动", "后轮驱动", "全时四驱", "适时四驱", "分时四驱", "四轮驱动", "四驱"]);
const METRIC_HP_KW = 0.73549875;
const BRAND_PREFIXES = [
  "FAW Toyota", "现代汽车", "梅赛德斯-奔驰", "马自达", "比亚迪", "奔驰", "宝马", "奥迪", "丰田", "本田", "大众", "日产", "起亚", "现代", "标致", "吉利", "福田", "金龙", "中通", "开瑞", "极氪", "长安", "众泰", "知豆", "MG",
].sort((a, b) => b.length - a.length);

export type GoodCarExactRawOffer = {
  sourceOfferId: string;
  detailUrl: string;
  sourceTitle: string;
  listTitle?: string;
  sourcePrice: number;
  listPrice?: number;
  currency: "USD";
  currencyLabelVerified: boolean;
  listDetailPriceParity: boolean;
  listDetailTitleParity: boolean;
  productionDate: string;
  year: number;
  mileageKm: number;
  engineCc: number;
  powerKw: number;
  fuel: string;
  transmission?: string;
  bodyType?: string;
  vehicleType?: string;
  drive?: string;
  color?: string;
  vin?: string;
  doors?: number;
  seats?: number;
  imageUrls: string[];
};

type DiscoveryRow = { sourceOfferId: string; detailUrl: string; listText: string; listTitle?: string; listPrice?: number };

function decodeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (token, n) => {
      const code = Number(n);
      return Number.isFinite(code) ? String.fromCodePoint(code) : token;
    });
}

function clean(value: unknown, limit = 260_000) {
  return decodeHtml(value)
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(?:div|p|li|tr|td|th|dt|dd|section|h[1-6])>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[\u0000-\u001f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

function absolute(value: string, base: string) {
  try {
    const url = new URL(decodeHtml(value), base);
    if (!/^https?:$/.test(url.protocol)) return "";
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

function remoteImage(url: string): CatalogImage {
  return {
    id: "",
    url,
    objectKey: "",
    checksum: "",
    size: 0,
    mimeType: /\.png(?:[?#]|$)/i.test(url) ? "image/png" : /\.webp(?:[?#]|$)/i.test(url) ? "image/webp" : /\.avif(?:[?#]|$)/i.test(url) ? "image/avif" : "image/jpeg",
  };
}

function allowedImageUrl(value: string) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return (host === "www.chngoodcar.com" || host === "chngoodcar.com" || host === "ucoc.net" || host.endsWith(".ucoc.net")) && IMAGE_EXTENSION.test(url.toString()) && !BAD_IMAGE.test(url.toString());
  } catch {
    return false;
  }
}

function extractImages(fragment: string, baseUrl: string) {
  const values: string[] = [];
  for (const match of fragment.matchAll(/<(?:img|source)\b[^>]*(?:src|data-src|data-original|data-lazy|data-lazy-src|srcset)\s*=\s*["']([^"']+)["']/gi)) {
    for (const raw of String(match[1] || "").split(",").map((item) => item.trim().split(/\s+/)[0])) values.push(raw);
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const url = absolute(raw, baseUrl);
    if (!url || !allowedImageUrl(url)) continue;
    const key = url.replace(/[?#].*$/, "").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(url);
    if (out.length >= 30) break;
  }
  return out;
}

function visibleCoreSegment(decodedHtml: string) {
  const text = clean(decodedHtml);
  const stockIdx = text.indexOf("库存");
  if (stockIdx < 0) return text.slice(0, 15_000);
  const start = Math.max(0, stockIdx - 700);
  const recIdx = text.indexOf("猜你喜欢", stockIdx);
  const end = recIdx >= 0 ? recIdx : Math.min(text.length, stockIdx + 12_000);
  return text.slice(start, end).trim();
}

function htmlCoreSegment(decodedHtml: string) {
  const stockIdx = decodedHtml.indexOf("库存");
  if (stockIdx < 0) return decodedHtml.slice(0, 80_000);
  const start = Math.max(0, stockIdx - 65_000);
  const recIdx = decodedHtml.indexOf("猜你喜欢", stockIdx);
  const end = recIdx >= 0 ? recIdx : Math.min(decodedHtml.length, stockIdx + 90_000);
  return decodedHtml.slice(start, end);
}

function firstMatch<T = string>(text: string, re: RegExp, map: (match: RegExpMatchArray) => T = (match) => match[1] as T): T | undefined {
  const match = text.match(re);
  return match ? map(match) : undefined;
}

function positiveNumber(value: unknown) {
  const n = Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function exactEnum(value: unknown, values: Set<string>) {
  const normalized = clean(value, 80);
  return values.has(normalized) ? normalized : undefined;
}

function detailId(url: string) {
  return url.match(DETAIL_RE)?.[1] || "";
}

function sourceTitleFromHtml(html: string) {
  const raw = clean(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "", 400);
  return raw.replace(/[_\-–—]\s*广东好车[\s\S]*$/i, "").trim();
}

function normalizeIdentity(value: unknown) {
  return clean(value, 500).replace(/[\s_]+/g, " ").trim().toLowerCase();
}

export function goodCarKwToProjectHp(powerKw: number) {
  if (!Number.isFinite(powerKw) || powerKw <= 0) return undefined;
  return Math.round(powerKw / METRIC_HP_KW);
}

export function isGoodCarIceFuel(fuel: unknown) {
  return ICE_FUELS.has(clean(fuel, 40));
}

export function isGoodCarPassengerBodyType(bodyType: unknown) {
  return PASSENGER_BODY_TYPES.has(clean(bodyType, 40));
}

export function splitGoodCarMakeModel(sourceTitle: string) {
  const title = clean(sourceTitle, 400);
  for (const make of BRAND_PREFIXES) {
    if (!title.toLowerCase().startsWith(make.toLowerCase())) continue;
    const rest = title.slice(make.length).trim();
    const model = rest.replace(/\s+(?:19|20)\d{2}款[\s\S]*$/i, "").trim();
    if (model) return { make, model };
  }
  return null;
}

export function hasGoodCarUsdPriceContract(html: string) {
  return /价格\s*\(\s*US\s*\$\s*\)/i.test(clean(html));
}

export function parseGoodCarDetailHtml(html: string, detailUrl: string) {
  const sourceOfferId = detailId(detailUrl);
  if (!sourceOfferId) return null;
  const decoded = decodeHtml(html);
  const coreText = visibleCoreSegment(decoded);
  const coreHtml = htmlCoreSegment(decoded);
  const sourceTitle = sourceTitleFromHtml(decoded);
  const productionDate = firstMatch(coreText, /出厂年份\s+(\d{4}-\d{2})/);
  const year = Number(productionDate?.slice(0, 4) || 0);
  const price = positiveNumber(firstMatch(coreText, /([\d,.]+)\s+库存[:：]?\s*\d+\s*辆/));
  const mileageKm = firstMatch(coreText, /里程\s*\(km\)\s*(\d+)/i, (m) => Number(m[1]));
  const engineCc = firstMatch(coreText, /排量\s*\(ml\)\s*(\d+)/i, (m) => Number(m[1]));
  const powerKw = firstMatch(coreText, /功率\s*\(kw\)\s*([\d.]+)/i, (m) => Number(m[1]));
  const fuel = firstMatch(coreText, /燃料种类\s+([^\s]{1,16})/);
  if (!sourceTitle || !productionDate || year < 2011 || !price || !Number.isFinite(mileageKm) || !engineCc || !powerKw || !fuel) return null;
  return {
    sourceOfferId,
    detailUrl,
    sourceTitle,
    sourcePrice: price,
    productionDate,
    year,
    mileageKm: Number(mileageKm),
    engineCc,
    powerKw,
    fuel,
    transmission: exactEnum(firstMatch(coreText, /变速箱\s+([^\s]{1,24})/), TRANSMISSION_VALUES),
    bodyType: firstMatch(coreText, /车型\s+(轿车|SUV|MPV|两厢车|三厢车|旅行车|跑车|皮卡|面包车|客车|货车)/i),
    vehicleType: firstMatch(coreText, /车辆类型\s+([^\s]{1,24})/),
    drive: exactEnum(firstMatch(coreText, /驱动形式\s+([^\s]{1,24})/), DRIVE_VALUES),
    color: firstMatch(coreText, /车身颜色\s+([^\s]{1,24})/),
    vin: firstMatch(coreText, /VIN码\s+([A-HJ-NPR-Z0-9]{11,17})/i),
    doors: firstMatch(coreText, /门数\s+(\d+)/, (m) => Number(m[1])),
    seats: firstMatch(coreText, /座位数\s+(\d+)/, (m) => Number(m[1])),
    imageUrls: extractImages(coreHtml, detailUrl),
  };
}

export function discoverGoodCarHomepageOffers(html: string, pageUrl = HOME_URL): DiscoveryRow[] {
  const anchors = [...String(html || "").matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
  const out = new Map<string, DiscoveryRow>();
  for (const match of anchors) {
    const detailUrl = absolute(match[1], pageUrl);
    const sourceOfferId = detailId(detailUrl);
    if (!sourceOfferId || out.has(sourceOfferId)) continue;
    const listText = clean(match[2], 2_000);
    const listPrice = positiveNumber(listText.match(/价格[:：]?\s*([\d,.]+)(?:\.00)?/i)?.[1]);
    const listTitle = listText.replace(/\s*价格[:：]?[\s\S]*$/i, "").trim() || undefined;
    out.set(sourceOfferId, { sourceOfferId, detailUrl, listText, listTitle, listPrice });
  }
  return [...out.values()];
}

async function fetchHtml(url: string, referer?: string) {
  const response = await fetch(url, {
    headers: { ...HEADERS, ...(referer ? { referer } : {}) },
    redirect: "follow",
    signal: AbortSignal.timeout(Math.max(8_000, Number(process.env.CATALOG_SOURCE_REQUEST_TIMEOUT_MS || 30_000))),
  });
  const html = await response.text();
  if (!response.ok) throw new Error(`chngoodcar_http_${response.status}:${url}`);
  return { response, html };
}

export class ChnGoodCarExactAdapter implements CatalogSourceAdapter {
  sourceId = "chngoodcar_china_candidate";
  market = "china" as const;
  accessMode = "public_html" as const;

  async fetchPage(cursor?: string | null): Promise<CatalogFetchResult> {
    const page = Math.max(1, Number(cursor || 1));
    if (page > 1) return { items: [], nextCursor: null, finished: true, count: 0, health: { ok: true, message: "Good Car exact canary:single public homepage discovery page exhausted", checkedAt: new Date().toISOString() } };

    const currencyPage = await fetchHtml(CURRENCY_URL, HOME_URL);
    if (!hasGoodCarUsdPriceContract(currencyPage.html)) throw new Error("chngoodcar_currency_contract_missing");
    const home = await fetchHtml(HOME_URL, CURRENCY_URL);
    const discovered = discoverGoodCarHomepageOffers(home.html, home.response.url || HOME_URL);
    const maxDetails = Math.max(4, Math.min(30, Number(process.env.CATALOG_CHNGOODCAR_MAX_DETAILS_PER_RUN || 18)));
    const items: GoodCarExactRawOffer[] = [];
    let parsedCount = 0;
    for (const row of discovered.slice(0, maxDetails)) {
      const detail = await fetchHtml(row.detailUrl, HOME_URL);
      const parsed = parseGoodCarDetailHtml(detail.html, detail.response.url || row.detailUrl);
      if (!parsed) continue;
      parsedCount += 1;
      const listTitleParity = Boolean(row.listTitle && normalizeIdentity(row.listTitle).includes(normalizeIdentity(parsed.sourceTitle)));
      const listDetailPriceParity = Boolean(row.listPrice && Number(row.listPrice) === Number(parsed.sourcePrice));
      items.push({
        ...parsed,
        listTitle: row.listTitle,
        listPrice: row.listPrice,
        currency: "USD",
        currencyLabelVerified: true,
        listDetailPriceParity,
        listDetailTitleParity: listTitleParity,
      });
    }
    return {
      items,
      nextCursor: null,
      finished: true,
      count: discovered.length,
      health: {
        ok: items.length > 0,
        message: `Good Car exact canary:discovered_${discovered.length}:parsed_${parsedCount}:returned_${items.length}`,
        checkedAt: new Date().toISOString(),
        httpStatus: home.response.status,
        contentType: home.response.headers.get("content-type") || "",
      },
    };
  }

  normalizeOffer(raw: unknown): VehicleOffer | null {
    const row = raw as GoodCarExactRawOffer;
    if (!row?.sourceOfferId || !row.detailUrl || !row.sourceTitle || !row.productionDate || !row.sourcePrice) return null;
    if (row.currency !== "USD" || row.currencyLabelVerified !== true || row.listDetailPriceParity !== true || row.listDetailTitleParity !== true) return null;
    if (!isGoodCarIceFuel(row.fuel) || !isGoodCarPassengerBodyType(row.bodyType) || !(row.engineCc > 0) || !(row.powerKw > 0) || row.imageUrls.length < 5) return null;
    const identity = splitGoodCarMakeModel(row.sourceTitle);
    if (!identity) return null;
    const powerHp = goodCarKwToProjectHp(row.powerKw);
    if (!powerHp) return null;
    const now = new Date().toISOString();
    return {
      id: `${this.sourceId}:${row.sourceOfferId}`,
      sourceId: this.sourceId,
      sourceOfferId: row.sourceOfferId,
      market: "china",
      offerType: "fixed",
      status: "active",
      sourceTitle: row.sourceTitle,
      make: identity.make,
      model: identity.model,
      year: row.year,
      productionDate: row.productionDate,
      mileageKm: row.mileageKm,
      engineCc: row.engineCc,
      fuel: row.fuel,
      powertrainKind: "combustion",
      transmission: row.transmission,
      drive: row.drive,
      bodyType: row.bodyType,
      powerHp,
      powerKw: row.powerKw,
      icePowerKw: row.powerKw,
      powerDataConfidence: "source_exact",
      powerDataSource: "chngoodcar_offer_detail_功率(kw)",
      color: row.color,
      vin: row.vin,
      sourcePrice: row.sourcePrice,
      sourceCurrency: "USD",
      priceMode: "fixed",
      images: [],
      totalRub: null,
      calculationStatus: "needs_data",
      firstSeenAt: now,
      updatedAt: now,
      operational: {
        sourceUrl: row.detailUrl,
        sourceVenueName: "广东好车 / Guangdong Good Car",
        sourceTitle: row.sourceTitle,
        vin: row.vin,
        galleryStoredAs: "json_urls",
        exactScope: "ICE_passenger_only_no_publish_canary_v1",
        semanticEvidence: {
          priceCurrency: "detail numeric price + public CarsList 价格(US $) + homepage list/detail price parity",
          year: "offer-bound 出厂年份",
          fuel: "offer-bound 燃料种类; electrified values fail closed",
          engineCc: "offer-bound 排量 (ml)",
          powerKw: "offer-bound 功率 (kw)",
          powerHp: { method: "metric_horsepower_from_kW", kwPerHp: METRIC_HP_KW, rounded: "nearest_integer" },
          bodyType: "offer-bound 车型; v1 exact gate allows passenger body types only",
          gallery: "detail core before 猜你喜欢; social assets rejected; >=5 source-hosted listing images",
          identity: "detail <title> + explicit supported make prefix",
        },
        raw: row,
      },
    };
  }

  async fetchImages(offer: VehicleOffer): Promise<CatalogImage[]> {
    const raw = offer.operational?.raw as GoodCarExactRawOffer | undefined;
    const urls = Array.isArray(raw?.imageUrls) ? raw!.imageUrls.filter(allowedImageUrl).slice(0, 30) : [];
    const verified = urls.length >= 5;
    offer.operational = {
      ...(offer.operational || {}),
      photoIdentityVerified: verified,
      galleryVerified: verified,
      galleryImageCount: urls.length,
      gallerySafetyMode: "chngoodcar_exact_detail_core_before_recommendations_social_assets_rejected",
      galleryStoredAs: "json_urls",
    };
    return verified ? urls.map(remoteImage) : [];
  }

  mapStatus(): OfferStatus {
    return "active";
  }

  async healthCheck(): Promise<SourceRunHealth> {
    try {
      const page = await this.fetchPage("1");
      const normalized = page.items.map((item) => this.normalizeOffer(item)).filter(Boolean);
      return {
        ok: normalized.length > 0,
        message: `${page.health?.message || "Good Car exact canary"}:normalized_${normalized.length}`,
        checkedAt: new Date().toISOString(),
        httpStatus: page.health?.httpStatus,
        contentType: page.health?.contentType,
      };
    } catch (error) {
      return { ok: false, message: String((error as Error)?.message || error), checkedAt: new Date().toISOString() };
    }
  }
}

export const chngoodcarChinaExactSource = new ChnGoodCarExactAdapter();
