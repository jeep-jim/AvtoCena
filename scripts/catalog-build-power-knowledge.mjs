import crypto from "node:crypto";

const { appendChunkedDataJson, readChunkedDataJson } = await import("../apps/web/lib/data.ts");
const { normalizeVehicleOfferSpecs } = await import("../apps/web/lib/catalog/spec-normalization.ts");
const { readAllOffersForMaintenance } = await import("../apps/web/lib/catalog/storage.ts");

const targetPath = "catalog/power-knowledge/vehicles.json";
const offers = await readAllOffersForMaintenance();
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
  if (!offer.make || !offer.model || !offer.year || powerHp <= 0) continue;
  if (["estimated", "reference"].includes(String(offer.powerDataConfidence || ""))) continue;
  const key = signature(offer);
  const current = groups.get(key) || [];
  current.push(offer);
  groups.set(key, current);
}

const report = {
  scanned: offers.length,
  signatures: groups.size,
  accepted: 0,
  conflicts: 0,
  duplicates: 0,
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
  const id = `power_${crypto.createHash("sha256").update(`${key}|${powers[0]}`).digest("hex").slice(0, 24)}`;
  if (existingIds.has(id)) {
    report.duplicates++;
    continue;
  }

  const thirtyMinutePowers = rows
    .map((row) => Number(row.power30MinKw || 0))
    .filter((value) => value > 0);
  const uniqueThirtyMinute = [...new Set(thirtyMinutePowers.map((value) => Math.round(value * 100) / 100))];
  const icePowers = [...new Set(rows.map((row) => Number(row.icePowerKw || 0)).filter((value) => value > 0).map((value) => Math.round(value * 100) / 100))];
  const utilizationPowers = [...new Set(rows.map((row) => Number(row.utilizationPowerKw || 0)).filter((value) => value > 0).map((value) => Math.round(value * 100) / 100))];

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
    utilizationPowerKw: utilizationPowers.length === 1 ? utilizationPowers[0] : undefined,
    confidence: sourceIds.length > 1 || rows.length > 1 ? "source_consensus" : "registry",
    sourceIds,
    sourceUrl: sample.operational?.sourceUrl || undefined,
    verifiedAt: report.generatedAt,
    active: true,
  };
  await appendChunkedDataJson(targetPath, entry, 250);
  existingIds.add(id);
  report.accepted++;
}

console.log(JSON.stringify(report, null, 2));
