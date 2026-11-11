import { calculateOfferWithPreliminaryPowerPricing, isPreliminaryPowerPendingCalculation } from "./customs-pricing";
import { collectGeorgiaYandexRecoverySnapshot, type GeorgiaRecoverySource } from "./georgia-yandex-recovery";
import { normalizeVehicleOfferSpecs } from "./spec-normalization";
import type { VehicleOffer } from "./types";

const DETAIL_PATH_RE = /^\/en\/usd\/[^/?#]+\/[^/?#]+\/(\d{5,})\/?$/i;
const REQUEST_HEADERS = {
  accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9,ka;q=0.8",
  "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/150 Safari/537.36",
};

type VpicResult = Record<string, string | null | undefined>;

export type VpicPowerCandidate = {
  make?: string | null;
  model?: string | null;
  modelYear?: number | null;
  displacementL?: number | null;
  engineHp?: number | null;
  engineKw?: number | null;
  fuelTypePrimary?: string | null;
  errorCode?: string | null;
  errorText?: string | null;
};

function plain(value: string) {
  return String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;|\u00a0/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function compact(value: unknown) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function numeric(value: unknown) {
  const parsed = Number(String(value || "").replace(",", "."));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function detailIdentity(url: string) {
  try { return new URL(url).pathname.match(DETAIL_PATH_RE)?.[1] || ""; } catch { return ""; }
}

function primaryFacts(markup: string) {
  const text = plain(markup);
  const start = text.search(/\bBody\s+Type\s*:/i);
  if (start < 0) return "";
  const end = text.indexOf("Car description", start);
  return text.slice(start, end > start ? end : Math.min(text.length, start + 2_500));
}

export function autoPapaExactPrimaryVin(markup: string) {
  const facts = primaryFacts(markup).toUpperCase();
  const candidates = [...facts.matchAll(/\b[A-HJ-NPR-Z0-9]{17}\b/g)].map((match) => match[0]);
  const unique = [...new Set(candidates)];
  return unique.length === 1 ? unique[0] : null;
}

function isElectrifiedFuel(value: unknown) {
  return /electric|battery|plug[ -]?in|phev|hybrid/i.test(String(value || ""));
}

export function validatedVpicCombustionPowerHp(offer: Partial<VehicleOffer>, candidate: VpicPowerCandidate) {
  if (String(offer.powertrainKind || "") !== "combustion") return null;
  const hp = numeric(candidate.engineHp);
  if (!hp || hp < 20 || hp > 2_500) return null;
  if (String(candidate.errorCode || "") !== "0") return null;
  if (isElectrifiedFuel(candidate.fuelTypePrimary)) return null;

  const offerMake = compact(offer.make);
  const decodedMake = compact(candidate.make);
  const offerModel = compact(offer.model);
  const decodedModel = compact(candidate.model);
  if (!offerMake || !decodedMake || offerMake !== decodedMake) return null;
  if (!offerModel || !decodedModel || offerModel !== decodedModel) return null;

  const offerYear = Number(offer.year || 0);
  const decodedYear = Number(candidate.modelYear || 0);
  if (!offerYear || !decodedYear || offerYear !== decodedYear) return null;

  const offerEngineCc = Number(offer.engineCc || 0);
  const decodedDisplacementL = numeric(candidate.displacementL);
  if (!(offerEngineCc > 0) || !decodedDisplacementL) return null;
  const decodedEngineCc = decodedDisplacementL * 1_000;
  if (Math.abs(decodedEngineCc - offerEngineCc) > 150) return null;

  return Math.round(hp * 10) / 10;
}

async function fetchExactAutoPapaMarkup(offer: VehicleOffer) {
  const sourceOfferId = String(offer.sourceOfferId || "").trim();
  const sourceUrl = String(offer.operational?.sourceUrl || "");
  if (offer.sourceId !== "autopapa_georgia_open" || !/^\d{5,}$/.test(sourceOfferId)) return null;
  if (detailIdentity(sourceUrl) !== sourceOfferId) return null;
  const response = await fetch(sourceUrl, {
    headers: REQUEST_HEADERS,
    redirect: "follow",
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  const markup = await response.text();
  if (!response.ok || detailIdentity(response.url || sourceUrl) !== sourceOfferId) return null;
  return { markup, finalUrl: response.url || sourceUrl };
}

async function decodeVpic(vin: string): Promise<VpicPowerCandidate | null> {
  const url = new URL(`https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValuesExtended/${encodeURIComponent(vin)}`);
  url.searchParams.set("format", "json");
  const response = await fetch(url, {
    headers: { accept: "application/json", "user-agent": REQUEST_HEADERS["user-agent"] },
    redirect: "follow",
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) return null;
  const payload = await response.json() as { Results?: VpicResult[] };
  const row = payload.Results?.[0];
  if (!row) return null;
  return {
    make: row.Make || null,
    model: row.Model || null,
    modelYear: numeric(row.ModelYear),
    displacementL: numeric(row.DisplacementL),
    engineHp: numeric(row.EngineHP),
    engineKw: numeric(row.EngineKW),
    fuelTypePrimary: row.FuelTypePrimary || null,
    errorCode: row.ErrorCode || null,
    errorText: row.ErrorText || null,
  };
}

async function pool<T, R>(rows: T[], limit: number, worker: (row: T) => Promise<R>): Promise<R[]> {
  const result = new Array<R>(rows.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, Math.max(1, rows.length)) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= rows.length) return;
      result[index] = await worker(rows[index]);
    }
  }));
  return result;
}

function rawRecord(offer: VehicleOffer): Record<string, unknown> {
  const raw = offer.operational?.raw;
  return raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
}

export async function enrichAutoPapaPreliminaryWithVpicPower(offer: VehicleOffer) {
  if (offer.sourceId !== "autopapa_georgia_open") return { offer, outcome: "not_autopapa" as const };
  if (String(offer.powertrainKind || "") !== "combustion") return { offer, outcome: "not_combustion" as const };
  if (Number(offer.powerHp || 0) > 0 || !isPreliminaryPowerPendingCalculation(offer)) return { offer, outcome: "not_pending" as const };

  const detail = await fetchExactAutoPapaMarkup(offer).catch(() => null);
  if (!detail) return { offer, outcome: "detail_unavailable" as const };
  const vin = autoPapaExactPrimaryVin(detail.markup);
  if (!vin) return { offer, outcome: "vin_missing_or_ambiguous" as const };
  const decoded = await decodeVpic(vin).catch(() => null);
  if (!decoded) return { offer, outcome: "vpic_unavailable" as const };
  const powerHp = validatedVpicCombustionPowerHp(offer, decoded);
  if (!powerHp) return { offer, outcome: "vpic_not_exact" as const };

  const enriched = normalizeVehicleOfferSpecs({
    ...offer,
    powerHp,
    powerKw: Math.round((powerHp / 1.3596216173) * 100) / 100,
    powerDataConfidence: "source_exact",
    powerDataSource: `nhtsa-vpic:${String(offer.sourceOfferId || "")}:VIN`,
    operational: {
      ...offer.operational,
      raw: {
        ...rawRecord(offer),
        autoPapaVinPowerVerified: true,
        autoPapaVinTail: vin.slice(-6),
        autoPapaVinPowerHp: powerHp,
        autoPapaVinPowerProvider: "NHTSA vPIC DecodeVinValuesExtended",
        autoPapaVpicModelYear: decoded.modelYear || null,
        autoPapaVpicDisplacementL: decoded.displacementL || null,
      },
    },
  } as VehicleOffer) as VehicleOffer;
  const recalculated = normalizeVehicleOfferSpecs(await calculateOfferWithPreliminaryPowerPricing(enriched)) as VehicleOffer;
  return {
    offer: recalculated,
    outcome: isPreliminaryPowerPendingCalculation(recalculated) ? "accepted_still_pending" as const : "accepted_calculated" as const,
  };
}

export async function collectGeorgiaYandexRecoverySnapshotWithVinPower(
  pagesPerSource = 2,
  startPage = 1,
  source: GeorgiaRecoverySource = "autopapa",
) {
  const snapshot = await collectGeorgiaYandexRecoverySnapshot(pagesPerSource, startPage, source);
  const outcomes: Record<string, number> = {};
  const offers = await pool(snapshot.offers, 3, async (offer) => {
    const result = await enrichAutoPapaPreliminaryWithVpicPower(offer);
    outcomes[result.outcome] = Number(outcomes[result.outcome] || 0) + 1;
    return result.offer;
  });
  const preliminaryCount = offers.filter(isPreliminaryPowerPendingCalculation).length;
  const calculatedCount = offers.length - preliminaryCount;
  return {
    ...snapshot,
    offers,
    report: {
      ...snapshot.report,
      calculatedCount,
      preliminaryCount,
      vinPower: {
        provider: "NHTSA vPIC DecodeVinValuesExtended",
        strictMatch: "exact listing id + unique primary VIN + make + model + year + displacement(±150cc) + ErrorCode=0 + combustion",
        outcomes,
        convertedCount: Number(outcomes.accepted_calculated || 0),
      },
    },
  };
}
