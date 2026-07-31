import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const { appendChunkedDataJson, readChunkedDataJson } = await import("../apps/web/lib/data.ts");
const { normalizeVehicleOfferSpecs } = await import("../apps/web/lib/catalog/spec-normalization.ts");
const { readAllOffersForMaintenance } = await import("../apps/web/lib/catalog/storage.ts");

const targetPath = "catalog/power-knowledge/vehicles.json";
const TRUSTED_EXACT_SOURCES = new Set([
  "encar_direct",
  "dubicars_uae_exact",
  "otomoto_europe_exact",
  "myauto_georgia_list",
  "auto_georgia_open",
  "mashina_kyrgyzstan_exact",
]);

async function artifactOffers(inputDirectory) {
  if (!inputDirectory) return [];
  const result = [];
  async function walk(directory) {
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(file);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const payload = JSON.parse(await fs.readFile(file, "utf8").catch(() => "null"));
      if (Array.isArray(payload?.offers)) result.push(...payload.offers);
    }
  }
  await walk(inputDirectory);
  return result;
}

const storedOffers = await readAllOffersForMaintenance();
const collectedOffers = await artifactOffers(process.env.CATALOG_POWER_INPUT_DIR || process.env.CATALOG_VARIANT_INPUT_DIR || "");
const offerMap = new Map();
for (const offer of [...storedOffers, ...collectedOffers]) if (offer?.id) offerMap.set(String(offer.id), offer);
const offers = [...offerMap.values()];
const existing = await readChunkedDataJson(targetPath, []);
const existingIds = new Set(existing.map((row) => row.id));
const groups = new Map();

function token(value) {
  return String(value || "")
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function roundedEngine(value) {
  const engine = Number(value || 0);
  return engine > 0 ? Math.round(engine / 10) * 10 : 0;
}

function signature(offer) {
  return [
    token(offer.make),
    token(offer.model),
    Number(offer.year || 0),
    roundedEngine(offer.engineCc),
    token(offer.fuel),
    token(offer.powertrainKind),
  ].join("|");
}

for (const raw of offers) {
  const offer = normalizeVehicleOfferSpecs(raw);
  const powerHp = Number(offer.powerHp || 0);
  if (!offer.make || !offer.model || !offer.year || powerHp <= 0 || powerHp > 2_500) continue;
  if (["estimated", "reference"].includes(String(offer.powerDataConfidence || ""))) continue;
  const key = signature(offer);
  const current = groups.get(key) || [];
  current.push(offer);
  groups.set(key, current);
}

const report = {
  storedOffers: storedOffers.length,
  collectedOffers: collectedOffers.length,
  scanned: offers.length,
  signatures: groups.size,
  accepted: 0,
  conflicts: 0,
  insufficientEvidence: 0,
  duplicates: 0,
  acceptedThirtyMinute: 0,
  generatedAt: new Date().toISOString(),
};

for (const [key, rows] of groups) {
  const powers = [...new Set(rows.map((row) => Math.round(Number(row.powerHp) * 10) / 10))];
  if (powers.length !== 1) {
    report.conflicts++;
    continue;
  }
  const sample = rows[0];
  const sourceIds = [...new Set(rows.map((row) => String(row.sourceId || "")).filter(Boolean))];
  const exactEvidence = rows.some((row) => ["documented", "source_exact"].includes(String(row.powerDataConfidence || "")))
    || sourceIds.some((sourceId) => TRUSTED_EXACT_SOURCES.has(sourceId));
  if (!exactEvidence && sourceIds.length < 2) {
    report.insufficientEvidence++;
    continue;
  }
  const id = `power_${crypto.createHash("sha256").update(`${key}|${powers[0]}`).digest("hex").slice(0, 24)}`;
  if (existingIds.has(id)) {
    report.duplicates++;
    continue;
  }

  const uniqueThirtyMinute = [...new Set(rows.map((row) => Number(row.power30MinKw || 0)).filter((value) => value > 0).map((value) => Math.round(value * 100) / 100))];
  const icePowers = [...new Set(rows.map((row) => Number(row.icePowerKw || 0)).filter((value) => value > 0).map((value) => Math.round(value * 100) / 100))];
  const utilizationPowers = [...new Set(rows.map((row) => Number(row.utilizationPowerKw || 0)).filter((value) => value > 0).map((value) => Math.round(value * 100) / 100))];
  const motorPowerSignatures = [...new Set(rows
    .map((row) => Array.isArray(row.power30MinKwByMotor) ? row.power30MinKwByMotor.map(Number).filter((value) => value > 0).map((value) => Math.round(value * 100) / 100) : [])
    .filter((values) => values.length)
    .map((values) => JSON.stringify(values)))];

  const entry = {
    id,
    make: sample.make,
    model: sample.model,
    yearFrom: sample.year,
    yearTo: sample.year,
    engineCc: roundedEngine(sample.engineCc) || undefined,
    engineCcTolerance: 80,
    fuel: sample.fuel || undefined,
    powertrainKind: sample.powertrainKind && sample.powertrainKind !== "unknown" ? sample.powertrainKind : undefined,
    powerHp: powers[0],
    powerKw: Number(sample.powerKw || 0) || Math.round((powers[0] / 1.35962) * 100) / 100,
    icePowerKw: icePowers.length === 1 ? icePowers[0] : undefined,
    power30MinKw: uniqueThirtyMinute.length === 1 ? uniqueThirtyMinute[0] : undefined,
    power30MinKwByMotor: motorPowerSignatures.length === 1 ? JSON.parse(motorPowerSignatures[0]) : undefined,
    utilizationPowerKw: utilizationPowers.length === 1 ? utilizationPowers[0] : undefined,
    confidence: sourceIds.length > 1 ? "source_consensus" : "registry",
    sourceIds,
    sourceUrl: sample.operational?.sourceUrl || undefined,
    verifiedAt: report.generatedAt,
    active: true,
  };
  await appendChunkedDataJson(targetPath, entry, 250);
  existingIds.add(id);
  report.accepted++;
  if (entry.power30MinKw || entry.power30MinKwByMotor?.length) report.acceptedThirtyMinute++;
}

console.log(JSON.stringify(report, null, 2));
