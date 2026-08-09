import fs from "node:fs";

const data = JSON.parse(fs.readFileSync("georgia-live-smoke.json", "utf8"));
const offers = Array.isArray(data.offers) ? data.offers : [];
const reports = Array.isArray(data.reports) ? data.reports : [];
console.log(JSON.stringify({
  count: offers.length,
  reports,
  sample: offers.slice(0, 5).map((offer) => ({
    make: offer.make,
    model: offer.model,
    year: offer.year,
    engineCc: offer.engineCc,
    powerHp: offer.powerHp,
    fuel: offer.fuel,
    powertrainKind: offer.powertrainKind,
    totalRub: offer.totalRub,
    sourceUrl: offer.operational?.sourceUrl,
    images: offer.images?.length,
  })),
}, null, 2));
if (offers.length < 1) throw new Error("georgia_live_smoke_zero_exact_offers");
for (const offer of offers) {
  if (!/^https?:\/\/(?:www\.)?auto\.ge\//i.test(String(offer.operational?.sourceUrl || ""))) throw new Error("georgia_live_smoke_source_url");
  if (!(Number(offer.totalRub || 0) > 0)) throw new Error("georgia_live_smoke_total_rub");
  if (offer.calculationSnapshot?.customs?.status !== "ready") throw new Error("georgia_live_smoke_customs_not_ready");
  if (!Array.isArray(offer.images) || offer.images.length < 1) throw new Error("georgia_live_smoke_images");
}
