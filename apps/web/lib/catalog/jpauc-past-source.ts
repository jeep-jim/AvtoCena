import type { CatalogFetchResult, CatalogImage, CatalogSourceAdapter, OfferStatus, SourceRunHealth, VehicleOffer } from "./types";

export type JpaucRawRow = {
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
  semanticEvidence: JpaucSpecificationEvidence;
};

type JpaucEvidenceStatus = "exact" | "ambiguous" | "conflict" | "missing";
type JpaucMetricEvidence = { value?: number; rawValues: string[]; status: JpaucEvidenceStatus };
type JpaucMissingEvidence = { rawValues: string[]; status: "missing" };
export type JpaucSpecificationEvidence = {
  year: JpaucMetricEvidence;
  fuel: JpaucMissingEvidence;
  engineCc: JpaucMetricEvidence;
  powerHp: JpaucMissingEvidence;
  powerKw: JpaucMissingEvidence;
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

function jpaucYearEvidence(value: unknown): JpaucMetricEvidence {
  const raw = clean(value);
  const rawValues = raw ? [raw] : [];
  const maximum = new Date().getUTCFullYear() + 1;
  const years = [...raw.matchAll(/\b((?:19|20)\d{2})\b/g)]
    .map((match) => Number(match[1]))
    .filter((year) => year >= 1900 && year <= maximum);
  const unique = [...new Set(years)];
  if (!unique.length) return { rawValues, status: "missing" };
  if (unique.length !== 1) return { rawValues, status: "conflict" };
  return { value: unique[0], rawValues, status: "exact" };
}

function jpaucEngineCcEvidence(value: unknown): JpaucMetricEvidence {
  const raw = clean(value);
  const rawValues = raw ? [raw] : [];
  if (!raw) return { rawValues, status: "missing" };
  if (/(?:\d[\d,]*)\s*(?:-|–|—|~|～|to|至|到)\s*(?:\d[\d,]*)\s*cc\b/i.test(raw)) {
    return { rawValues, status: "ambiguous" };
  }
  const tokens = [...raw.matchAll(/\b(\d[\d,]*)\s*cc\b/gi)].map((match) => match[1]);
  if (!tokens.length) return { rawValues, status: "missing" };
  const values = tokens.map((token) => Number(token.replace(/,/g, "")));
  if (values.some((engineCc) => !Number.isInteger(engineCc) || engineCc < 300 || engineCc > 10_000)) {
    return { rawValues, status: "ambiguous" };
  }
  const unique = [...new Set(values)];
  if (unique.length !== 1) return { rawValues, status: "conflict" };
  return { value: unique[0], rawValues, status: "exact" };
}

export function jpaucSpecificationEvidence(input: { yearText?: unknown; engineText?: unknown }): JpaucSpecificationEvidence {
  const missing = (): JpaucMissingEvidence => ({ rawValues: [], status: "missing" });
  return {
    year: jpaucYearEvidence(input.yearText),
    fuel: missing(),
    engineCc: jpaucEngineCcEvidence(input.engineText),
    powerHp: missing(),
    powerKw: missing(),
  };
}
export function jpaucCheckboxValues(html: string, name: string) {
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
function lotImageHost(listingImage: string) {
  try { return new URL(listingImage).hostname.toLowerCase(); } catch { return ""; }
}
function isSameLotImageHost(value: string, listingImage: string, baseUrl: string) {
  const candidate = safeImageUrl(value, baseUrl);
  if (!candidate) return "";
  const expectedHost = lotImageHost(listingImage);
  if (!expectedHost) return candidate;
  try {
    const host = new URL(candidate).hostname.toLowerCase();
    const expectedAleado = /(?:^|\.)aleado\.com$/i.test(expectedHost);
    const candidateAleado = /(?:^|\.)aleado\.com$/i.test(host);
    if (expectedAleado) return candidateAleado ? candidate : "";
    return host === expectedHost ? candidate : "";
  } catch { return ""; }
}
export function jpaucPhotoVariants(value: string) {
  if (!value) return [];
  try {
    const base = new URL(value, BASE);
    if (!/(?:^|\.)aleado\.com$/i.test(base.hostname)) return [base.toString()];
    base.protocol = "https:";
    const result: string[] = [];
    // Aleado number=0 is the auction inspection sheet, while 1 and 2 are the
    // listing-bound vehicle photos. Keep the sheet as supporting evidence, but
    // never make it the customer-facing cover.
    for (const number of [1, 2, 0]) {
      const image = new URL(base.toString());
      image.searchParams.set("number", String(number));
      if (number > 0) image.searchParams.set("h", "1280");
      else image.searchParams.delete("h");
      result.push(image.toString());
    }
    return result;
  } catch { return []; }
}

export function jpaucIdentityGalleryEvidence(raw: JpaucRawRow) {
  const dataId = clean(raw?.dataId);
  const detailUrl = clean(raw?.detailUrl);
  const images = jpaucPhotoVariants(clean(raw?.listingImage));
  const imageIdentityMatches = images.length === 3 && images.every((value) => {
    try {
      const url = new URL(value);
      const bid = clean(url.searchParams.get("bid")).replace(/^0+/, "") || "0";
      const lot = clean(raw?.lot).replace(/^0+/, "") || "0";
      return /(?:^|\.)aleado\.com$/i.test(url.hostname)
        && url.searchParams.get("system") === "auto"
        && url.searchParams.get("date") === clean(raw?.date)
        && Boolean(url.searchParams.get("auct"))
        && bid === lot;
    } catch {
      return false;
    }
  });
  const ok = Boolean(
    /^\d+$/.test(dataId)
      && /^\d{4}-\d{2}-\d{2}$/.test(clean(raw?.date))
      && clean(raw?.location)
      && clean(raw?.lot)
      && clean(raw?.maker)
      && clean(raw?.model)
      && Number(raw?.year || 0) >= 2011
      && Number(raw?.year || 0) <= new Date().getUTCFullYear() + 1
      && detailUrl.startsWith(`${PAST}/detail/${encodeURIComponent(dataId)}`)
      && imageIdentityMatches,
  );
  return { ok, imageCount: images.length, priceAvailable: Number(raw?.startPrice || 0) > 0 };
}

export function parseJpaucListingRows(html: string): JpaucRawRow[] {
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
    const semanticEvidence = jpaucSpecificationEvidence({ yearText, engineText: ccText });
    const year = semanticEvidence.year.status === "exact" ? semanticEvidence.year.value || 0 : 0;
    const grade = clean(yearText.replace(/^.*?Year:\s*(?:19|20)\d{2}\s*/i, ""));
    const engineCc = semanticEvidence.engineCc.status === "exact" ? semanticEvidence.engineCc.value : undefined;
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
    rows.push({ dataId, r, rtotal, date: cellText(cells[2]), location, lot, maker: clean(makerModel[0]), model: clean(makerModel[1]), year, grade, engineCc, modelCode, shift, mileageKm, color, auctionGrade, sourceStatus, startPrice, listingImage, detailUrl, semanticEvidence });
  }
  return rows;
}
export function jpaucListingTotal(html: string, fallback = 0) { return Number(html.match(/\d+\s*-\s*\d+\s+of\s+([0-9,]+)/i)?.[1]?.replace(/,/g, "") || fallback); }

export class JpaucPastAdapter implements CatalogSourceAdapter {
  sourceId = "jpauc_japan_past_open";
  market = "japan" as const;
  accessMode = "public_html" as const;
  readinessRole = "identity_gallery_after_exact_price_join";
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
    const dates = [...new Set(jpaucCheckboxValues(initial.html, "checkdate[]"))];
    this.selectedDates = dates.slice(0, Math.max(1, Number(process.env.CATALOG_JAPAN_AUCTION_DATES_PER_RUN || 31)));
    if (!this.selectedDates.length) throw new Error("jpauc_no_past_date");
    const dateBody = new URLSearchParams();
    for (const date of this.selectedDates) dateBody.append("checkdate[]", date);
    dateBody.append("submit", "submitauction");
    const maker = await this.request(PAST, { method: "POST", body: dateBody.toString(), referer: PAST });
    const makers = jpaucCheckboxValues(maker.html, "mk[]");
    if (!makers.length) throw new Error("jpauc_no_makers");
    const makerBody = new URLSearchParams(); makers.forEach((value) => makerBody.append("mk[]", value));
    const model = await this.request(maker.response.url, { method: "POST", body: makerBody.toString(), referer: maker.response.url });
    const models = jpaucCheckboxValues(model.html, "md[]");
    if (!models.length) throw new Error("jpauc_no_models");
    const modelBody = new URLSearchParams(); models.forEach((value) => modelBody.append("md[]", value));
    const listing = await this.request(model.response.url, { method: "POST", body: modelBody.toString(), referer: model.response.url });
    this.listingUrl = listing.response.url;
    this.firstListingHtml = listing.html;
    this.totalCount = jpaucListingTotal(listing.html, parseJpaucListingRows(listing.html).length);
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
    let items = parseJpaucListingRows(html);
    let total = jpaucListingTotal(html, items.length);
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
      items = parseJpaucListingRows(html);
      total = jpaucListingTotal(html, this.totalCount || items.length);
    }
    if (total > 0) this.totalCount = total;
    const pageSize = 10;
    const finished = items.length === 0 || page * pageSize >= total;
    return { items, count: total, finished, nextCursor: finished ? null : String(page + 1), health: { ok: items.length > 0 || finished, message: `jpauc_past:${mode}:${items.length}/${total}:dates=${this.selectedDates.length}`, checkedAt: new Date().toISOString(), httpStatus } };
  }

  validateReadinessEvidence(raw: unknown) {
    return jpaucIdentityGalleryEvidence(raw as JpaucRawRow).ok;
  }

  normalizeOffer(raw: unknown): VehicleOffer | null {
    const row = raw as JpaucRawRow;
    if (!row?.dataId || !row.maker || !row.model || !row.year || !row.startPrice) return null;
    const now = new Date().toISOString();
    const sourceTitle = [row.maker, row.model, row.grade].filter(Boolean).join(" ");
    const semanticEvidence = row.semanticEvidence || jpaucSpecificationEvidence({
      yearText: row.year,
      engineText: row.engineCc ? `${row.engineCc} cc` : undefined,
    });
    return {
      id: `${this.sourceId}:${row.dataId}`, sourceId: this.sourceId, sourceOfferId: row.dataId, market: "japan", offerType: "auction", status: "active", catalogKind: "auction_result", sourceTitle,
      make: row.maker, model: row.model, trim: row.grade || undefined, year: row.year, mileageKm: row.mileageKm, engineCc: semanticEvidence.engineCc.status === "exact" ? semanticEvidence.engineCc.value : undefined, transmission: row.shift || undefined, color: row.color || undefined,
      auctionName: row.location || undefined, auctionDate: row.date || undefined, lotNumber: row.lot || undefined, auctionGrade: row.auctionGrade || undefined,
      sourcePrice: row.startPrice, sourceCurrency: "JPY", priceMode: "auction_start", images: row.listingImage ? jpaucPhotoVariants(row.listingImage).map(remoteImage) : [], calculationStatus: "auction_start", firstSeenAt: now, updatedAt: now,
      operational: {
        sourceUrl: row.detailUrl, sourceVenueName: row.location || "JPAuc", sourcePublishedAt: row.date || undefined, sourceTitle, raw: row, sourceStatus: row.sourceStatus, modelCode: row.modelCode, galleryStoredAs: "json_urls", minimumImages: 3, historicalAuction: true,
        semanticEvidence: {
          year: { source: "jpauc_past_listing_year", ...semanticEvidence.year },
          fuel: { source: "jpauc_source_missing", ...semanticEvidence.fuel },
          engineCc: { source: "jpauc_past_listing_cc", ...semanticEvidence.engineCc },
          powerHp: { source: "jpauc_source_missing", ...semanticEvidence.powerHp },
          powerKw: { source: "jpauc_source_missing", ...semanticEvidence.powerKw },
        },
      },
    };
  }

  async fetchImages(offer: VehicleOffer): Promise<CatalogImage[]> {
    const raw = offer.operational?.raw as JpaucRawRow | undefined;
    const max = Math.min(30, Math.max(2, Number(process.env.CATALOG_MAX_IMAGES_PER_OFFER || 30)));
    const listingImage = raw?.listingImage || "";
    const urls = new Set(jpaucPhotoVariants(listingImage).map((url) => safeImageUrl(url)).filter(Boolean));
    const sourceUrl = String(raw?.detailUrl || offer.operational?.sourceUrl || "");
    if (sourceUrl && urls.size < max) {
      try {
        const detail = await this.request(sourceUrl, { referer: this.listingUrl });
        for (const match of detail.html.matchAll(/<(?:img|source)[^>]+(?:data-original|data-lazy-src|data-src|src)\s*=\s*["']([^"']+)["']/gi)) {
          const url = isSameLotImageHost(match[1], listingImage, sourceUrl);
          if (url) urls.add(url);
          if (urls.size >= max) break;
        }
        if (urls.size < max) {
          for (const match of detail.html.matchAll(/https?:\\?\/\\?\/[^"'\\\s<>]+?\.(?:jpe?g|png|webp|avif)(?:\?[^"'\\\s<>]*)?/gi)) {
            const url = isSameLotImageHost(match[0].replace(/\\\//g, "/"), listingImage, sourceUrl);
            if (url) urls.add(url);
            if (urls.size >= max) break;
          }
        }
      } catch {
        // Keep the verified listing URLs. Gallery failure must not substitute unrelated images.
      }
    }
    return [...urls].slice(0, max).map(remoteImage);
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
