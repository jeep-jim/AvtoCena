import crypto from "node:crypto";
import { readMarketOffers } from "../apps/web/lib/catalog/storage.ts";
import { PUBLIC_CATALOG_MARKETS } from "../apps/web/lib/catalog/runtime-config.ts";
import { normalizeVehicleOfferSpecs } from "../apps/web/lib/catalog/spec-normalization.ts";
import { enrichOfferWithVehicleKnowledge } from "../apps/web/lib/catalog/vehicle-knowledge.ts";
import { hasCredibleOfferContent } from "../apps/web/lib/catalog/offer-quality.ts";
import { autoscoutEuropeHqSource } from "../apps/web/lib/catalog/autoscout-hq-source.ts";

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}
function hashOffers(offers) {
  const sorted = [...offers].sort((a,b) => String(a.id || a.sourceOfferId || "").localeCompare(String(b.id || b.sourceOfferId || "")));
  return crypto.createHash("sha256").update(JSON.stringify(canonical(sorted))).digest("hex");
}
function hqBound(image, sourceOfferId) {
  const url = String(image?.url || "");
  const match = url.match(/\/(\d{2,5})x(\d{2,5})\.(?:jpe?g|webp|avif|png)(?:[?#]|$)/i);
  const width = Number(image?.width || match?.[1] || 0), height = Number(image?.height || match?.[2] || 0);
  return /^https:\/\/prod\.pictures\.autoscout24\.net\/listing-images\//i.test(url)
    && url.toLowerCase().includes(`/listing-images/${String(sourceOfferId).toLowerCase()}_`)
    && width >= 900 && height >= 600;
}
async function mapLimit(items, limit, mapper) {
  const result = new Array(items.length); let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, Math.max(1, items.length)) }, async () => {
    while (true) { const index = cursor++; if (index >= items.length) return; result[index] = await mapper(items[index]); }
  }));
  return result;
}

const markets = [...PUBLIC_CATALOG_MARKETS];
const snapshots = Object.fromEntries(await Promise.all(markets.map(async (market) => [market, await readMarketOffers(market)])));
const baseline = Object.fromEntries(markets.map((market) => [market, { count: snapshots[market].length, hash: hashOffers(snapshots[market]) }]));
const nonEurope = markets.filter((market) => market !== "europe");
const roundTrip = {};
for (const market of nonEurope) {
  const normalized = await mapLimit(snapshots[market], 12, async (offer) => normalizeVehicleOfferSpecs(await enrichOfferWithVehicleKnowledge(structuredClone(offer))));
  const currentHash = hashOffers(normalized);
  const notRepublishable = normalized.filter((offer) => offer.status !== "active" || !hasCredibleOfferContent(offer)).map((offer) => offer.id);
  roundTrip[market] = { hash: currentHash, identical: currentHash === baseline[market].hash, count: normalized.length, notRepublishableCount: notRepublishable.length, notRepublishable: notRepublishable.slice(0, 20) };
}

const europe = snapshots.europe || [];
const autoscout = europe.filter((offer) => offer.sourceId === "autoscout_europe_open" && Number(offer.year || 0) >= 2020 && String(offer?.operational?.sourceUrl || "").includes(String(offer.sourceOfferId || "")));
const sampleLimit = Math.max(1, Math.min(50, Number(process.env.EUROPE_HQ_AUDIT_LIMIT || 20)));
const galleryAudit = await mapLimit(autoscout.slice(0, sampleLimit), 4, async (offer) => {
  const candidate = structuredClone(offer);
  try {
    const images = await autoscoutEuropeHqSource.fetchImages(candidate);
    return {
      id: offer.id, sourceOfferId: offer.sourceOfferId, year: offer.year, sourceUrl: offer?.operational?.sourceUrl,
      currentImages: Array.isArray(offer.images) ? offer.images.length : 0,
      currentHqBound: Array.isArray(offer.images) && offer.images.length >= 5 && offer.images.every((img) => hqBound(img, offer.sourceOfferId)),
      freshImages: images.length, freshHqBound: images.length >= 5 && images.every((img) => hqBound(img, offer.sourceOfferId)),
      firstFresh: images[0] ? { url: images[0].url, width: images[0].width, height: images[0].height } : null,
    };
  } catch (error) {
    return { id: offer.id, sourceOfferId: offer.sourceOfferId, year: offer.year, error: String(error?.message || error), freshHqBound: false };
  }
});

const unsafeMarkets = Object.entries(roundTrip).filter(([, value]) => !value.identical || value.notRepublishableCount > 0).map(([market]) => market);
const hqReady = galleryAudit.filter((row) => row.freshHqBound).length;
const report = {
  generatedAt: new Date().toISOString(), baseline, roundTrip, unsafeMarkets,
  europe: { total: europe.length, autoscoutEligible: autoscout.length, audited: galleryAudit.length, hqReady, currentlyHqBound: galleryAudit.filter((row) => row.currentHqBound).length, galleryAudit },
  safeToPublish: unsafeMarkets.length === 0 && autoscout.length > 0 && hqReady > 0,
};
console.log(JSON.stringify(report, null, 2));
await import("node:fs").then((fs) => fs.writeFileSync(process.env.EUROPE_HQ_AUDIT_REPORT || "europe-hq-safety-report.json", JSON.stringify(report, null, 2)));
if (!report.safeToPublish) process.exit(2);
