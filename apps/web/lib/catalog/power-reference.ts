import { readChunkedDataJson } from "../data";
import { canonicalCatalogBrand } from "./brands";
import { translateCatalogText } from "./presentation";
import type { PowerDataConfidence, PowertrainKind, VehicleOffer } from "./types";

export type CertifiedPowerReference = {
  id: string;
  make: string;
  model: string;
  modelAliases?: string[];
  rawModelContains?: string[];
  trimContains?: string[];
  trimNotContains?: string[];
  driveContains?: string[];
  driveNotContains?: string[];
  yearFrom?: number;
  yearTo?: number;
  powertrainKind: Exclude<PowertrainKind, "unknown">;
  peakPowerKw?: number;
  peakPowerToleranceKw?: number;
  requireOfferPeakPower?: boolean;
  icePowerKw?: number;
  power30MinKw?: number;
  power30MinKwByMotor?: number[];
  utilizationPowerKw?: number;
  sourceDocumentType: "OTTS" | "SBKTS" | "ZOETS" | "EPTS" | "COC" | "KBA_registration_data" | "manufacturer_document";
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
    .replace(/\be\+/g, " eplus ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function translatedToken(value: unknown) {
  return token(translateCatalogText(value));
}

function modelToken(value: unknown) {
  return translatedToken(value);
}

function makeToken(value: unknown) {
  return token(canonicalCatalogBrand(String(value || "")));
}

function searchableText(...values: unknown[]) {
  const raw = values.map((value) => String(value || "")).join(" ");
  const translated = values.map((value) => translateCatalogText(value)).join(" ");
  return token(`${raw} ${translated}`);
}

function containsSearchTerm(haystack: string, value: unknown) {
  const terms = [...new Set([token(value), translatedToken(value)].filter(Boolean))];
  return terms.some((term) => haystack.includes(term));
}

function searchableDrive(offer: Partial<VehicleOffer>) {
  const value = searchableText(offer.drive, offer.trim, offer.generation);
  const tags = [
    /(?:^| )(?:awd|4wd|allrad|all wheel drive|полный привод|사륜)(?: |$)/u.test(value) ? "awd" : "",
    /(?:^| )(?:rwd|rear wheel drive|задний привод|후륜)(?: |$)/u.test(value) ? "rwd" : "",
    /(?:^| )(?:fwd|front wheel drive|передний привод|전륜)(?: |$)/u.test(value) ? "fwd" : "",
  ].filter(Boolean).join(" ");
  return token(`${value} ${tags}`);
}

function validPower(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 && number <= 4_000;
}

function referenceSpecificity(reference: CertifiedPowerReference) {
  return (reference.rawModelContains?.length || 0) * 15
    + (reference.trimContains?.length || 0) * 10
    + (reference.trimNotContains?.length || 0) * 8
    + (reference.driveContains?.length || 0) * 5
    + (reference.driveNotContains?.length || 0) * 4
    + (reference.peakPowerKw ? 5 : 0)
    + (reference.yearFrom ? 1 : 0)
    + (reference.yearTo ? 1 : 0);
}

export function certifiedPowerReferenceMatches(reference: CertifiedPowerReference, offer: Partial<VehicleOffer>) {
  if (reference.active === false) return false;
  if (makeToken(reference.make) !== makeToken(offer.make)) return false;
  const offerModel = modelToken(offer.model);
  const exactModelNames = [reference.model, ...(reference.modelAliases || [])].map(modelToken).filter(Boolean);
  if (!offerModel || !exactModelNames.includes(offerModel)) return false;
  if (reference.rawModelContains?.length) {
    const rawModel = token(offer.model);
    if (!reference.rawModelContains.every((part) => rawModel.includes(token(part)))) return false;
  }
  const offerKind = String(offer.powertrainKind || "unknown");
  if (offerKind !== "unknown" && offerKind !== reference.powertrainKind) return false;
  const year = Number(offer.year || 0);
  if (reference.yearFrom && (!year || year < reference.yearFrom)) return false;
  if (reference.yearTo && (!year || year > reference.yearTo)) return false;
  if (reference.trimContains?.length) {
    const haystack = searchableText(offer.generation, offer.trim, offer.engineType);
    if (!reference.trimContains.every((part) => containsSearchTerm(haystack, part))) return false;
  }
  if (reference.trimNotContains?.length) {
    const haystack = searchableText(offer.generation, offer.trim, offer.engineType);
    if (reference.trimNotContains.some((part) => containsSearchTerm(haystack, part))) return false;
  }
  if (reference.driveContains?.length) {
    const drive = searchableDrive(offer);
    if (!drive || !reference.driveContains.every((part) => drive.includes(token(part)))) return false;
  }
  if (reference.driveNotContains?.length) {
    const drive = searchableDrive(offer);
    if (reference.driveNotContains.some((part) => drive.includes(token(part)))) return false;
  }
  if (validPower(reference.peakPowerKw)) {
    const offerPeakPowerKw = Number(offer.powerKw || 0);
    if (reference.requireOfferPeakPower && !validPower(offerPeakPowerKw)) return false;
    const tolerance = Math.max(0, Number(reference.peakPowerToleranceKw ?? 1));
    // The reviewed reference is also allowed to fill a missing peak value for
    // excise. If the source supplied a conflicting peak value, reject it.
    if (validPower(offerPeakPowerKw) && Math.abs(offerPeakPowerKw - Number(reference.peakPowerKw)) > tolerance) return false;
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
    powerKw: validPower(reference.peakPowerKw) ? Number(reference.peakPowerKw) : offer.powerKw,
    powerHp: validPower(reference.peakPowerKw) && !validPower(offer.powerHp)
      ? Math.round(Number(reference.peakPowerKw) * 1.3596216173 * 10) / 10
      : offer.powerHp,
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
