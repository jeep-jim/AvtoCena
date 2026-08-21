import type { CatalogFetchResult, CatalogImage, CatalogSourceAdapter, OfferStatus, SourceRunHealth, VehicleOffer } from "./types";

type JpaucRawRow = {
  dataId: string;
  r: string;
  rtotal: string;
  date: string;
  location: string;
  lot: string;
  maker: string;
  model: string;
  year: number;
  grade: string;
  engineCc?: number;
  modelCode: string;
  shift: string;
  mileageKm?: number;
  color: string;
  auctionGrade: string;
  sourceStatus: string;
  startPrice: number;
  listingImage: string;
  detailUrl: string;
};

const BASE = "https://jpauc.com";
const PAST = `${BASE}/auction/past`;
const REQUEST_HEADERS = {
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9,ja;q=0.8",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
};
const BAD_IMAGE_RE = /logo|favicon|icon|sprite|banner|bnr|campaign|promo|promotion|advert|avatar|tracking|pixel|cookie|qrcode|qr-code|no[-_ ]?photo|no[-_ ]?image|thumb(?:nail)?|seller|dealer|recommend|related|similar/i;

function clean(value: unknown) {
  return String(value ?? "")
    .replace(/&quot;/gi, '"')
    .replace(/&#039;|&apos;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function lines(html: string) {
  return html.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ").split(/\n+/).map(clean).filter(Boolean);
}
function cellText(html: string) { return clean(html.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " ")); }
function money(value: unknown) { const parsed = Number(String(value ?? "").replace(/[^0-9]/g, "")); return Number.isFinite(parsed) && parsed > 0 ? parsed : 0; }
function numeric(value: unknown) { const parsed = Number(String(value ?? "").replace(/[^0-9.]/g, "")); return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined; }
function checkboxValues(html: string, name: string) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...html.matchAll(new RegExp(`name=["']${escaped}["'][^>]*value=["']([^"']+)["']`, "gi"))].map((match) => match[1]);
}
function remoteImage(url: string): CatalogImage { return { id: "", url, objectKey: "", checksum: "", size: 0, mimeType: "image/jpeg" }; }
function safeImageUrl(value: string, baseUrl = BASE) {
  try {
    const url = new URL(String(value || "").replace(/&amp;/g, "&"), baseUrl);
    if (!/^https?:$/i.test(url.protocol) || BAD_IMAGE_RE.test(url.toString())) return "";
    return url.toString();
  } catch { return ""; }
}

/**
 * JPAuc listing thumbnails are backed by the auction image service itself.
 * The `number` parameter addresses additional photos of that same listing.
 * We intentionally derive gallery URLs only from the listing-bound URL instead
 * of scraping arbitrary images from the detail page: a shared CDN host is not
 * sufficient evidence that another image belongs to this auction lot.
 */
function photoVariants(value: string) {
  if (!value) return [];
  try {
    const base = new URL(value, BASE);
    if (!/(?:^|\.)aleado\.com$/i.test(base.hostname)) return [base.toString()];
    base.protocol = "https:";
    const result: string[] = [];
    for (const number of [0, 1, 2]) {
      const image = new URL(base.toString());
      image.searchParams.set("number", String(number));
      if (number > 0) image.searchParams.set("h", "1280");
      else image.searchParams.delete("h");
      const safe = safeImageUrl(image.toString());
      if (safe) result.push(safe);
    }
    return result;
  } catch { return []; }
}

