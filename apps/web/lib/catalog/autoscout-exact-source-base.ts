import { canonicalSourceModelIdentity } from "./open-source-normalizer";
import { stableOfferId } from "./storage";
import type { CatalogFetchResult, CatalogImage, CatalogSourceAdapter, OfferStatus, VehicleOffer } from "./types";

const BASE_URL = "https://www.autoscout24.com";
const HEADERS = {
  accept: "text/html,application/xhtml+xml,application/json;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "accept-language": "en-GB,en;q=0.9,de;q=0.7",
  "cache-control": "no-cache",
  pragma: "no-cache",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
};

export type AutoScoutExactRow = {
  id: string; sourceUrl: string; title: string; make: string; model: string; trim: string; year: number;
  mileageKm?: number; engineCc?: number; powerKw?: number; powerHp?: number; fuel?: string; powertrainKind?: "electric";
  transmission?: string; drive?: string; bodyType?: string; price: number; currency: string; location?: string; images: string[]; raw: Record<string, unknown>;
};

function clean(value: unknown) { return String(value ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(); }
function integer(value: unknown) { const parsed = Number(clean(value).replace(/[^0-9]/g, "")); return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined; }
function absoluteUrl(value: unknown) { const raw = clean(value); if (!raw) return ""; try { return new URL(raw, BASE_URL).toString(); } catch { return ""; } }
function nextData(markup: string): Record<string, any> | null { const match = markup.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i); if (!match?.[1]) return null; try { return JSON.parse(match[1]); } catch { return null; } }
function detailValue(details: unknown, label: RegExp) { if (!Array.isArray(details)) return ""; const row = details.find((item) => label.test(clean((item as any)?.ariaLabel))); return clean((row as any)?.data); }
function parsePower(value: string) {
  const kw = Number(value.match(/([0-9]{1,4}(?:[.,][0-9]+)?)\s*kW/i)?.[1]?.replace(",", "."));
  const hp = Number(value.match(/([0-9]{1,4}(?:[.,][0-9]+)?)\s*(?:hp|ps)/i)?.[1]?.replace(",", "."));
  return { powerKw: Number.isFinite(kw) && kw > 0 ? Math.round(kw * 10) / 10 : undefined, powerHp: Number.isFinite(hp) && hp > 0 ? Math.round(hp) : undefined };
}
function parseYear(value: unknown) { const match = clean(value).match(/(?:^|[-/])((?:19|20)\d{2})(?:$|[-/])/) || clean(value).match(/\b((?:19|20)\d{2})\b/); return match ? Number(match[1]) : 0; }
function bodyFrom(value: Record<string, any>) { return clean(value?.vehicle?.bodyType || value?.vehicle?.category || value?.tracking?.bodyType || value?.bodyType); }
function driveFrom(value: Record<string, any>) { return clean(value?.vehicle?.drive || value?.vehicle?.driveType || value?.tracking?.drive || value?.drive); }

