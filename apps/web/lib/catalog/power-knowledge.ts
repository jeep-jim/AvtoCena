import { readChunkedDataJson } from "../data";
import type { PowerDataConfidence, PowertrainKind, VehicleOffer } from "./types";

export type VehiclePowerKnowledge = {
  id: string;
  make: string;
  model: string;
  aliases?: string[];
  trimContains?: string[];
  yearFrom?: number;
  yearTo?: number;
  engineCc?: number;
  engineCcTolerance?: number;
  fuel?: string;
  powertrainKind?: Exclude<PowertrainKind, "unknown">;
  powerHp: number;
  powerKw?: number;
  icePowerKw?: number;
  power30MinKw?: number;
  power30MinKwByMotor?: number[];
  utilizationPowerKw?: number;
  confidence: "manufacturer" | "registry" | "source_consensus";
  sourceIds: string[];
  sourceUrl?: string;
  verifiedAt: string;
  active?: boolean;
};

const KNOWLEDGE_PATH = "catalog/power-knowledge/vehicles.json";
let cache: Promise<VehiclePowerKnowledge[]> | null = null;

function token(value: unknown) {
  return String(value || "")
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function compact(value: unknown) {
  return token(value).replace(/\s+/g, "");
}

function positive(value: unknown, max = 4_000) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= max ? parsed : undefined;
}

function modelMatches(reference: VehiclePowerKnowledge, offer: Partial<VehicleOffer>) {
  const offerModel = compact(offer.model);
  const candidates = [reference.model, ...(reference.aliases || [])].map(compact).filter(Boolean);
  return Boolean(offerModel && candidates.some((candidate) => candidate === offerModel));
}

function score(reference: VehiclePowerKnowledge, offer: Partial<VehicleOffer>) {
  if (reference.active === false || compact(reference.make) !== compact(offer.make) || !modelMatches(reference, offer)) return -1;
  const year = Number(offer.year || 0);
  if (reference.yearFrom && (!year || year < reference.yearFrom)) return -1;
  if (reference.yearTo && (!year || year > reference.yearTo)) return -1;

  let result = 100;
  if (reference.yearFrom || reference.yearTo) result += 10;

  const engineCc = positive(offer.engineCc, 10_000);
  if (reference.engineCc) {
    if (!engineCc) return -1;
    const tolerance = Math.max(20, Number(reference.engineCcTolerance || 80));
    if (Math.abs(engineCc - reference.engineCc) > tolerance) return -1;
    result += 30 - Math.min(20, Math.round(Math.abs(engineCc - reference.engineCc) / 10));
  }

  if (reference.fuel) {
    const referenceFuel = token(reference.fuel);
    const offerFuel = token(offer.fuel);
    if (offerFuel && referenceFuel !== offerFuel && !offerFuel.includes(referenceFuel) && !referenceFuel.includes(offerFuel)) return -1;
    if (offerFuel) result += 12;
  }

  if (reference.powertrainKind && offer.powertrainKind && offer.powertrainKind !== "unknown") {
    if (reference.powertrainKind !== offer.powertrainKind) return -1;
    result += 15;
  }

  if (reference.trimContains?.length) {
    const haystack = token([offer.generation, offer.trim, offer.engineType].filter(Boolean).join(" "));
    if (!reference.trimContains.every((part) => haystack.includes(token(part)))) return -1;
    result += reference.trimContains.length * 8;
  }

  if (reference.confidence === "manufacturer") result += 5;
  if (reference.confidence === "registry") result += 4;
  return result;
}

export async function readVehiclePowerKnowledge() {
  if (!cache) {
    cache = readChunkedDataJson<VehiclePowerKnowledge>(KNOWLEDGE_PATH, [])
      .then((rows) => rows.filter((row) => row && row.id && row.make && row.model && positive(row.powerHp, 2_500)));
  }
  return cache;
}

export function resetVehiclePowerKnowledgeCache() {
  cache = null;
}

export async function findVehiclePowerKnowledge(offer: Partial<VehicleOffer>) {
  const ranked = (await readVehiclePowerKnowledge())
    .map((reference) => ({ reference, score: score(reference, offer) }))
    .filter((entry) => entry.score >= 0)
    .sort((left, right) => right.score - left.score || Date.parse(right.reference.verifiedAt) - Date.parse(left.reference.verifiedAt));
  const best = ranked[0];
  if (!best) return null;
  const equallySpecific = ranked.filter((entry) => entry.score === best.score);
  const powers = new Set(equallySpecific.map((entry) => Math.round(entry.reference.powerHp * 10) / 10));
  return powers.size === 1 ? best.reference : null;
}

export async function enrichOfferWithPowerKnowledge<T extends VehicleOffer>(offer: T): Promise<T> {
  if (positive(offer.powerHp, 2_500)) return offer;
  const reference = await findVehiclePowerKnowledge(offer);
  if (!reference) return offer;
  const motorPowers = (reference.power30MinKwByMotor || []).map(Number).filter((value) => positive(value, 2_000));
  const total30 = positive(reference.power30MinKw, 2_000)
    || (motorPowers.length ? Math.round(motorPowers.reduce((sum, value) => sum + value, 0) * 100) / 100 : undefined);
  return {
    ...offer,
    powerHp: Number(reference.powerHp),
    powerKw: positive(reference.powerKw, 2_000) || Math.round((Number(reference.powerHp) / 1.35962) * 100) / 100,
    powertrainKind: reference.powertrainKind || offer.powertrainKind,
    icePowerKw: positive(reference.icePowerKw, 2_000) || offer.icePowerKw,
    power30MinKwByMotor: motorPowers.length ? motorPowers : offer.power30MinKwByMotor,
    power30MinKw: total30 || offer.power30MinKw,
    utilizationPowerKw: positive(reference.utilizationPowerKw, 4_000) || offer.utilizationPowerKw,
    powerDataConfidence: "reference" as PowerDataConfidence,
    powerDataSource: `power-knowledge:${reference.id}`,
    operational: {
      ...offer.operational,
      raw: {
        ...(typeof offer.operational?.raw === "object" && offer.operational.raw ? offer.operational.raw as object : {}),
        powerKnowledgeReference: reference,
      },
    },
  } as T;
}
