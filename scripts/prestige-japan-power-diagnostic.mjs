import fs from "node:fs/promises";

const { findVehicleModel, readVehicleKnowledgeVariants } = await import("../apps/web/lib/catalog/vehicle-knowledge.ts");
const { findCertifiedPowerReference } = await import("../apps/web/lib/catalog/power-reference.ts");
const { findVehiclePowerKnowledge } = await import("../apps/web/lib/catalog/power-knowledge.ts");

const input = process.env.PRESTIGE_DIAGNOSTIC_INPUT || "prestige-japan-exact-sold-partial-live.json";
const output = process.env.PRESTIGE_DIAGNOSTIC_OUTPUT || "prestige-japan-power-diagnostic.json";
const minYear = new Date().getFullYear() - 15;
const maxOffersPerModel = 20;
const maxModelsPerMake = 10;

function compact(value) {
  return String(value || "").toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/g, "");
}
function positive(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
function makeKey(offer) { return String(offer?.make || "").trim().toLowerCase().replace(/\s+/g, " "); }
function modelKey(offer) {
  const make = makeKey(offer);
  const model = String(offer?.model || "").trim().toLowerCase().replace(/\s+/g, " ");
  return make && model ? `${make}|${model}` : "";
}
function priority(a, b) {
  return Number(b.year || 0) - Number(a.year || 0)
    || Number(a.sourcePrice || Number.MAX_SAFE_INTEGER) - Number(b.sourcePrice || Number.MAX_SAFE_INTEGER)
    || Number(b.images?.length || 0) - Number(a.images?.length || 0);
}
function select(rows) {
  const counts = new Map();
  const modelsByMake = new Map();
  const result = [];
  for (const offer of rows) {
    const make = makeKey(offer);
    const key = modelKey(offer);
    const count = Number(counts.get(key) || 0);
    if (key && count >= maxOffersPerModel) continue;
    const makeModels = make ? (modelsByMake.get(make) || new Set()) : null;
    if (make && key && !makeModels.has(key) && makeModels.size >= maxModelsPerMake) continue;
    result.push(offer);
    if (key) counts.set(key, count + 1);
    if (make && key) { makeModels.add(key); modelsByMake.set(make, makeModels); }
  }
  return result;
}
function engineCompatible(variant, offer) {
  if (!positive(variant.engineCc)) return true;
  const engine = positive(offer.engineCc);
  if (!engine) return false;
  const tolerance = Math.max(20, Number(variant.engineCcTolerance || 80));
  return Math.abs(Number(variant.engineCc) - engine) <= tolerance;
}
function yearCompatible(variant, offer) {
  const year = Number(offer.year || 0);
  if (variant.yearFrom && year < variant.yearFrom) return false;
  if (variant.yearTo && year > variant.yearTo) return false;
  return true;
}
function frameMatches(variant, offer) {
  const frame = compact(offer.frameNumber);
  if (!frame) return false;
  const values = [variant.generation, ...(variant.generationAliases || [])].map(compact).filter(Boolean);
  return values.includes(frame);
}
function trustedVariant(variant) {
  return ["manufacturer", "official_registry"].includes(String(variant.sourceType || ""));
}

const payload = JSON.parse(await fs.readFile(input, "utf8"));
const candidates = select((Array.isArray(payload?.offers) ? payload.offers : [])
  .filter((offer) => Number(offer?.year || 0) >= minYear)
  .sort(priority));
const variants = await readVehicleKnowledgeVariants();
const counters = {
  candidates: candidates.length,
  sourcePowerPresent: 0,
  sourceEnginePresent: 0,
  modelMatched: 0,
  anyVariantMatch: 0,
  frameVariantMatch: 0,
  trustedFrameVariantMatch: 0,
  trustedFrameUniquePower: 0,
  trustedFrameHybridPowerComplete: 0,
  certifiedReference: 0,
  powerKnowledgeReference: 0,
};
const samples = [];
for (const offer of candidates) {
  if (positive(offer.powerHp)) counters.sourcePowerPresent++;
  if (positive(offer.engineCc)) counters.sourceEnginePresent++;
  const modelMatch = await findVehicleModel(offer).catch(() => null);
  if (!modelMatch) continue;
  counters.modelMatched++;
  const compatible = variants.filter((variant) => variant.modelId === modelMatch.model.id && yearCompatible(variant, offer) && engineCompatible(variant, offer));
  if (compatible.length) counters.anyVariantMatch++;
  const frame = compatible.filter((variant) => frameMatches(variant, offer));
  if (frame.length) counters.frameVariantMatch++;
  const trusted = frame.filter(trustedVariant);
  if (trusted.length) counters.trustedFrameVariantMatch++;
  const powers = [...new Set(trusted.map((variant) => Number(variant.powerHp || 0)).filter((value) => value > 0).map((value) => Math.round(value * 10) / 10))];
  if (powers.length === 1) counters.trustedFrameUniquePower++;
  const electrifiedComplete = trusted.some((variant) => {
    const kind = String(variant.powertrainKind || "");
    if (!["electric", "series_hybrid", "other_hybrid"].includes(kind)) return powers.length === 1;
    const motor30 = positive(variant.power30MinKw) || (Array.isArray(variant.power30MinKwByMotor) ? variant.power30MinKwByMotor.reduce((sum, value) => sum + positive(value), 0) : 0);
    return motor30 > 0 && (kind !== "other_hybrid" || positive(variant.icePowerKw) > 0);
  });
  if (electrifiedComplete) counters.trustedFrameHybridPowerComplete++;
  const certified = await findCertifiedPowerReference(offer).catch(() => null);
  if (certified) counters.certifiedReference++;
  const powerKnowledge = await findVehiclePowerKnowledge(offer).catch(() => null);
  if (powerKnowledge) counters.powerKnowledgeReference++;
  if (samples.length < 80 && (frame.length || certified || powerKnowledge)) {
    samples.push({
      sourceOfferId: offer.sourceOfferId,
      title: offer.sourceTitle,
      frameNumber: offer.frameNumber,
      engineCc: offer.engineCc,
      modelId: modelMatch.model.id,
      compatibleVariants: compatible.length,
      frameVariants: frame.map((variant) => ({
        id: variant.id,
        generation: variant.generation,
        generationAliases: variant.generationAliases,
        sourceType: variant.sourceType,
        sourceUrl: variant.sourceUrl,
        powerHp: variant.powerHp,
        powertrainKind: variant.powertrainKind,
        icePowerKw: variant.icePowerKw,
        power30MinKw: variant.power30MinKw,
        power30MinKwByMotor: variant.power30MinKwByMotor,
        utilizationPowerKw: variant.utilizationPowerKw,
      })),
      certifiedReference: certified ? { id: certified.id, sourceDocumentType: certified.sourceDocumentType, sourceDocumentId: certified.sourceDocumentId, powertrainKind: certified.powertrainKind, icePowerKw: certified.icePowerKw, power30MinKw: certified.power30MinKw, power30MinKwByMotor: certified.power30MinKwByMotor, utilizationPowerKw: certified.utilizationPowerKw } : null,
      powerKnowledgeReference: powerKnowledge ? { id: powerKnowledge.id, confidence: powerKnowledge.confidence, sourceUrl: powerKnowledge.sourceUrl, powerHp: powerKnowledge.powerHp, powertrainKind: powerKnowledge.powertrainKind, icePowerKw: powerKnowledge.icePowerKw, power30MinKw: powerKnowledge.power30MinKw, power30MinKwByMotor: powerKnowledge.power30MinKwByMotor, utilizationPowerKw: powerKnowledge.utilizationPowerKw } : null,
    });
  }
}
const report = { version: 1, mode: "prestige_japan_exact_power_diagnostic", minYear, counters, samples };
await fs.writeFile(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify(counters, null, 2));
console.log(JSON.stringify(samples.slice(0, 20), null, 2));
