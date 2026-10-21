import crypto from "node:crypto";

const { appendChunkedDataJson } = await import("../apps/web/lib/data.ts");
const { normalizeVehicleOfferSpecs } = await import("../apps/web/lib/catalog/spec-normalization.ts");
const { readAllOffersForMaintenance } = await import("../apps/web/lib/catalog/storage.ts");

const offers = await readAllOffersForMaintenance();
const collection = "catalog/power-review/queue.json";
const report = {
  scanned: offers.length,
  candidates: 0,
  queued: 0,
  skipped: 0,
  generatedAt: new Date().toISOString(),
};

function token(value) {
  return String(value || "")
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function queueId(offer) {
  const identity = [offer.make, offer.model, offer.trim, offer.year, offer.powertrainKind]
    .map(token)
    .join("|");
  return `power_review_${crypto.createHash("sha256").update(identity).digest("hex").slice(0, 24)}`;
}

for (const raw of offers) {
  const offer = normalizeVehicleOfferSpecs(raw);
  const kind = offer.powertrainKind;
  const needsThirtyMinute = kind === "electric" || kind === "series_hybrid" || kind === "other_hybrid";
  if (!needsThirtyMinute || Number(offer.power30MinKw || 0) > 0) {
    report.skipped++;
    continue;
  }

  report.candidates++;
  const entry = {
    id: queueId(offer),
    status: "needs_document",
    make: offer.make,
    model: offer.model,
    trim: offer.trim || "",
    year: offer.year,
    market: offer.market,
    sourceId: offer.sourceId,
    sourceOfferId: offer.sourceOfferId,
    sourceUrl: offer.operational?.sourceUrl || "",
    powertrainKind: kind,
    engineCc: offer.engineCc,
    peakPowerHp: offer.powerHp,
    peakPowerKw: offer.powerKw,
    icePowerKw: offer.icePowerKw,
    missing: kind === "other_hybrid"
      ? ["ice_power_kw", "traction_motor_30_minute_power_kw"]
      : ["traction_motor_30_minute_power_kw"],
    acceptedDocuments: ["OTTS", "SBKTS", "ZOETS", "EPTS", "COC", "manufacturer_document"],
    firstQueuedAt: report.generatedAt,
  };
  await appendChunkedDataJson(collection, entry, 500);
  report.queued++;
}

console.log(JSON.stringify(report, null, 2));
