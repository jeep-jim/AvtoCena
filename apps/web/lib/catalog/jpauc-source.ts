import { cacheImageFromUrl, stableOfferId } from "./storage";
import type { CatalogFetchResult, CatalogImage, CatalogSourceAdapter, OfferStatus, VehicleOffer } from "./types";
import { normalizeVehicleOfferSpecs } from "./spec-normalization";

const HEADERS = {
  accept: "text/html,application/xhtml+xml,application/json;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9,ja;q=0.8",
  "cache-control": "no-cache",
  pragma: "no-cache",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
};

const JP_MAKES = [
  "MERCEDES-BENZ", "MERCEDES BENZ", "LAND ROVER", "RANGE ROVER", "ROLLS-ROYCE", "ASTON MARTIN", "ALFA ROMEO",
  "TOYOTA", "LEXUS", "NISSAN", "INFINITI", "HONDA", "ACURA", "MAZDA", "MITSUBISHI", "SUBARU", "SUZUKI", "DAIHATSU", "ISUZU", "HINO", "MITSUOKA",
  "BMW", "AUDI", "VOLKSWAGEN", "PORSCHE", "VOLVO", "MINI", "JEEP", "JAGUAR", "FORD", "CHEVROLET", "CADILLAC", "CHRYSLER", "DODGE", "TESLA",
  "PEUGEOT", "RENAULT", "CITROEN", "FIAT", "MASERATI", "FERRARI", "LAMBORGHINI", "BENTLEY", "LOTUS", "HYUNDAI", "KIA", "GENESIS", "BYD",
].sort((a, b) => b.length - a.length);

