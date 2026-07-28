import { cacheImageFromUrl, stableOfferId } from "./storage";
import type { CatalogFetchResult, CatalogImage, CatalogSourceAdapter, OfferStatus, VehicleOffer } from "./types";

const HEADERS = {
  accept: "text/html,application/xhtml+xml,application/json;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "accept-language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7,ja;q=0.6",
  "cache-control": "no-cache",
  pragma: "no-cache",
  "upgrade-insecure-requests": "1",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
};

const BLOCK_RE = /captcha|cloudflare|access denied|request blocked|robot check|verify you are human|temporarily unavailable|forbidden/i;
const BAD_IMAGE_RE = /(?:skeleton|loading|placeholder|no[-_ ]?photo|no[-_ ]?image|logo|favicon|sprite|banner|qrcode|qr-code|pixel|tracking)/i;
const COMMERCIAL_RE = /\b(?:truck|dump|tipper|bus|minibus|commercial|cargo|lorry|tractor|forklift|excavator|machinery|canter|fighter|ranger|dutro|forward|giga|elf|profia|isuzu\s+truck)\b|(?:грузовик|самосвал|тягач|автобус|погрузчик|трактор|экскаватор)/i;

const JAPAN_TRANSIT_MODELS: Array<[string, string]> = [
  ["TOYOTA", "AQUA"], ["TOYOTA", "PRIUS"], ["TOYOTA", "COROLLA"], ["TOYOTA", "COROLLA AXIO"], ["TOYOTA", "COROLLA FIELDER"],
  ["TOYOTA", "COROLLA CROSS"], ["TOYOTA", "YARIS"], ["TOYOTA", "YARIS CROSS"], ["TOYOTA", "RAIZE"], ["TOYOTA", "ROOMY"],
  ["TOYOTA", "PASSO"], ["TOYOTA", "VITZ"], ["TOYOTA", "SIENTA"], ["TOYOTA", "NOAH"], ["TOYOTA", "VOXY"],
  ["TOYOTA", "ALPHARD"], ["TOYOTA", "VELLFIRE"], ["TOYOTA", "ESTIMA"], ["TOYOTA", "HARRIER"], ["TOYOTA", "RAV4"],
  ["TOYOTA", "C-HR"], ["TOYOTA", "LAND CRUISER PRADO"], ["TOYOTA", "CROWN"], ["TOYOTA", "CAMRY"], ["TOYOTA", "MARK X"],
  ["TOYOTA", "PROBOX"], ["TOYOTA", "SUCCEED"], ["TOYOTA", "HIACE"], ["NISSAN", "NOTE"], ["NISSAN", "NOTE AURA"],
  ["NISSAN", "DAYZ"], ["NISSAN", "ROOX"], ["NISSAN", "SERENA"], ["NISSAN", "X-TRAIL"], ["NISSAN", "QASHQAI"],
  ["NISSAN", "JUKE"], ["NISSAN", "KICKS"], ["NISSAN", "LEAF"], ["NISSAN", "MARCH"], ["NISSAN", "TIIDA"],
  ["NISSAN", "ELGRAND"], ["NISSAN", "SKYLINE"], ["NISSAN", "TEANA"], ["HONDA", "FIT"], ["HONDA", "VEZEL"],
  ["HONDA", "FREED"], ["HONDA", "N-BOX"], ["HONDA", "N-WGN"], ["HONDA", "N-ONE"], ["HONDA", "SHUTTLE"],
  ["HONDA", "STEPWGN"], ["HONDA", "ODYSSEY"], ["HONDA", "CR-V"], ["HONDA", "GRACE"], ["HONDA", "JADE"],
  ["HONDA", "INSIGHT"], ["HONDA", "CIVIC"], ["HONDA", "ACCORD"], ["MAZDA", "DEMIO"], ["MAZDA", "MAZDA2"],
  ["MAZDA", "MAZDA3"], ["MAZDA", "AXELA"], ["MAZDA", "ATENZA"], ["MAZDA", "CX-3"], ["MAZDA", "CX-30"],
  ["MAZDA", "CX-5"], ["MAZDA", "CX-8"], ["MAZDA", "ROADSTER"], ["SUBARU", "IMPREZA"], ["SUBARU", "XV"],
  ["SUBARU", "FORESTER"], ["SUBARU", "LEVORG"], ["SUBARU", "LEGACY"], ["SUBARU", "OUTBACK"], ["SUBARU", "STELLA"],
  ["SUBARU", "PLEO"], ["MITSUBISHI", "DELICA D5"], ["MITSUBISHI", "DELICA D3"], ["MITSUBISHI", "OUTLANDER"], ["MITSUBISHI", "RVR"],
  ["MITSUBISHI", "ECLIPSE CROSS"], ["MITSUBISHI", "MIRAGE"], ["MITSUBISHI", "EK WAGON"], ["SUZUKI", "SWIFT"], ["SUZUKI", "SOLIO"],
  ["SUZUKI", "SPACIA"], ["SUZUKI", "HUSTLER"], ["SUZUKI", "JIMNY"], ["SUZUKI", "WAGON R"], ["SUZUKI", "ALTO"],
  ["SUZUKI", "ESCUDO"], ["DAIHATSU", "TANTO"], ["DAIHATSU", "MOVE"], ["DAIHATSU", "MIRA"], ["DAIHATSU", "CAST"],
  ["DAIHATSU", "WAKE"], ["DAIHATSU", "ROCKY"], ["DAIHATSU", "THOR"], ["LEXUS", "CT"], ["LEXUS", "IS"],
  ["LEXUS", "ES"], ["LEXUS", "GS"], ["LEXUS", "NX"], ["LEXUS", "RX"], ["LEXUS", "UX"],
];

