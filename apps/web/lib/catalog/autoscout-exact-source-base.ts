import { canonicalSourceModelIdentity } from "./open-source-normalizer";
import { canonicalSourceFuel } from "./powertrain-safety";
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
  mileageKm?: number; engineCc?: number; powerKw?: number; powerHp?: number; fuel?: string; powertrainKind?: "combustion" | "electric" | "series_hybrid" | "other_hybrid" | "unknown";
  transmission?: string; drive?: string; bodyType?: string; price: number; currency: string; location?: string; images: string[]; raw: Record<string, unknown>;
  semanticEvidence?: AutoScoutSpecificationEvidence;
};

type AutoScoutEvidenceStatus = "exact" | "ambiguous" | "conflict" | "missing";
type AutoScoutEvidence<T> = { value?: T; rawValues: string[]; status: AutoScoutEvidenceStatus };
export type AutoScoutSpecificationEvidence = {
  year: AutoScoutEvidence<number>;
  fuel: AutoScoutEvidence<string>;
  engineCc: AutoScoutEvidence<number>;
  powerHp: AutoScoutEvidence<number>;
  powerKw: AutoScoutEvidence<number>;
};

function clean(value: unknown) { return String(value ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(); }
function integer(value: unknown) { const parsed = Number(clean(value).replace(/[^0-9]/g, "")); return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined; }
function absoluteUrl(value: unknown) { const raw = clean(value); if (!raw) return ""; try { return new URL(raw, BASE_URL).toString(); } catch { return ""; } }
function nextData(markup: string): Record<string, any> | null { const match = markup.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i); if (!match?.[1]) return null; try { return JSON.parse(match[1]); } catch { return null; } }
function detailValues(details: unknown, label: RegExp) {
  if (!Array.isArray(details)) return [];
  return details.filter((item) => label.test(clean((item as any)?.ariaLabel))).map((item) => clean((item as any)?.data)).filter(Boolean);
}
function detailValue(details: unknown, label: RegExp) { return detailValues(details, label)[0] || ""; }
function uniqueRaw(values: unknown[]) { return [...new Set(values.map(clean).filter(Boolean))]; }
function evidence<T>(rawValues: string[], parsedValues: Array<T | undefined>): AutoScoutEvidence<T> {
  if (!rawValues.length) return { rawValues, status: "missing" };
  const usable = parsedValues.filter((value): value is T => value !== undefined);
  const unique = [...new Set(usable)];
  if (unique.length > 1) return { rawValues, status: "conflict" };
  if (parsedValues.some((value) => value === undefined) || unique.length !== 1) return { rawValues, status: "ambiguous" };
  return { value: unique[0], rawValues, status: "exact" };
}
function numericToken(value: string) {
  const normalized = value.replace(/[’']/g, "").replace(/\s/g, "");
  if (/^\d{1,3}(?:[.,]\d{3})+$/.test(normalized)) return Number(normalized.replace(/[.,]/g, ""));
  if (/^\d+(?:[.,]\d+)?$/.test(normalized)) return Number(normalized.replace(",", "."));
  return undefined;
}
function hasNumericRange(value: string) { return /\d\s*(?:-|–|—|to)\s*\d/i.test(value); }
function boundedNumber(value: unknown, minimum: number, maximum: number) {
  if (typeof value === "number") return Number.isFinite(value) && value >= minimum && value <= maximum ? value : undefined;
  const parsed = numericToken(clean(value));
  return parsed !== undefined && parsed >= minimum && parsed <= maximum ? parsed : undefined;
}
function powerEvidence(rawValues: string[], unit: "kw" | "hp"): AutoScoutEvidence<number> {
  if (!rawValues.length) return { rawValues, status: "missing" };
  if (rawValues.some(hasNumericRange)) return { rawValues, status: "ambiguous" };
  const pattern = unit === "kw" ? /([0-9]{1,4}(?:[.,][0-9]+)?)\s*kW\b/gi : /([0-9]{1,4}(?:[.,][0-9]+)?)\s*(?:hp|ps)\b/gi;
  const values: number[] = [];
  for (const raw of rawValues) {
    for (const match of raw.matchAll(pattern)) {
      const parsed = boundedNumber(match[1], unit === "kw" ? 10 : 20, unit === "kw" ? 2_000 : 2_500);
      if (parsed !== undefined) values.push(unit === "kw" ? Math.round(parsed * 10) / 10 : Math.round(parsed));
    }
  }
  if (!values.length) return { rawValues, status: "ambiguous" };
  const unique = [...new Set(values)];
  return unique.length === 1 ? { value: unique[0], rawValues, status: "exact" } : { rawValues, status: "conflict" };
}

export function autoScoutSpecificationEvidence(input: {
  firstRegistrations?: unknown[];
  fuels?: unknown[];
  engineDisplacementsCcm?: unknown[];
  power?: unknown[];
  sourceUrl?: unknown;
}): AutoScoutSpecificationEvidence {
  const firstRegistrations = uniqueRaw(input.firstRegistrations || []);
  const fuels = uniqueRaw(input.fuels || []);
  const engines = uniqueRaw(input.engineDisplacementsCcm || []);
  const powers = uniqueRaw(input.power || []);
  const year = evidence(firstRegistrations, firstRegistrations.map((raw) => {
    if (hasNumericRange(raw)) return undefined;
    const values = [...raw.matchAll(/\b((?:19|20)\d{2})\b/g)].map((match) => Number(match[1]));
    const unique = [...new Set(values)].filter((value) => value >= 1900 && value <= new Date().getUTCFullYear() + 1);
    return unique.length === 1 ? unique[0] : undefined;
  }));
  const sourceUrl = absoluteUrl(input.sourceUrl);
  const sourcePureElectric = /-electric-/i.test(sourceUrl) && !/-(?:gasoline|petrol|diesel)-|hybrid|phev|hev/i.test(sourceUrl);
  const fuelRawValues = fuels.length ? fuels : sourcePureElectric ? [sourceUrl] : [];
  const fuel = evidence(fuelRawValues, fuelRawValues.map((raw) => fuels.length ? canonicalSourceFuel(raw) : "electric"));
  let engineCc = evidence(engines, engines.map((raw) => {
    if (hasNumericRange(raw)) return undefined;
    const match = raw.match(/^([0-9][0-9\s,.'’]*)\s*(?:ccm|cc|cm3|cm³)?$/i);
    const value = match ? boundedNumber(match[1], 300, 10_000) : undefined;
    return value !== undefined ? Math.round(value) : undefined;
  }));
  let powerKw = powerEvidence(powers, "kw");
  let powerHp = powerEvidence(powers, "hp");
  if (powerKw.status === "exact" && powerHp.status === "exact") {
    const convertedHp = Number(powerKw.value) * 1.35962;
    const toleranceHp = Math.max(2, convertedHp * 0.015);
    if (Math.abs(convertedHp - Number(powerHp.value)) > toleranceHp) {
      powerKw = { rawValues: powers, status: "conflict" };
      powerHp = { rawValues: powers, status: "conflict" };
    }
  }
  if (fuel.status === "exact" && fuel.value === "electric" && engineCc.status === "exact") engineCc = { rawValues: engines, status: "conflict" };
  return { year, fuel, engineCc, powerHp, powerKw };
}

function powertrainKind(fuel: string | undefined) {
  if (fuel === "electric") return "electric" as const;
  if (fuel === "hybrid") return "other_hybrid" as const;
  if (fuel) return "combustion" as const;
  return "unknown" as const;
}
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
    const firstRegistrations = uniqueRaw([listing.tracking?.firstRegistration, ...detailValues(listing.vehicleDetails, /^first registration$/i)]);
    const sourceUrlValue = absoluteUrl(listing.url);
    const semanticEvidence = autoScoutSpecificationEvidence({
      firstRegistrations,
      fuels: uniqueRaw([listing.vehicle?.fuel, ...detailValues(listing.vehicleDetails, /^(?:fuel|fuel type)$/i)]),
      engineDisplacementsCcm: [listing.vehicle?.engineDisplacementInCCM],
      power: detailValues(listing.vehicleDetails, /^(?:power|engine power)$/i),
      sourceUrl: sourceUrlValue,
    });
    const year = semanticEvidence.year.status === "exact" ? semanticEvidence.year.value || 0 : 0;
    const price = Number(listing.price?.priceRaw || listing.tracking?.price || 0);
    const currency = clean(listing.price?.currency || listing.priceCurrency || data?.props?.pageProps?.currency || "EUR");
    const images = [...new Set<string>((Array.isArray(listing.images) ? listing.images : []).map((value: unknown) => absoluteUrl(value)).filter((url: string) => /^https?:\/\/prod\.pictures\.autoscout24\.net\/listing-images\//i.test(url)))];
    const title = sourceTitle;
    const mileageKm = integer(listing.tracking?.mileage || listing.vehicle?.mileageInKm || detailValue(listing.vehicleDetails, /mileage/i));
    const engineCc = semanticEvidence.engineCc.status === "exact" ? semanticEvidence.engineCc.value : undefined;
    const powerKw = semanticEvidence.powerKw.status === "exact" ? semanticEvidence.powerKw.value : undefined;
    const powerHp = semanticEvidence.powerHp.status === "exact" ? semanticEvidence.powerHp.value : undefined;
    const fuel = semanticEvidence.fuel.status === "exact" ? semanticEvidence.fuel.value : undefined;
    const transmission = clean(listing.vehicle?.transmission || detailValue(listing.vehicleDetails, /gear/i));
    const location = clean([listing.location?.city, listing.location?.countryCode].filter(Boolean).join(", "));
    if (!id || seen.has(id) || !sourceUrl.includes("/offers/") || !make || !model || !year || !(price > 0) || !currency || images.length < 5) continue;
    seen.add(id);
    rows.push({ id, sourceUrl, title, make, model, trim, year, mileageKm, engineCc, powerKw, powerHp, fuel, powertrainKind: powertrainKind(fuel),
      transmission, drive: driveFrom(listing), bodyType: bodyFrom(listing), price, currency, location, images: images.slice(0, 30), raw: listing, semanticEvidence });
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
    const semanticEvidence = row.semanticEvidence || autoScoutSpecificationEvidence({
      firstRegistrations: [row.year], fuels: [row.fuel], engineDisplacementsCcm: [row.engineCc],
      power: [row.powerKw ? `${row.powerKw} kW` : "", row.powerHp ? `${row.powerHp} hp` : ""], sourceUrl: row.sourceUrl,
    });
    if (semanticEvidence.year.status !== "exact") return null;
    const fuel = semanticEvidence.fuel.status === "exact" ? semanticEvidence.fuel.value : undefined;
    const engineCc = semanticEvidence.engineCc.status === "exact" ? semanticEvidence.engineCc.value : undefined;
    const powerKw = semanticEvidence.powerKw.status === "exact" ? semanticEvidence.powerKw.value : undefined;
    const powerHp = semanticEvidence.powerHp.status === "exact" ? semanticEvidence.powerHp.value : undefined;
    const hasExactPower = Boolean(powerKw || powerHp);
    const now = new Date().toISOString();
    return { id: stableOfferId(this.sourceId, row.id), sourceId: this.sourceId, sourceOfferId: row.id, market: "europe", offerType: "fixed", status: "active",
      sourceTitle: row.title, make: row.make, model: row.model, trim: row.trim, year: semanticEvidence.year.value!, mileageKm: row.mileageKm, engineCc, fuel,
      powertrainKind: powertrainKind(fuel), transmission: row.transmission, drive: row.drive, bodyType: row.bodyType, powerKw, powerHp,
      powerDataConfidence: hasExactPower ? "source_exact" : undefined, powerDataSource: hasExactPower ? "AutoScout24 named vehicleDetails Power" : undefined,
      sourcePrice: row.price, sourceCurrency: row.currency, priceMode: "fixed", images: [], totalRub: null, calculationStatus: "needs_data", firstSeenAt: now, updatedAt: now,
      operational: { sourceUrl: row.sourceUrl, sourceVenueName: row.location || "AutoScout24 Europe", sourceTitle: row.title, exactDetail: false, exactFields: true, exactPhotos: false,
        galleryVerified: false, galleryImageCount: 0, gallerySafetyMode: "autoscout_exact_detail_pending_v2", galleryStoredAs: "json_urls", photoIdentityVerified: false,
        semanticEvidence: {
          year: { source: "autoscout_first_registration", ...semanticEvidence.year },
          fuel: { source: semanticEvidence.fuel.rawValues.some((value) => value === row.sourceUrl) ? "autoscout_url_powertrain_identity" : "autoscout_named_vehicle_fuel", ...semanticEvidence.fuel },
          engineCc: { source: "autoscout_vehicle_engine_displacement_ccm", ...semanticEvidence.engineCc },
          powerHp: { source: "autoscout_named_vehicle_details_power", ...semanticEvidence.powerHp },
          powerKw: { source: "autoscout_named_vehicle_details_power", ...semanticEvidence.powerKw },
        },
        raw: { parsed: row, searchImages: row.images, listingBoundSearchImages: true, photoIdentityVerified: false, detailIdentityVerified: false } } };
  }

  async fetchImages(_offer: VehicleOffer): Promise<CatalogImage[]> { return []; }
  mapStatus(): OfferStatus { return "active"; }
  async healthCheck() { return { ok: true, message: "AutoScout24 exact __NEXT_DATA__ adapter", checkedAt: new Date().toISOString() }; }
}
