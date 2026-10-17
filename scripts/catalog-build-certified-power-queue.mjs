import crypto from "node:crypto";

const { writeDataJson } = await import("../apps/web/lib/data.ts");
const { replaceChunkedDataJson } = await import("../apps/web/lib/replace-chunked-data.ts");
const { normalizeVehicleOfferSpecs } = await import("../apps/web/lib/catalog/spec-normalization.ts");
const { readAllOffersForMaintenance } = await import("../apps/web/lib/catalog/storage.ts");

const QUEUE_PATH = "catalog/power-reference/review-queue.json";
const REPORT_PATH = "catalog/power-reference/review-queue-report.json";
const offers = await readAllOffersForMaintenance();
const generatedAt = new Date().toISOString();
const groups = new Map();

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function token(value) {
  return clean(value)
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function positive(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) / 100 : undefined;
}

function needsCertifiedPower(offer) {
  const kind = String(offer.powertrainKind || "unknown");
  const thirtyMinute = positive(offer.power30MinKw)
    || (Array.isArray(offer.power30MinKwByMotor)
      ? positive(offer.power30MinKwByMotor.reduce((sum, value) => sum + Number(value || 0), 0))
      : undefined);
  if (kind === "electric" || kind === "series_hybrid") {
    return thirtyMinute ? [] : ["power30MinKw"];
  }
  if (kind === "other_hybrid") {
    const missing = [];
    if (!positive(offer.icePowerKw)) missing.push("icePowerKw");
    if (!thirtyMinute) missing.push("power30MinKw");
    return missing;
  }
  return [];
}

function groupKey(offer) {
  // Certified 30-minute power is variant-specific. Do not collapse different
  // trims, drive layouts or peak-power variants into one research item merely
  // because make/model/year happen to match.
  return [
    token(offer.make),
    token(offer.model),
    Number(offer.year || 0),
    token(offer.generation),
    token(offer.trim),
    token(offer.drive),
    Number(offer.engineCc || 0),
    positive(offer.powerKw) || 0,
    positive(offer.powerHp) || 0,
    token(offer.powertrainKind),
  ].join("|");
}

for (const raw of offers) {
  const offer = normalizeVehicleOfferSpecs(raw);
  const missing = needsCertifiedPower(offer);
  if (!missing.length || !offer.make || !offer.model || !offer.year) continue;
  const key = groupKey(offer);
  const group = groups.get(key) || {
    make: offer.make,
    model: offer.model,
    year: offer.year,
    generation: clean(offer.generation) || undefined,
    engineCc: positive(offer.engineCc),
    powertrainKind: offer.powertrainKind,
    missing: new Set(),
    trims: new Set(),
    drives: new Set(),
    sourceIds: new Set(),
    sourceUrls: new Set(),
    offerIds: new Set(),
    peakPowersHp: new Set(),
    peakPowersKw: new Set(),
  };
  missing.forEach((field) => group.missing.add(field));
  if (offer.trim) group.trims.add(clean(offer.trim));
  if (offer.drive) group.drives.add(clean(offer.drive));
  if (offer.sourceId) group.sourceIds.add(clean(offer.sourceId));
  if (offer.operational?.sourceUrl) group.sourceUrls.add(clean(offer.operational.sourceUrl));
  group.offerIds.add(offer.id);
  if (positive(offer.powerHp)) group.peakPowersHp.add(positive(offer.powerHp));
  if (positive(offer.powerKw)) group.peakPowersKw.add(positive(offer.powerKw));
  groups.set(key, group);
}

const queue = [...groups.entries()].map(([key, group]) => ({
  id: `power_review_${crypto.createHash("sha256").update(key).digest("hex").slice(0, 24)}`,
  status: "pending_document",
  make: group.make,
  model: group.model,
  yearFrom: group.year,
  yearTo: group.year,
  generation: group.generation,
  engineCc: group.engineCc,
  powertrainKind: group.powertrainKind,
  missing: [...group.missing],
  sampleTrims: [...group.trims].slice(0, 20),
  drives: [...group.drives].slice(0, 10),
  peakPowersHp: [...group.peakPowersHp].slice(0, 20),
  peakPowersKw: [...group.peakPowersKw].slice(0, 20),
  sourceIds: [...group.sourceIds],
  sourceUrls: [...group.sourceUrls].slice(0, 20),
  offerIds: [...group.offerIds].slice(0, 100),
  offersCount: group.offerIds.size,
  requiredDocumentTypes: ["OTTS", "SBKTS", "ZOETS", "EPTS", "COC", "KBA_registration_data", "manufacturer_document"],
  generatedAt,
})).sort((left, right) => right.offersCount - left.offersCount
  || left.make.localeCompare(right.make, "ru")
  || left.model.localeCompare(right.model, "ru")
  || right.yearFrom - left.yearFrom);

await replaceChunkedDataJson(QUEUE_PATH, queue, 250);
const report = {
  generatedAt,
  scannedOffers: offers.length,
  pendingGroups: queue.length,
  affectedOffers: queue.reduce((sum, item) => sum + item.offersCount, 0),
  byPowertrain: queue.reduce((totals, item) => {
    totals[item.powertrainKind] = (totals[item.powertrainKind] || 0) + 1;
    return totals;
  }, {}),
  top: queue.slice(0, 50).map((item) => ({
    make: item.make,
    model: item.model,
    year: item.yearFrom,
    trim: item.sampleTrims[0],
    drive: item.drives[0],
    peakPowersKw: item.peakPowersKw,
    powertrainKind: item.powertrainKind,
    offersCount: item.offersCount,
    missing: item.missing,
  })),
};
await writeDataJson(REPORT_PATH, report);
console.log(JSON.stringify(report, null, 2));