function parseListingRows(html: string): JpaucRawRow[] {
  const rows: JpaucRawRow[] = [];
  for (const match of html.matchAll(/<tr\b([^>]*)data-id=["'](\d+)["']([^>]*)>([\s\S]*?)<\/tr>/gi)) {
    const attrs = `${match[1]} data-id="${match[2]}" ${match[3]}`;
    const rowHtml = match[0];
    const cells = [...rowHtml.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) => cell[1]);
    if (cells.length < 10) continue;
    const makerModel = lines(cells[4]).filter((value) => value !== "|");
    const locationText = cellText(cells[3]);
    const yearText = cellText(cells[5]);
    const ccText = cellText(cells[6]);
    const shiftText = cellText(cells[7]);
    const colorText = cellText(cells[8]);
    const statusText = cellText(cells[9]);
    const [location = "", lot = ""] = locationText.split("|").map(clean);
    const year = Number(yearText.match(/(?:19|20)\d{2}/)?.[0] || 0);
    const grade = clean(yearText.replace(/^.*?Year:\s*(?:19|20)\d{2}\s*/i, ""));
    const engineCc = numeric(ccText.match(/([0-9,]+)\s*cc/i)?.[1]);
    const modelCode = clean(ccText.split("|").slice(1).join("|"));
    const shift = clean(shiftText.split("|")[0]);
    const mileageKm = numeric(shiftText.match(/([0-9,]+)\s*KM/i)?.[1]);
    const color = clean(colorText.match(/Color:\s*(.*?)\s*Auc\.Grade:/i)?.[1]);
    const auctionGrade = clean(colorText.match(/Auc\.Grade:\s*(.+)$/i)?.[1]);
    const sourceStatus = clean(statusText.match(/Status:\s*(.*?)\s*(?:\||Start:)/i)?.[1]);
    const startPrice = money(statusText.match(/Start:\s*¥?\s*([0-9,]+)/i)?.[1]);
    const listingImageRaw = rowHtml.match(/data-original=["']([^"']+)["']/i)?.[1] || rowHtml.match(/src=["']([^"']+)["']/i)?.[1] || "";
    const listingImage = safeImageUrl(listingImageRaw);
    const dataId = match[2];
    const r = attrs.match(/data-r=["']([^"']+)["']/i)?.[1] || "1";
    const rtotal = attrs.match(/data-r-total=["']([^"']+)["']/i)?.[1] || "1";
    const detailUrl = `${PAST}/detail/${encodeURIComponent(dataId)}?&ys=2010&ye=2100&mm=0&mx=9999&p=1&ob=none&r=0&r=${encodeURIComponent(r)}&rtotal=${encodeURIComponent(rtotal)}`;
    if (!dataId || !makerModel[0] || !makerModel[1] || !year) continue;
    rows.push({ dataId, r, rtotal, date: cellText(cells[2]), location, lot, maker: clean(makerModel[0]), model: clean(makerModel[1]), year, grade, engineCc, modelCode, shift, mileageKm, color, auctionGrade, sourceStatus, startPrice, listingImage, detailUrl });
  }
  return rows;
}
function listingTotal(html: string, fallback = 0) { return Number(html.match(/\d+\s*-\s*\d+\s+of\s+([0-9,]+)/i)?.[1]?.replace(/,/g, "") || fallback); }

export class JpaucPastAdapter implements CatalogSourceAdapter {
  sourceId = "jpauc_japan_past_open";
  market = "japan" as const;
  accessMode = "public_html" as const;
  private cookie = "";
  private selectedDates: string[] = [];
  private listingUrl = `${PAST}/listing-2`;
  private firstListingHtml = "";
  private totalCount = 0;
  private ready = false;

  private async request(url: string, options: { method?: string; body?: string; referer?: string } = {}) {
    const response = await fetch(url, {
      method: options.method || "GET", body: options.body, redirect: "follow",
      headers: { ...REQUEST_HEADERS, ...(this.cookie ? { cookie: this.cookie } : {}), ...(options.referer ? { referer: options.referer } : {}), ...(options.method === "POST" ? { "content-type": "application/x-www-form-urlencoded", origin: BASE } : {}) },
      signal: AbortSignal.timeout(Math.max(5_000, Number(process.env.CATALOG_SOURCE_REQUEST_TIMEOUT_MS || 30_000))),
    });
    if (!response.ok) throw new Error(`jpauc_http_${response.status}:${url}`);
    if (!this.cookie) this.cookie = String(response.headers.get("set-cookie") || "").split(";")[0];
    return { response, html: await response.text() };
  }

  private async ensureReady() {
    if (this.ready) return;
    const initial = await this.request(PAST, { referer: `${BASE}/auction` });
    const dates = [...new Set(checkboxValues(initial.html, "checkdate[]"))];
    this.selectedDates = dates.slice(0, Math.max(1, Number(process.env.CATALOG_JAPAN_AUCTION_DATES_PER_RUN || 31)));
    if (!this.selectedDates.length) throw new Error("jpauc_no_past_date");
    const dateBody = new URLSearchParams();
    for (const date of this.selectedDates) dateBody.append("checkdate[]", date);
    dateBody.append("submit", "submitauction");
    const maker = await this.request(PAST, { method: "POST", body: dateBody.toString(), referer: PAST });
    const makers = checkboxValues(maker.html, "mk[]");
    if (!makers.length) throw new Error("jpauc_no_makers");
    const makerBody = new URLSearchParams(); makers.forEach((value) => makerBody.append("mk[]", value));
    const model = await this.request(maker.response.url, { method: "POST", body: makerBody.toString(), referer: maker.response.url });
    const models = checkboxValues(model.html, "md[]");
    if (!models.length) throw new Error("jpauc_no_models");
    const modelBody = new URLSearchParams(); models.forEach((value) => modelBody.append("md[]", value));
    const listing = await this.request(model.response.url, { method: "POST", body: modelBody.toString(), referer: model.response.url });
    this.listingUrl = listing.response.url;
    this.firstListingHtml = listing.html;
    this.totalCount = listingTotal(listing.html, parseListingRows(listing.html).length);
    this.ready = true;
  }

  async fetchPage(cursor?: string | null): Promise<CatalogFetchResult> {
    await this.ensureReady();
    const page = Math.max(1, Number(cursor || 1));
    const currentYear = new Date().getFullYear();
    const filteredUrl = new URL(this.listingUrl);
    filteredUrl.searchParams.set("ys", "2010");
    filteredUrl.searchParams.set("ye", String(currentYear));
    filteredUrl.searchParams.set("mm", "0");
    filteredUrl.searchParams.set("mx", "9999");
    filteredUrl.searchParams.set("start_price_from", "1");
    filteredUrl.searchParams.set("p", String(page));
    filteredUrl.searchParams.set("ob", "y_l");
    const filtered = await this.request(filteredUrl.toString(), { referer: this.listingUrl });
    let html = filtered.html;
    let items = parseListingRows(html);
    let total = listingTotal(html, items.length);
    let httpStatus = filtered.response.status;
    let mode = "month_2010_plus";
    if (!items.length && total > 0) {
      mode = "session_fallback";
      if (page === 1) html = this.firstListingHtml;
      else {
        const fallbackUrl = new URL(this.listingUrl); fallbackUrl.searchParams.set("p", String(page));
        const fallback = await this.request(fallbackUrl.toString(), { referer: this.listingUrl });
        html = fallback.html; httpStatus = fallback.response.status;
      }
      items = parseListingRows(html);
      total = listingTotal(html, this.totalCount || items.length);
    }
    if (total > 0) this.totalCount = total;
    const pageSize = 10;
    const finished = items.length === 0 || page * pageSize >= total;
    return { items, count: total, finished, nextCursor: finished ? null : String(page + 1), health: { ok: items.length > 0 || finished, message: `jpauc_past:${mode}:${items.length}/${total}:dates=${this.selectedDates.length}`, checkedAt: new Date().toISOString(), httpStatus } };
  }

  normalizeOffer(raw: unknown): VehicleOffer | null {
    const row = raw as JpaucRawRow;
    if (!row?.dataId || !row.maker || !row.model || !row.year || !row.startPrice) return null;
    const now = new Date().toISOString();
    const sourceTitle = [row.maker, row.model, row.grade].filter(Boolean).join(" ");
    return {
      id: `${this.sourceId}:${row.dataId}`, sourceId: this.sourceId, sourceOfferId: row.dataId, market: "japan", offerType: "auction", status: "active", catalogKind: "auction_result", sourceTitle,
      make: row.maker, model: row.model, trim: row.grade || undefined, year: row.year, mileageKm: row.mileageKm, engineCc: row.engineCc, transmission: row.shift || undefined, color: row.color || undefined,
      auctionName: row.location || undefined, auctionDate: row.date || undefined, lotNumber: row.lot || undefined, auctionGrade: row.auctionGrade || undefined,
      sourcePrice: row.startPrice, sourceCurrency: "JPY", priceMode: "auction_start", images: row.listingImage ? photoVariants(row.listingImage).map(remoteImage) : [], calculationStatus: "auction_start", firstSeenAt: now, updatedAt: now,
      operational: { sourceUrl: row.detailUrl, sourceVenueName: row.location || "JPAuc", sourcePublishedAt: row.date || undefined, sourceTitle, raw: row, sourceStatus: row.sourceStatus, modelCode: row.modelCode, galleryStoredAs: "json_urls", galleryIdentity: "listing_bound_variants", minimumImages: 2, historicalAuction: true },
    };
  }

  async fetchImages(offer: VehicleOffer): Promise<CatalogImage[]> {
    const raw = offer.operational?.raw as JpaucRawRow | undefined;
    const max = Math.min(30, Math.max(2, Number(process.env.CATALOG_MAX_IMAGES_PER_OFFER || 30)));
    const listingImage = safeImageUrl(raw?.listingImage || "");
    // Fail closed: a shared image host does not prove lot identity. Only URLs
    // derived from this exact listing image are allowed for JPAuc.
    return photoVariants(listingImage).slice(0, max).map(remoteImage);
  }

  mapStatus(): OfferStatus { return "active"; }
  async healthCheck(): Promise<SourceRunHealth> {
    try {
      const response = await fetch(PAST, { headers: REQUEST_HEADERS, redirect: "follow", signal: AbortSignal.timeout(20_000) });
      return { ok: response.ok, message: response.ok ? "jpauc_past_ok" : `jpauc_past_http_${response.status}`, checkedAt: new Date().toISOString(), httpStatus: response.status };
    } catch (error) { return { ok: false, message: String((error as Error)?.message || error), checkedAt: new Date().toISOString() }; }
  }
}

export const jpaucPastSource = new JpaucPastAdapter();