export type JapanAuctionStatisticsRow = {
  id: string;
  make: string;
  model: string;
  trim?: string;
  year: number;
  mileageKm?: number;
  engineCc?: number;
  transmission?: string;
  frameNumber?: string;
  auctionGrade?: string;
  auctionDate?: string;
  lotNumber?: string;
  auctionName?: string;
  price: number;
  currency: "RUB";
  images: string[];
  detailUrl: string;
};

function decodeHtml(value: string) {
  return value
    .replace(/&nbsp;|&#160;|\u00a0/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
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

function positiveInteger(value: string | undefined) {
  const parsed = Number(String(value || "").replace(/[^0-9]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function absoluteUrl(value: string, baseUrl: string) {
  if (!value || /^(?:data:|javascript:|mailto:|tel:)/i.test(value)) return "";
  try { return new URL(value.replace(/\\\//g, "/"), baseUrl).toString(); } catch { return ""; }
}

function imageUrlsFromTag(tag: string, baseUrl: string) {
  const result: string[] = [];
  for (const key of ["data-original", "data-lazy-src", "data-src", "src"]) {
    const match = tag.match(new RegExp(`${key}\\s*=\\s*["']([^"']+)["']`, "i"));
    const url = absoluteUrl(match?.[1] || "", baseUrl);
    if (url && /^https?:/i.test(url) && !BAD_IMAGE_RE.test(url)) result.push(url);
  }
  return [...new Set(result)];
}

function imageAlt(tag: string) {
  return decodeHtml(tag.match(/\balt\s*=\s*["']([^"']*)["']/i)?.[1] || "").replace(/\s+/g, " ").trim();
}

function isoDate(value: string | undefined) {
  const match = String(value || "").match(/\b(\d{2})[./-](\d{2})[./-]((?:19|20)\d{2})\b/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : undefined;
}

function filteredStatisticsUrl(make: string, model: string) {
  const url = new URL("https://japantransit.ru/stat/");
  url.searchParams.set("vendor", make.toUpperCase());
  url.searchParams.set("model", model.toUpperCase());
  return url.toString();
}

export function parseJapanTransitAuctionStatistics(markup: string, pageUrl = "https://japantransit.ru/stat/") {
  const imageTags = [...markup.matchAll(/<img\b[^>]*>/gi)]
    .map((match) => ({ tag: match[0], index: match.index || 0, alt: imageAlt(match[0]) }))
    .filter((item) => /аукцион.*япон|auction.*japan/i.test(item.alt));
  const rows: JapanAuctionStatisticsRow[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < imageTags.length; index++) {
    const item = imageTags[index];
    const previousIndex = index > 0 ? imageTags[index - 1].index : 0;
    const nextIndex = index + 1 < imageTags.length ? imageTags[index + 1].index : markup.length;
    const card = markup.slice(Math.max(previousIndex, item.index - 2_500), Math.min(nextIndex + 1_500, item.index + 10_000));
    const plain = stripHtml(card);
    const heading = plain.match(/\b(TOYOTA|NISSAN|HONDA|MAZDA|MITSUBISHI|SUBARU|SUZUKI|DAIHATSU|LEXUS|ISUZU|INFINITI|ACURA)\s+([^,]{1,80}),\s*((?:19|20)\d{2})\b/i);
    if (!heading) continue;

    const make = heading[1].toUpperCase();
    const model = heading[2].replace(/\s+/g, " ").trim();
    const year = Number(heading[3]);
    const price = positiveInteger(plain.match(/~?\s*([0-9][0-9\s\u00a0]{3,})\s*₽/i)?.[1]);
    const specs = plain.match(/\b([A-Z0-9-]{2,})\s*\/\s*([0-9][0-9\s\u00a0]{0,8})\s*км\.?\s*\/\s*([0-9][0-9\s\u00a0]{2,6})\s*(?:см\s*\^?\s*\{?3\}?|см³|cc)\s*\/\s*(AT|MT|CVT|DCT)/i);
    const grade = plain.match(/Оценка\s+([A-ZА-Я0-9.+-]{1,8})/i)?.[1];
    const auctionDate = isoDate(plain.match(/\b\d{2}[./-]\d{2}[./-](?:19|20)\d{2}\b/)?.[0]);
    const lotNumber = plain.match(/(?:Номер\s+лота|Лот)\s*[:№#]?\s*([A-Z0-9-]{2,20})/i)?.[1];
    const auctionName = plain.match(/(?:Аукцион)\s*[:]?\s*([A-Z][A-Z0-9 -]{1,30})/i)?.[1]?.trim();
    const images = imageUrlsFromTag(item.tag, pageUrl);
    if (!price || !images.length || COMMERCIAL_RE.test(`${make} ${model} ${item.alt} ${plain.slice(0, 500)}`)) continue;

    const afterHeading = plain.slice((heading.index || 0) + heading[0].length);
    const beforeSpecs = specs?.index !== undefined ? afterHeading.slice(0, Math.max(0, specs.index - ((heading.index || 0) + heading[0].length))) : afterHeading.slice(0, 100);
    const trim = beforeSpecs
      .replace(/Оценка\s+[A-ZА-Я0-9.+-]+/gi, " ")
      .replace(/~?\s*[0-9][0-9\s\u00a0]{3,}\s*₽/gi, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 100) || undefined;
    const mileageKm = positiveInteger(specs?.[2]);
    const engineCc = positiveInteger(specs?.[3]);
    const frameNumber = specs?.[1];
    const detailUrl = filteredStatisticsUrl(make, model);
    const identity = `${make}|${model}|${year}|${frameNumber || ""}|${mileageKm || ""}|${engineCc || ""}|${grade || ""}|${price}|${images[0]}`;
    const id = stableOfferId("japantransit_japan_stat_open", identity);
    if (seen.has(id)) continue;
    seen.add(id);
    rows.push({
      id,
      make,
      model,
      trim,
      year,
      mileageKm,
      engineCc,
      transmission: specs?.[4]?.toUpperCase(),
      frameNumber,
      auctionGrade: grade,
      auctionDate,
      lotNumber,
      auctionName,
      price,
      currency: "RUB",
      images,
      detailUrl,
    });
  }

  return rows;
}

function parseCursor(cursor?: string | null) {
  const match = String(cursor || "0:1").match(/^(\d+):(\d+)$/);
  return { modelIndex: Math.max(0, Number(match?.[1] || 0)), page: Math.max(1, Number(match?.[2] || 1)) };
}

function nextCursor(modelIndex: number, page: number) {
  return `${modelIndex}:${page}`;
}

export class JapanTransitAuctionStatisticsAdapter implements CatalogSourceAdapter {
  sourceId = "japantransit_japan_stat_open";
  market = "japan" as const;
  accessMode = "public_html" as const;

  private async request(url: string) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Number(process.env.CATALOG_SOURCE_TIMEOUT_MS || 18_000));
    try {
      const response = await fetch(url, { headers: { ...HEADERS, referer: "https://japantransit.ru/japan/stat" }, redirect: "follow", signal: controller.signal });
      const markup = await response.text();
      if ([401, 403, 429].includes(response.status) || BLOCK_RE.test(markup.slice(0, 2_000))) {
        const error = new Error(`${this.sourceId}_blocked_${response.status}`) as Error & { blocked?: boolean; status?: number };
        error.blocked = true;
        error.status = response.status;
        throw error;
      }
      return { response, markup, url: response.url || url };
    } finally {
      clearTimeout(timer);
    }
  }

  async fetchPage(cursor?: string | null): Promise<CatalogFetchResult> {
    let { modelIndex, page } = parseCursor(cursor);
    let lastStatus = 0;
    let lastBytes = 0;

    for (let skipped = 0; skipped < 12 && modelIndex < JAPAN_TRANSIT_MODELS.length; skipped++) {
      const [make, model] = JAPAN_TRANSIT_MODELS[modelIndex];
      const query = new URLSearchParams({ vendor: make, model, page: String(page) });
      const urls = [
        `https://japantransit.ru/japan/stat?${query.toString()}`,
        `https://japantransit.ru/stat/?${query.toString()}`,
      ];
      let blockedError: unknown = null;

      for (const url of urls) {
        const result = await this.request(url).catch((error) => {
          if ((error as any)?.blocked) blockedError = error;
          return null;
        });
        if (!result) continue;
        lastStatus = result.response.status;
        lastBytes = result.markup.length;
        if (!result.response.ok) continue;
        const items = parseJapanTransitAuctionStatistics(result.markup, result.url);
        if (!items.length) continue;
        const nextPage = page + 1;
        const next = nextPage > 8 ? nextCursor(modelIndex + 1, 1) : nextCursor(modelIndex, nextPage);
        return {
          items,
          nextCursor: next,
          finished: false,
          count: items.length,
          health: {
            ok: true,
            message: `Japan Transit auction statistics: ${make} ${model}, page ${page}, parsed ${items.length}`,
            checkedAt: new Date().toISOString(),
            httpStatus: result.response.status,
            contentType: result.response.headers.get("content-type") || "",
          },
        };
      }

      if (blockedError) throw blockedError;
      modelIndex += 1;
      page = 1;
    }

    if (modelIndex >= JAPAN_TRANSIT_MODELS.length) {
      return {
        items: [],
        nextCursor: null,
        finished: true,
        count: 0,
        health: { ok: true, message: "Japan Transit auction statistics: model queue completed", checkedAt: new Date().toISOString(), httpStatus: lastStatus },
      };
    }
    throw new Error(`${this.sourceId}_parsed_zero_status_${lastStatus}_bytes_${lastBytes}`);
  }

  mapStatus(): OfferStatus {
    // The record itself remains active in our statistics catalogue; auctionResult marks the lot as sold.
    return "active";
  }

  normalizeOffer(raw: unknown): VehicleOffer | null {
    const row = raw as JapanAuctionStatisticsRow;
    if (!row?.id || !row.make || !row.model || !row.year || !row.price || !row.detailUrl) return null;
    const now = new Date().toISOString();
    return {
      id: row.id,
      sourceId: this.sourceId,
      sourceOfferId: row.id,
      market: "japan",
      offerType: "auction",
      status: "active",
      catalogKind: "auction_result",
      auctionResult: "sold",
      auctionPriceKind: "published_result",
      make: row.make,
      model: row.model,
      trim: row.trim,
      year: row.year,
      mileageKm: row.mileageKm,
      engineCc: row.engineCc,
      transmission: row.transmission,
      frameNumber: row.frameNumber,
      auctionName: row.auctionName,
      auctionDate: row.auctionDate,
      lotNumber: row.lotNumber,
      auctionGrade: row.auctionGrade,
      sourcePrice: row.price,
      sourceCurrency: row.currency,
      priceMode: "fixed",
      images: [],
      totalRub: null,
      calculationStatus: "needs_data",
      firstSeenAt: now,
      updatedAt: now,
      operational: {
        sourceUrl: row.detailUrl,
        sourceVenueName: "Japan Transit · статистика продаж",
        sourcePublishedAt: row.auctionDate,
        raw: row,
      } as any,
    };
  }

  async fetchImages(offer: VehicleOffer): Promise<CatalogImage[]> {
    const row = (offer.operational.raw || {}) as JapanAuctionStatisticsRow;
    const limit = Math.max(1, Math.min(4, Number(process.env.CATALOG_MAX_IMAGES_PER_OFFER || 1)));
    const result: CatalogImage[] = [];
    for (const url of [...new Set(row.images || [])].slice(0, limit)) {
      const image = await cacheImageFromUrl(url, "japan", { headers: { ...HEADERS, referer: row.detailUrl } }).catch(() => null);
      if (image && image.size > 8_000) result.push(image);
      if (result.length >= limit) break;
    }
    return result;
  }

  async healthCheck() {
    const result = await this.fetchPage(null);
    return result.health || { ok: Boolean(result.items.length), message: `Japan Transit auction statistics: ${result.items.length}`, checkedAt: new Date().toISOString() };
  }
}

export const japanTransitAuctionStatisticsSource = new JapanTransitAuctionStatisticsAdapter();
export const japanAuctionStatisticsSources: CatalogSourceAdapter[] = [japanTransitAuctionStatisticsSource];