export function parseAutoScoutNextData(markup: string): AutoScoutExactRow[] {
  const data = nextData(markup);
  const listings = data?.props?.pageProps?.listings;
  if (!Array.isArray(listings)) return [];
  const rows: AutoScoutExactRow[] = [];
  const seen = new Set<string>();
  for (const listing of listings) {
    if (!listing || typeof listing !== "object") continue;
    const id = clean(listing.id), sourceUrl = absoluteUrl(listing.url), make = clean(listing.vehicle?.make), sourceModel = clean(listing.vehicle?.model);
    const trim = clean(listing.vehicle?.modelVersionInput || listing.vehicle?.variant || listing.vehicle?.motorTypeName);
    const sourceTitle = clean([make, sourceModel, trim].filter(Boolean).join(" "));
    const model = canonicalSourceModelIdentity(sourceTitle, make, sourceModel);
    const firstRegistration = clean(listing.tracking?.firstRegistration || detailValue(listing.vehicleDetails, /first registration/i));
    const year = parseYear(firstRegistration), price = Number(listing.price?.priceRaw || listing.tracking?.price || 0);
    const currency = clean(listing.price?.currency || listing.priceCurrency || data?.props?.pageProps?.currency || "EUR");
    const images = [...new Set<string>((Array.isArray(listing.images) ? listing.images : []).map((value: unknown) => absoluteUrl(value)).filter((url: string) => /^https?:\/\/prod\.pictures\.autoscout24\.net\/listing-images\//i.test(url)))];
    const detailPower = parsePower(detailValue(listing.vehicleDetails, /power/i));
    const title = sourceTitle;
    const mileageKm = integer(listing.tracking?.mileage || listing.vehicle?.mileageInKm || detailValue(listing.vehicleDetails, /mileage/i));
    const engineCc = integer(listing.vehicle?.engineDisplacementInCCM);
    const sourcePureElectric = /-electric-/i.test(sourceUrl) && !/-(?:gasoline|petrol|diesel)-|hybrid|phev|hev/i.test(sourceUrl);
    const fuel = clean(listing.vehicle?.fuel || detailValue(listing.vehicleDetails, /fuel/i) || (sourcePureElectric ? "Electric" : ""));
    const transmission = clean(listing.vehicle?.transmission || detailValue(listing.vehicleDetails, /gear/i));
    const location = clean([listing.location?.city, listing.location?.countryCode].filter(Boolean).join(", "));
    if (!id || seen.has(id) || !sourceUrl.includes("/offers/") || !make || !model || !year || !(price > 0) || !currency || images.length < 5) continue;
    seen.add(id);
    rows.push({ id, sourceUrl, title, make, model, trim, year, mileageKm, engineCc, ...detailPower, fuel, powertrainKind: sourcePureElectric ? "electric" : undefined,
      transmission, drive: driveFrom(listing), bodyType: bodyFrom(listing), price, currency, location, images: images.slice(0, 30), raw: listing });
  }
  return rows;
}

export class AutoScoutEuropeExactAdapter implements CatalogSourceAdapter {
  sourceId = "autoscout_europe_open";
  market = "europe" as const;
  accessMode = "public_html" as const;

  async fetchPage(cursor?: string | null): Promise<CatalogFetchResult> {
    const page = Math.max(1, Number(cursor || 1));
    const url = new URL("/lst", BASE_URL); url.searchParams.set("atype", "C"); url.searchParams.set("ustate", "N,U"); url.searchParams.set("page", String(page));
    const response = await fetch(url, { headers: HEADERS, redirect: "follow", signal: AbortSignal.timeout(Math.max(5_000, Number(process.env.CATALOG_SOURCE_TIMEOUT_MS || 30_000))) });
    const markup = await response.text();
    if (!response.ok) throw new Error(`autoscout_exact_http_${response.status}`);
    const items = parseAutoScoutNextData(markup);
    if (!items.length) throw new Error(`autoscout_exact_parsed_zero_status_${response.status}_bytes_${markup.length}`);
    return { items, nextCursor: String(page + 1), finished: false, count: items.length,
      health: { ok: true, message: `AutoScout24 exact Next data parsed ${items.length}`, checkedAt: new Date().toISOString(), httpStatus: response.status, contentType: response.headers.get("content-type") || "" } };
  }

  normalizeOffer(raw: unknown): VehicleOffer | null {
    const row = raw as AutoScoutExactRow;
    if (!row?.id || !row.make || !row.model || !row.year || !row.price || !row.sourceUrl) return null;
    const now = new Date().toISOString();
    return { id: stableOfferId(this.sourceId, row.id), sourceId: this.sourceId, sourceOfferId: row.id, market: "europe", offerType: "fixed", status: "active",
      sourceTitle: row.title, make: row.make, model: row.model, trim: row.trim, year: row.year, mileageKm: row.mileageKm, engineCc: row.engineCc, fuel: row.fuel,
      powertrainKind: row.powertrainKind, transmission: row.transmission, drive: row.drive, bodyType: row.bodyType, powerKw: row.powerKw, powerHp: row.powerHp,
      powerDataConfidence: row.powerKw || row.powerHp ? "source_exact" : undefined, powerDataSource: row.powerKw || row.powerHp ? "AutoScout24 vehicleDetails" : undefined,
      sourcePrice: row.price, sourceCurrency: row.currency, priceMode: "fixed", images: [], totalRub: null, calculationStatus: "needs_data", firstSeenAt: now, updatedAt: now,
      operational: { sourceUrl: row.sourceUrl, sourceVenueName: row.location || "AutoScout24 Europe", sourceTitle: row.title, exactDetail: false, exactFields: true, exactPhotos: false,
        galleryVerified: false, galleryImageCount: 0, gallerySafetyMode: "autoscout_exact_detail_pending_v2", galleryStoredAs: "json_urls", photoIdentityVerified: false,
        raw: { parsed: row, searchImages: row.images, listingBoundSearchImages: true, photoIdentityVerified: false, detailIdentityVerified: false } } };
  }

  async fetchImages(_offer: VehicleOffer): Promise<CatalogImage[]> { return []; }
  mapStatus(): OfferStatus { return "active"; }
  async healthCheck() { return { ok: true, message: "AutoScout24 exact __NEXT_DATA__ adapter", checkedAt: new Date().toISOString() }; }
}