function text(value: unknown) { return value == null ? "" : String(value).replace(/\s+/g, " ").trim(); }
function integer(value: unknown) { const number = Number(text(value).replace(/[^0-9]/g, "")); return Number.isFinite(number) && number >= 0 ? number : undefined; }
function decodeHtml(value: string) { return text(value).replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">"); }
function stripHtml(value: string) { return decodeHtml(value.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")); }
function absoluteUrl(value: string, baseUrl: string) { try { return new URL(decodeHtml(value).replace(/\\\//g, "/"), baseUrl).toString(); } catch { return ""; } }
function unique(values: unknown[]): string[] { return [...new Set(values.map(text).filter(Boolean))]; }

async function requestHtml(url: string, referer = url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(process.env.CATALOG_SOURCE_TIMEOUT_MS || 30_000));
  try {
    const response = await fetch(url, { headers: { ...HEADERS, referer }, redirect: "follow", signal: controller.signal });
    return { response, html: await response.text() };
  } finally { clearTimeout(timer); }
}

function imageUrls(markup: string, baseUrl: string) {
  const candidates: string[] = [];
  for (const match of markup.matchAll(/<(?:img|source)\b[^>]*(?:data-original|data-lazy-src|data-src|src)\s*=\s*["']([^"']+)["']/gi)) candidates.push(match[1]);
  for (const match of markup.matchAll(/(?:data-srcset|srcset)\s*=\s*["']([^"']+)["']/gi)) match[1].split(",").forEach((item) => candidates.push(item.trim().split(/\s+/)[0]));
  for (const match of markup.matchAll(/https?:\\?\/\\?\/[^"'\\\s<>]+?\.(?:jpe?g|png|webp)(?:\?[^"'\\\s<>]*)?/gi)) candidates.push(match[0].replace(/\\\//g, "/"));
  return unique(candidates.map((item) => absoluteUrl(item, baseUrl)).filter((url) => /^https?:/i.test(url) && !/logo|icon|banner|placeholder|qrcode|qr-code|no[-_ ]?image|avatar/i.test(url)));
}

function makerFrom(value: string) {
  const upper = value.toUpperCase();
  return JP_MAKES.find((make) => new RegExp(`(?:^|\\s)${make.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\s|$)`, "i").test(upper)) || "";
}

function normalizeMaker(value: string) {
  return value === "MERCEDES BENZ" ? "MERCEDES-BENZ" : value;
}

function parseDetail(html: string, detailUrl: string) {
  const plain = stripHtml(html);
  const maker = normalizeMaker(text(plain.match(/Maker:\s*([A-Z0-9& .'-]+?)\s+Year:/i)?.[1]).toUpperCase());
  const model = text(plain.match(/Model:\s*(.*?)\s+Model Grade:/i)?.[1]);
  const grade = text(plain.match(/Model Grade:\s*(.*?)\s+Model Code:/i)?.[1]);
  const modelCode = text(plain.match(/Model Code:\s*(.*?)\s+KM:/i)?.[1]);
  const year = Number(plain.match(/Year:\s*((?:19|20)\d{2})/i)?.[1]);
  const lotNumber = text(plain.match(/Lot No\.:\s*([0-9]+)/i)?.[1]);
  const location = text(plain.match(/Location:\s*(.*?)\s+Maker:/i)?.[1]);
  const mileageKm = integer(plain.match(/KM:\s*([0-9,]+)\s*km/i)?.[1]);
  const engineCc = integer(plain.match(/CC:\s*([0-9,]+)\s*cc/i)?.[1]);
  const startPrice = integer(plain.match(/Start Price:\s*¥\s*([0-9,]+)/i)?.[1]);
  const transmission = text(plain.match(/Shift:\s*(.*?)\s+Color:/i)?.[1]);
  const color = text(plain.match(/Color:\s*(.*?)\s+Steering:/i)?.[1]);
  const auctionGrade = text(plain.match(/Auc\. Grade:\s*(.*?)\s+Status:/i)?.[1]);
  const statusText = text(plain.match(/Status:\s*(.*?)\s+Time:/i)?.[1]);
  const date = text(plain.match(/Date:\s*((?:19|20)\d{2}-\d{2}-\d{2})/i)?.[1]);
  if (!JP_MAKES.includes(maker) || !model || !year || !lotNumber || year < 1990 || year > new Date().getFullYear() + 1) return null;
  if (engineCc != null && (engineCc < 300 || engineCc > 10_000)) return null;
  if (mileageKm != null && mileageKm > 800_000) return null;
  return { id: detailUrl.match(/\/auction\/detail\/(\d+)/i)?.[1] || `${date}-${location}-${lotNumber}-${maker}-${model}`, lotNumber, maker, model, grade, modelCode, year, mileageKm, engineCc, startPrice: startPrice && startPrice >= 50_000 ? startPrice : undefined, transmission, color, auctionGrade, status: /sold|finished|closed/i.test(statusText) ? "sold" : "active", location, date, detailUrl, images: imageUrls(html, detailUrl) };
}

function parseListingRows(html: string, searchUrl: string) {
  const rows: any[] = [];
  const candidates = html.match(/<tr\b[\s\S]*?<\/tr>/gi) || [];
  for (const row of candidates) {
    const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => stripHtml(match[1])).filter(Boolean);
    if (cells.length < 4) continue;
    const plain = cells.join(" | ");
    const maker = normalizeMaker(makerFrom(plain));
    const year = Number(plain.match(/\b(?:19|20)\d{2}\b/)?.[0]);
    if (!maker || !year || year < 1990 || year > new Date().getFullYear() + 1) continue;
    if (/OTHER TECHNICS|MOTORBIKE|GENERATOR|FORKLIFT|EXCAVATOR/i.test(plain)) continue;

    const makerCellIndex = cells.findIndex((cell) => makerFrom(cell) === maker || normalizeMaker(makerFrom(cell)) === maker);
    const makerCell = makerCellIndex >= 0 ? cells[makerCellIndex] : plain;
    let model = text(makerCell.replace(new RegExp(maker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), "").replace(/\b(?:19|20)\d{2}\b/g, " ").replace(/\bYear:?\s*/gi, " "));
    if (!model && makerCellIndex >= 0) model = text(cells[makerCellIndex + 1]);
    model = model.split(/\s+/).slice(0, 7).join(" ");
    if (!model || /^[0-9 .-]+$/.test(model)) continue;

    const detailHref = row.match(/href\s*=\s*["']([^"']*\/auction\/detail\/\d+[^"']*)["']/i)?.[1] || "";
    const detailUrl = detailHref ? absoluteUrl(detailHref, searchUrl) : searchUrl;
    const date = text(plain.match(/\b((?:19|20)\d{2}-\d{2}-\d{2})\b/)?.[1]);
    const location = text(plain.match(/\b(?:Location:?\s*)?([A-Za-z][A-Za-z .'-]{2,25})\s+(?:Lot\s*No\.?\s*)?\d{1,6}\b/i)?.[1]);
    const lotNumber = text(plain.match(/Lot\s*No\.?:?\s*(\d{1,6})/i)?.[1]) || cells.map((cell) => cell.match(/^\d{2,6}$/)?.[0]).filter((value) => value && Number(value) !== year).at(-1) || "";
    const engineCc = integer(plain.match(/([0-9,]{3,5})\s*cc/i)?.[1]);
    const mileageKm = integer(plain.match(/([0-9,]{1,8})\s*(?:KM|km)/)?.[1]);
    const startPrice = integer(plain.match(/(?:Start(?:\s*Price)?|Start:)\s*¥?\s*([0-9,]+)/i)?.[1]);
    const transmission = text(plain.match(/\b(?:Shift|Transmission):?\s*([A-Z0-9-]{1,8})/i)?.[1]);
    const auctionGrade = text(plain.match(/(?:Auc\.?\s*Grade|Auction\s*Grade):?\s*([0-9A-Z.+-]+)/i)?.[1]);
    const statusText = text(plain.match(/\b(available|sold|finished|closed)\b/i)?.[1]);
    const id = detailUrl.match(/\/auction\/detail\/(\d+)/i)?.[1] || `${date}-${location}-${lotNumber}-${maker}-${model}`;
    rows.push({ id, lotNumber, maker, model, grade: "", modelCode: "", year, mileageKm, engineCc, startPrice: startPrice && startPrice >= 50_000 ? startPrice : undefined, transmission, color: "", auctionGrade, status: /sold|finished|closed/i.test(statusText) ? "sold" : "active", location, date, detailUrl, images: imageUrls(row, searchUrl) });
  }
  return rows;
}

function lotNumbers(page: number) {
  const base = (Math.max(1, page) - 1) * 120;
  const sequential = Array.from({ length: 120 }, (_, index) => base + index + 1);
  const activeRanges = [500, 800, 1000, 1500, 2000, 2500, 3000, 5000, 8000, 10000, 15000, 20000, 30000, 50000, 60000, 80000, 90000].map((value) => value + page - 1);
  return unique([...sequential, ...activeRanges]).join(",");
}

export class JpaucJapanAdapter implements CatalogSourceAdapter {
  sourceId = "jpauc_japan";
  market = "japan" as const;
  accessMode = "public_html" as const;

  async fetchPage(cursor?: string | null): Promise<CatalogFetchResult> {
    const page = Math.max(1, Number(cursor || 1));
    const searchUrl = new URL("https://jpauc.com/auction/search");
    searchUrl.searchParams.set("lots", lotNumbers(page));
    searchUrl.searchParams.set("submit", "submitlot");
    const listing = await requestHtml(searchUrl.toString(), "https://jpauc.com/auction");
    if (!listing.response.ok) throw new Error(`jpauc_search_http_${listing.response.status}`);

    const rowsById = new Map<string, any>();
    for (const row of parseListingRows(listing.html, searchUrl.toString())) rowsById.set(row.id, row);
    const detailUrls = unique([
      ...[...listing.html.matchAll(/href\s*=\s*["']([^"']*\/auction\/detail\/\d+[^"']*)["']/gi)].map((match) => absoluteUrl(match[1], searchUrl.toString())),
      ...[...listing.html.matchAll(/https?:\\?\/\\?\/[^"'\\\s<>]*\/auction\/detail\/\d+[^"'\\\s<>]*/gi)].map((match) => absoluteUrl(match[0], searchUrl.toString())),
    ]).slice(0, 40);

    for (let index = 0; index < detailUrls.length; index += 5) {
      const details = await Promise.all(detailUrls.slice(index, index + 5).map(async (url) => {
        const result = await requestHtml(url, searchUrl.toString()).catch(() => null);
        return result?.response.ok ? parseDetail(result.html, url) : null;
      }));
      for (const row of details.filter(Boolean) as any[]) rowsById.set(row.id, row);
    }

    const rows = [...rowsById.values()].filter((row) => row.status === "active" && row.startPrice && row.images.length > 0);
    if (!rows.length) throw new Error(`jpauc_parsed_zero_status_${listing.response.status}_bytes_${listing.html.length}`);
    return { items: rows, nextCursor: String(page + 1), finished: false, count: rows.length, health: { ok: true, message: `JPAuc public lots: parsed ${rows.length}`, checkedAt: new Date().toISOString(), httpStatus: listing.response.status, contentType: listing.response.headers.get("content-type") || "" } };
  }

  mapStatus(raw: any): OfferStatus { return raw?.status === "sold" ? "sold" : "active"; }

  normalizeOffer(raw: any): VehicleOffer | null {
    if (!raw?.id || !raw?.maker || !raw?.model || !raw?.year || !raw?.detailUrl || !raw?.startPrice) return null;
    const now = new Date().toISOString();
    return normalizeVehicleOfferSpecs({
      id: stableOfferId(this.sourceId, raw.id), sourceId: this.sourceId, sourceOfferId: raw.id, market: "japan", offerType: "auction", status: this.mapStatus(raw),
      make: raw.maker, model: raw.model, trim: [raw.grade, raw.modelCode, raw.auctionGrade ? `grade ${raw.auctionGrade}` : ""].filter(Boolean).join(" "),
      year: raw.year, productionDate: raw.date, mileageKm: raw.mileageKm, engineCc: raw.engineCc, transmission: raw.transmission, color: raw.color,
      auctionName: raw.location, auctionDate: raw.date, lotNumber: raw.lotNumber, auctionGrade: raw.auctionGrade,
      sourcePrice: raw.startPrice, sourceCurrency: "JPY", priceMode: "auction_start", images: [], totalRub: null,
      calculationStatus: "auction_start", firstSeenAt: now, updatedAt: now,
      operational: { sourceUrl: raw.detailUrl, sourceVenueName: [raw.location, raw.lotNumber ? `lot ${raw.lotNumber}` : ""].filter(Boolean).join(" · "), raw },
    } as VehicleOffer);
  }

  async fetchImages(offer: VehicleOffer): Promise<CatalogImage[]> {
    const raw = (offer.operational.raw || {}) as any;
    let urls = Array.isArray(raw.images) ? raw.images.map(String) : [];
    if (/\/auction\/detail\/\d+/i.test(raw.detailUrl || "")) {
      const detail = await requestHtml(raw.detailUrl, "https://jpauc.com/auction").catch(() => null);
      if (detail?.response.ok) urls = unique([...urls, ...imageUrls(detail.html, raw.detailUrl)]);
    }
    const saved: CatalogImage[] = [];
    const limit = Math.max(1, Number(process.env.CATALOG_MAX_IMAGES_PER_OFFER || 10));
    for (const url of urls.slice(0, limit)) {
      const image = await cacheImageFromUrl(url, "japan", { headers: { ...HEADERS, referer: raw.detailUrl || "https://jpauc.com/auction" } }).catch(() => null);
      if (!image || image.size < 8_000) continue;
      saved.push(image);
    }
    return saved;
  }

  async healthCheck() { return { ok: true, message: "JPAuc is checked during public-lot import", checkedAt: new Date().toISOString() }; }
}

export const jpaucJapanSource = new JpaucJapanAdapter();
