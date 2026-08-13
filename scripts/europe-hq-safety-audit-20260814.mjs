import crypto from "node:crypto";
import { readMarketOffers } from "../apps/web/lib/catalog/storage.ts";
import { PUBLIC_CATALOG_MARKETS } from "../apps/web/lib/catalog/runtime-config.ts";
import { normalizeVehicleOfferSpecs } from "../apps/web/lib/catalog/spec-normalization.ts";
import { enrichOfferWithVehicleKnowledge } from "../apps/web/lib/catalog/vehicle-knowledge.ts";
import { autoscoutEuropeHqSource } from "../apps/web/lib/catalog/autoscout-hq-source.ts";

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}
function hashOffers(offers) {
  const sorted = [...offers].sort((a,b) => String(a.id || a.sourceOfferId || "").localeCompare(String(b.id || b.sourceOfferId || "")));
  return crypto.createHash("sha256").update(JSON.stringify(canonical(sorted))).digest("hex");
}
function hqBound(image, sourceOfferId) {
  const url = String(image?.url || "");
  return /^https:\/\/prod\.pictures\.autoscout24\.net\/listing-images\//i.test(url)
    && url.toLowerCase().includes(`/listing-images/${String(sourceOfferId).toLowerCase()}_`)
    && Number(image?.width || 0) >= 900
    && Number(image?.height || 0) >= 600;
}

const markets = [...PUBLIC_CATALOG_MARKETS];
const snapshots = {};
for (const market of markets) snapshots[market] = await readMarketOffers(market);

const baseline = Object.fromEntries(markets.map((m) => [m, { count: snapshots[m].length, hash: hashOffers(snapshots[m]) }]));
const nonEurope = markets.filter((m) => m !== "europe");
const roundTrip = {};
for (const market of nonEurope) {
  const normalized = [];
  for (const offer of snapshots[market]) normalized.push(normalizeVehicleOfferSpecs(await enrichOfferWithVehicleKnowledge(structuredClone(offer))));
  const hash = hashOffers(normalized);
  roundTrip[market] = { hash, identical: hash === baseline[market].hash, count: normalized.length };
}

const europe = snapshots.europe || [];
const autoscout = europe.filter((offer) => offer.sourceId === "autoscout_europe_open" && Number(offer.year || 0) >= 2020 && String(offer?.operational?.sourceUrl || "").includes(String(offer.sourceOfferId || "")));
const sampleLimit = Math.max(1, Math.min(50, Number(process.env.EUROPE_HQ_AUDIT_LIMIT || 20)));
const galleryAudit = [];
for (const offer of autoscout.slice(0, sampleLimit)) {
  const candidate = structuredClone(offer);
  try {
    const images = await autoscoutEuropeHqSource.fetchImages(candidate);
    galleryAudit.push({
      id: offer.id,
      sourceOfferId: offer.sourceOfferId,
      year: offer.year,
      sourceUrl: offer?.operational?.sourceUrl,
      currentImages: Array.isArray(offer.images) ? offer.images.length : 0,
      currentHqBound: Array.isArray(offer.images) && offer.images.length >= 5 && offer.images.every((img) => hqBound(img, offer.sourceOfferId)),
      freshImages: images.length,
      freshHqBound: images.length >= 5 && images.every((img) => hqBound(img, offer.sourceOfferId)),
      firstFresh: images[0] ? { url: images[0].url, width: images[0].width, height: images[0].height } : null,
    });
  } catch (error) {
    galleryAudit.push({ id: offer.id, sourceOfferId: offer.sourceOfferId, year: offer.year, error: String(error?.message || error) });
  }
}

const unsafeMarkets = Object.entries(roundTrip).filter(([, value]) => !value.identical).map(([market]) => market);
const hqReady = galleryAudit.filter((row) => row.freshHqBound).length;
const report = {
  generatedAt: new Date().toISOString(),
  baseline,
  roundTrip,
  unsafeMarkets,
  europe: {
    total: europe.length,
    autoscoutEligible: autoscout.length,
    audited: galleryAudit.length,
    hqReady,
    currentlyHqBound: galleryAudit.filter((row) => row.currentHqBound).length,
    galleryAudit,
  },
  safeToPublish: unsafeMarkets.length === 0 && autoscout.length > 0 && hqReady > 0,
};
console.log(JSON.stringify(report, null, 2));
await import("node:fs").then((fs) => fs.writeFileSync(process.env.EUROPE_HQ_AUDIT_REPORT || "europe-hq-safety-report.json", JSON.stringify(report, null, 2)));
if (!report.safeToPublish) process.exit(2);
