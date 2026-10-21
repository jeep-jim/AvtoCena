import fs from "node:fs/promises";

const { findVehicleModel, readVehicleKnowledgeVariants } = await import("../apps/web/lib/catalog/vehicle-knowledge.ts");

const input = process.env.PRESTIGE_FRAME_INPUT || "prestige-japan-exact-sold-partial-live.json";
const output = process.env.PRESTIGE_FRAME_OUTPUT || "prestige-japan-exact-sold-frame-enriched.json";

function compact(value) {
  return String(value || "").toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/g, "");
}
function positive(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
function yearCompatible(variant, offer) {
  const year = Number(offer.year || 0);
  if (variant.yearFrom && (!year || year < variant.yearFrom)) return false;
  if (variant.yearTo && (!year || year > variant.yearTo)) return false;
  return true;
}
function engineCompatible(variant, offer) {
  if (!positive(variant.engineCc)) return true;
  const engine = positive(offer.engineCc);
  if (!engine) return false;
  const tolerance = Math.max(20, Number(variant.engineCcTolerance || 80));
  return Math.abs(Number(variant.engineCc) - engine) <= tolerance;
}
function frameMatches(variant, offer) {
  const frame = compact(offer.frameNumber);
  if (!frame) return false;
  const values = [variant.generation, ...(variant.generationAliases || [])].map(compact).filter(Boolean);
  return values.includes(frame);
}
function trusted(variant) {
  return ["manufacturer", "official_registry"].includes(String(variant.sourceType || ""));
}
function sameArray(left, right) {
  return JSON.stringify(left || []) === JSON.stringify(right || []);
}
function uniqueValue(rows, selector, normalize = (value) => value) {
  const values = [...new Map(rows
    .map(selector)
    .filter((value) => value !== undefined && value !== null && value !== "")
    .map((value) => [JSON.stringify(normalize(value)), value])).values()];
  return values.length === 1 ? values[0] : undefined;
}

const payload = JSON.parse(await fs.readFile(input, "utf8"));
const offers = Array.isArray(payload?.offers) ? payload.offers : [];
const variants = await readVehicleKnowledgeVariants();
const stats = { input: offers.length, modelMatched: 0, exactFrameMatched: 0, uniqueTrustedVariantData: 0, enriched: 0 };
const enriched = [];

for (const raw of offers) {
  const offer = { ...raw, operational: { ...(raw.operational || {}), raw: { ...(raw.operational?.raw || {}) } } };
  const modelMatch = await findVehicleModel(offer).catch(() => null);
  if (!modelMatch) { enriched.push(offer); continue; }
  stats.modelMatched++;
  const frameRows = variants.filter((variant) => variant.active !== false
    && variant.modelId === modelMatch.model.id
    && trusted(variant)
    && yearCompatible(variant, offer)
    && engineCompatible(variant, offer)
    && frameMatches(variant, offer));
  if (!frameRows.length) { enriched.push(offer); continue; }
  stats.exactFrameMatched++;

  const powerHp = uniqueValue(frameRows, (variant) => positive(variant.powerHp) || undefined, (value) => Math.round(Number(value) * 10) / 10);
  const powerKw = uniqueValue(frameRows, (variant) => positive(variant.powerKw) || undefined, (value) => Math.round(Number(value) * 10) / 10);
  const powertrainKind = uniqueValue(frameRows, (variant) => variant.powertrainKind);
  const icePowerKw = uniqueValue(frameRows, (variant) => positive(variant.icePowerKw) || undefined, (value) => Math.round(Number(value) * 10) / 10);
  const power30MinKw = uniqueValue(frameRows, (variant) => positive(variant.power30MinKw) || undefined, (value) => Math.round(Number(value) * 100) / 100);
  const power30MinKwByMotor = uniqueValue(frameRows, (variant) => Array.isArray(variant.power30MinKwByMotor) && variant.power30MinKwByMotor.length ? variant.power30MinKwByMotor.map(Number) : undefined, (value) => value.map((item) => Math.round(Number(item) * 100) / 100));
  const utilizationPowerKw = uniqueValue(frameRows, (variant) => positive(variant.utilizationPowerKw) || undefined, (value) => Math.round(Number(value) * 100) / 100);

  if (!powerHp || !powertrainKind) { enriched.push(offer); continue; }
  const electrified = ["electric", "series_hybrid", "other_hybrid"].includes(String(powertrainKind));
  const motor30 = positive(power30MinKw) || (Array.isArray(power30MinKwByMotor) ? power30MinKwByMotor.reduce((sum, value) => sum + positive(value), 0) : 0);
  if (electrified && !positive(utilizationPowerKw) && !motor30) { enriched.push(offer); continue; }
  if (powertrainKind === "other_hybrid" && !positive(icePowerKw)) { enriched.push(offer); continue; }
  stats.uniqueTrustedVariantData++;

  const sources = [...new Set(frameRows.map((variant) => variant.sourceUrl || `${variant.sourceType}:${variant.id}`).filter(Boolean))];
  const ids = frameRows.map((variant) => variant.id);
  const sourceTypes = [...new Set(frameRows.map((variant) => variant.sourceType))];
  const updated = {
    ...offer,
    powerHp,
    powerKw: positive(offer.powerKw) || powerKw || Math.round((Number(powerHp) / 1.359621617) * 10) / 10,
    powertrainKind,
    icePowerKw: positive(offer.icePowerKw) || icePowerKw,
    power30MinKw: positive(offer.power30MinKw) || power30MinKw,
    power30MinKwByMotor: Array.isArray(offer.power30MinKwByMotor) && offer.power30MinKwByMotor.length ? offer.power30MinKwByMotor : power30MinKwByMotor,
    utilizationPowerKw: positive(offer.utilizationPowerKw) || utilizationPowerKw,
    powerDataConfidence: "documented",
    powerDataSource: sources.join(" | "),
    operational: {
      ...offer.operational,
      raw: {
        ...(offer.operational?.raw || {}),
        exactFrameVariantIds: ids,
        exactFrameVariantSources: sources,
        exactFrameVariantSourceTypes: sourceTypes,
        exactFrameVerified: true,
        vehicleKnowledgeVariant: { id: ids[0], sourceType: sourceTypes[0] },
      },
    },
  };
  if (!sameArray(updated.power30MinKwByMotor, offer.power30MinKwByMotor) || updated.powerHp !== offer.powerHp || updated.powertrainKind !== offer.powertrainKind) stats.enriched++;
  enriched.push(updated);
}

const report = { version: 1, mode: "prestige_exact_chassis_manufacturer_enrichment", stats };
await fs.writeFile(output, JSON.stringify({ ...payload, offers: enriched, frameEnrichmentReport: report }, null, 2));
console.log(JSON.stringify(report, null, 2));
