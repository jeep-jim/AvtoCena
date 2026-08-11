import { readChunkedDataJson } from "../data";
import type { PowerDataConfidence, PowertrainKind, VehicleOffer } from "./types";

export type CertifiedPowerReference = {
  id: string;
  make: string;
  model: string;
  modelAliases?: string[];
  trimContains?: string[];
  driveContains?: string[];
  yearFrom?: number;
  yearTo?: number;
  powertrainKind: Exclude<PowertrainKind, "unknown">;
  peakPowerKw?: number;
  peakPowerToleranceKw?: number;
  icePowerKw?: number;
  power30MinKw?: number;
  power30MinKwByMotor?: number[];
  utilizationPowerKw?: number;
  sourceDocumentType: "OTTS" | "SBKTS" | "ZOETS" | "EPTS" | "COC" | "manufacturer_document";
  sourceDocumentId: string;
  sourceUrl?: string;
  verifiedAt: string;
  verifiedBy: string;
  active?: boolean;
};

const REFERENCE_PATH = "catalog/power-reference/30-minute-power.json";
let cachedReferences: Promise<CertifiedPowerReference[]> | null = null;

function token(value: unknown) {
  return String(value || "")
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function validPower(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 && number <= 4_000;
}

function referenceSpecificity(reference: CertifiedPowerReference) {
  return (reference.trimContains?.length || 0) * 10
    + (reference.driveContains?.length || 0) * 5
    + (reference.peakPowerKw ? 5 : 0)
    + (reference.yearFrom ? 1 : 0)
    + (reference.yearTo ? 1 : 0);
}

export function certifiedPowerReferenceMatches(reference: CertifiedPowerReference, offer: Partial<VehicleOffer>) {
  if (reference.active === false) return false;
  if (token(reference.make) !== token(offer.make)) return false;
  const offerModel = token(offer.model);
  const exactModelNames = [reference.model, ...(reference.modelAliases || [])].map(token).filter(Boolean);
  if (!offerModel || !exactModelNames.includes(offerModel)) return false;
  const offerKind = String(offer.powertrainKind || "unknown");
  if (offerKind !== "unknown" && offerKind !== reference.powertrainKind) return false;
  const year = Number(offer.year || 0);
  if (reference.yearFrom && (!year || year < reference.yearFrom)) return false;
  if (reference.yearTo && (!year || year > reference.yearTo)) return false;
  if (reference.trimContains?.length) {
    const haystack = token([offer.generation, offer.trim, offer.engineType].filter(Boolean).join(" "));
    if (!reference.trimContains.every((part) => haystack.includes(token(part)))) return false;
  }
  if (reference.driveContains?.length) {
    const drive = token(offer.drive);
    if (!drive || !reference.driveContains.every((part) => drive.includes(token(part)))) return false;
  }
  if (validPower(reference.peakPowerKw)) {
    const offerPeakPowerKw = Number(offer.powerKw || 0);
    const tolerance = Math.max(0, Number(reference.peakPowerToleranceKw ?? 1));
    if (!validPower(offerPeakPowerKw) || Math.abs(offerPeakPowerKw - Number(reference.peakPowerKw)) > tolerance) return false;
  }
  return Boolean(reference.sourceDocumentId && reference.verifiedAt && reference.verifiedBy);
}

export async function getCertifiedPowerReferences() {
  if (!cachedReferences) {
    cachedReferences = readChunkedDataJson<CertifiedPowerReference>(REFERENCE_PATH, [])
      .then((rows) => rows.filter((row) => row && row.id && row.make && row.model));
  }
  return cachedReferences;
}

export function resetCertifiedPowerReferenceCache() {
  cachedReferences = null;
}

export async function findCertifiedPowerReference(offer: Partial<VehicleOffer>) {
  const references = await getCertifiedPowerReferences();
  return references
    .filter((reference) => certifiedPowerReferenceMatches(reference, offer))
    .sort((left, right) => referenceSpecificity(right) - referenceSpecificity(left)
      || Date.parse(right.verifiedAt) - Date.parse(left.verifiedAt))[0] || null;
}

export async function enrichOfferWithCertifiedPower<T extends VehicleOffer>(offer: T): Promise<T> {
  const reference = await findCertifiedPowerReference(offer);
  if (!reference) return offer;

  const motorPowers = (reference.power30MinKwByMotor || [])
    .map(Number)
    .filter(validPower);
  const total30Minute = validPower(reference.power30MinKw)
    ? Number(reference.power30MinKw)
    : motorPowers.length
      ? Math.round(motorPowers.reduce((sum, value) => sum + value, 0) * 100) / 100
      : undefined;

  return {
    ...offer,
    powertrainKind: reference.powertrainKind,
    icePowerKw: validPower(reference.icePowerKw) ? Number(reference.icePowerKw) : offer.icePowerKw,
    power30MinKwByMotor: motorPowers.length ? motorPowers : offer.power30MinKwByMotor,
    power30MinKw: total30Minute || offer.power30MinKw,
    utilizationPowerKw: validPower(reference.utilizationPowerKw)
      ? Number(reference.utilizationPowerKw)
      : offer.utilizationPowerKw,
    powerDataConfidence: "documented" as PowerDataConfidence,
    powerDataSource: `${reference.sourceDocumentType}:${reference.sourceDocumentId}`,
    operational: {
      ...offer.operational,
      raw: {
        ...(typeof offer.operational?.raw === "object" && offer.operational.raw ? offer.operational.raw as object : {}),
        certifiedPowerReference: reference,
      },
    },
  } as T;
}
