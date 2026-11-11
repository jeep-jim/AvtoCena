import fs from "node:fs/promises";

const { readMarketOffers } = await import("../apps/web/lib/catalog/storage.ts");
const { credibleCatalogImages } = await import("../apps/web/lib/catalog/offer-quality.ts");
const { normalizeVehicleOfferSpecs } = await import("../apps/web/lib/catalog/spec-normalization.ts");

const output = process.env.JAPAN_STRICT_AUDIT_OUTPUT || "catalog-japan-current-strict-audit.json";
const minYear = new Date().getFullYear() - 15;

function exactCalculation(offer) {
  const total = Number(offer?.totalRub || 0);
  const customs = offer?.calculationSnapshot?.customs;
  const breakdown = offer?.calculationSnapshot?.breakdown;
  if (!(total > 0) || customs?.status !== "ready" || !Number.isFinite(Number(customs?.totalCustomsRub))) return false;
  if (!Array.isArray(breakdown) || !breakdown.some((line) => line?.id === "car") || !breakdown.some((line) => line?.id === "customs")) return false;
  const kind = String(offer?.powertrainKind || "");
  if (!["electric", "series_hybrid", "other_hybrid"].includes(kind)) return Number(offer?.engineCc || 0) > 0 && Number(offer?.powerHp || 0) > 0;
  if (Number(offer?.utilizationPowerKw || 0) > 0) return true;
  const motor30 = Number(offer?.power30MinKw || 0) || (Array.isArray(offer?.power30MinKwByMotor) ? offer.power30MinKwByMotor.reduce((sum, value) => sum + Math.max(0, Number(value || 0)), 0) : 0);
  return kind === "other_hybrid" ? motor30 > 0 && Number(offer?.icePowerKw || 0) > 0 : motor30 > 0;
}
function soldSemantics(offer) {
  return offer?.market === "japan"
    && offer?.offerType === "auction"
    && offer?.catalogKind === "auction_result"
    && offer?.auctionResult === "sold"
    && offer?.auctionPriceKind === "published_result"
    && Number(offer?.sourcePrice || 0) > 0;
}
function exactIdentity(offer) {
  const op = offer?.operational || {};
  const raw = op?.raw || {};
  return /^https?:\/\//i.test(String(op.sourceUrl || ""))
    && (op.photoIdentityVerified === true || raw.photoIdentityVerified === true || raw.detailIdentityVerified === true || raw.listingBoundImages === true)
    && credibleCatalogImages(offer?.images || []).length >= 3;
}

const rows = await readMarketOffers("japan");
const rejection = {};
const accepted = [];
const reject = (reason) => { rejection[reason] = Number(rejection[reason] || 0) + 1; };
for (const raw of rows) {
  const offer = normalizeVehicleOfferSpecs({ ...raw, images: credibleCatalogImages(raw?.images || []).slice(0, 30) });
  if (Number(offer.year || 0) < minYear || Number(offer.year || 0) > new Date().getFullYear() + 1) { reject("year"); continue; }
  if (!soldSemantics(offer)) { reject("sold_semantics"); continue; }
  if (!exactIdentity(offer)) { reject("exact_identity"); continue; }
  if (!exactCalculation(offer)) { reject("calculation"); continue; }
  accepted.push(offer);
}
const report = {
  version: 1,
  mode: "current_japan_strict_sold_calculated_audit",
  totalCurrent: rows.length,
  strictAccepted: accepted.length,
  sourceCounts: Object.fromEntries([...new Set(accepted.map((offer) => String(offer.sourceId || "unknown")))].map((sourceId) => [sourceId, accepted.filter((offer) => String(offer.sourceId || "unknown") === sourceId).length])),
  rejected: rejection,
};
await fs.writeFile(output, JSON.stringify({ report, accepted }, null, 2));
console.log(JSON.stringify(report, null, 2));
