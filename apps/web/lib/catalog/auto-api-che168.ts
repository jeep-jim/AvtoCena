import { stableOfferId } from "./storage";
import { canonicalizeSemanticSourceFields, namedElectrifiedPowertrainKind } from "./powertrain-safety";
import { retainNamedSpecificationGroups } from "./source-specifications";
import { enrichOfferWithSourceTableParameters } from "./source-table-displacement";
import type { VehicleOffer } from "./types";

// Same marketplace identity as the former Global collector: no duplicate fleet.
export const AUTO_API_CHE168_SOURCE = "autohome_used_china_open";
const text = (v: unknown) => typeof v === "string" || typeof v === "number" ? String(v).trim() : "";
const number = (v: unknown) => /^\d+(?:\.\d+)?$/.test(text(v)) && Number(v) > 0 ? Number(v) : undefined;
const evidence = (field: string, value: unknown, status = value === undefined ? "missing" : "exact") =>
  ({ source: `auto_api_che168:${field}`, status, value });

export function autoApiChe168RejectionReason(row: any): string | null {
  const d = row?.data;
  const id = text(row?.inner_id);
  if (!d || !/^\d+$/.test(id) || text(d.inner_id) !== id) return "identity_mismatch";
  let url: URL;
  try { url = new URL(text(d.url)); } catch { return "invalid_url"; }
  if (url.origin !== "https://www.che168.com" || url.username || url.password
    || !new RegExp(`^/dealer/\\d+/${id}\\.html$`).test(url.pathname)) return "url_identity_mismatch";
  if (!text(d.mark) || !text(d.model)) return "missing_make_model";
  const year = number(d.year);
  if (!Number.isInteger(year) || !year || year < 1900) return "invalid_year";
  if (!number(d.price)) return "missing_price";
  return null;
}

export function normalizeAutoApiChe168(row: any, observedAt = new Date().toISOString()): VehicleOffer | null {
  if (autoApiChe168RejectionReason(row)) return null;
  const d = row.data, id = text(row.inner_id), url = new URL(text(d.url));
  // Drop tracking; never persist authentication query strings.
  const sourceUrl = url.origin + url.pathname;
  const year = number(d.year), price = number(d.price);
  const now = observedAt;
  const specId = text(d.specid), table = d.extra?.configuration;
  const groups = /^\d+$/.test(specId) && text(table?.specid) === specId
    ? retainNamedSpecificationGroups(table.paramtypeitems) : [];
  let imageValues: unknown = d.images;
  if (typeof imageValues === "string") { try { imageValues = JSON.parse(imageValues); } catch { imageValues = []; } }
  const images = [...new Set((Array.isArray(imageValues) ? imageValues : []).filter((v): v is string => {
    try {
      const u = new URL(v);
      return u.protocol === "https:" && !u.username && !u.password && !u.port
        && /(?:^|\.)autoimg\.cn$/.test(u.hostname) && /^\/escimg\/auto\//.test(u.pathname)
        && /\.(?:jpe?g|png|webp|avif)$/i.test(u.pathname);
    } catch { return false; }
  }))].slice(0, 30).map(url => ({ id: "", url, objectKey: "", checksum: "", size: 0,
    mimeType: url.split("?")[0].endsWith(".webp") ? "image/webp" : "image/jpeg" }));
  const title = text(d.complectation) || [d.mark, d.model, d.configuration].map(text).filter(Boolean).join(" ");
  const fuelLabel = /^электрическ/i.test(text(d.engine_type)) ? "electric" : text(d.engine_type);
  const fields = canonicalizeSemanticSourceFields({ fuel: fuelLabel, transmission: text(d.transmission_type),
    drive: text(d.drive_type), bodyType: text(d.body_type) });
  // A slash-separated body label is not an exact body designation.
  if (/[\/]/.test(text(d.body_type))) fields.bodyType = undefined;
  const named = namedElectrifiedPowertrainKind({ ...fields, engineType: fuelLabel, make: text(d.mark), model: text(d.model), trim: text(d.configuration), sourceTitle: title });
  const kind = named || (fields.fuel === "electric" ? "electric" : fields.fuel === "hybrid" ? "other_hybrid" : fields.fuel ? "combustion" : "unknown");
  if (kind === "other_hybrid" || kind === "series_hybrid") fields.fuel = "hybrid";
  if (kind === "electric") fields.fuel = "electric";
  // Peak motor/system power must never become certified 30-minute power.
  const hp = kind === "combustion" ? number(d.ice_power_ps) || number(d.power) : number(d.power);
  const kw = kind === "combustion" ? number(d.ice_power_kw) : undefined;
  const powerConflict = !!(hp && kw && Math.abs(hp - kw * 1.3596216173) > 2);
  const powerHp = powerConflict ? undefined : hp;
  const mileage = /^\d+$/.test(text(d.km_age)) ? Number(d.km_age) : undefined;
  // Registration is useful for admission, but is not an attested production date.
  const registrationDate = /^\d{4}-(?:0[1-9]|1[0-2])$/.test(text(d.first_registration)) ? text(d.first_registration) : undefined;
  let offer: VehicleOffer = {
    id: stableOfferId(AUTO_API_CHE168_SOURCE, id), sourceId: AUTO_API_CHE168_SOURCE, sourceOfferId: id,
    market: "china", offerType: "fixed", status: "active", catalogKind: "listing",
    make: text(d.mark), model: text(d.model), trim: text(d.configuration) || undefined, sourceTitle: title,
    year, inventorySourceDate: registrationDate, mileageKm: mileage, ...fields, powertrainKind: kind,
    powerHp, powerKw: powerConflict ? undefined : kw, icePowerKw: powerConflict ? undefined : kw,
    powerDataConfidence: powerHp ? "source_exact" : undefined, powerDataSource: powerHp ? "auto_api_che168_source" : undefined,
    sourcePrice: price, sourceCurrency: "CNY", priceMode: "fixed", images, totalRub: null,
    calculationStatus: "needs_data", firstSeenAt: now, updatedAt: now,
    operational: {
      sourceUrl, sourceVenueName: "Che168", sourceTitle: title, provider: "auto-api.com",
      registrationDate, exactDetail: true, detailIdentityVerified: true, fieldIdentityVerified: true,
      exactPhotos: images.length > 0, photoIdentityVerified: images.length > 0,
      galleryVerified: images.length > 0, galleryImageCount: images.length,
      galleryStoredAs: "json_urls", gallerySafetyMode: "auto_api_che168_identity_bound_v1",
      sourceSpecifications: groups.length ? { version: 1, sourceId: AUTO_API_CHE168_SOURCE, sourceOfferId: id,
        specificationId: specId, sourceUrl, capturedAt: now, groups } : undefined,
      semanticEvidence: {
        year: evidence("year", year), fuel: evidence("engine_type", fields.fuel),
        engineCc: evidence("displacement_rounded_litres", undefined),
        powerHp: evidence("power_ps", powerHp, powerConflict ? "conflict" : powerHp ? "exact" : "missing"),
        productionDate: evidence("production_date", undefined),
        certifiedPower: evidence("certified_30min_power", undefined),
      },
      // Deliberately omit seller contacts, inspection prose and unrelated recommendations.
    },
  };
  offer = enrichOfferWithSourceTableParameters(offer);
  return offer;
}
