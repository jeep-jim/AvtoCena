import crypto from "node:crypto";
import fs from "node:fs";
import { readMarketOffers, persistCatalogOffers } from "../apps/web/lib/catalog/storage.ts";
import { PUBLIC_CATALOG_MARKETS } from "../apps/web/lib/catalog/runtime-config.ts";
import { normalizeVehicleOfferSpecs } from "../apps/web/lib/catalog/spec-normalization.ts";
import { enrichOfferWithVehicleKnowledge } from "../apps/web/lib/catalog/vehicle-knowledge.ts";
import { credibleCatalogImages } from "../apps/web/lib/catalog/offer-quality.ts";
import { autoscoutEuropeHqSource } from "../apps/web/lib/catalog/autoscout-hq-source.ts";

const REPORT = process.env.EUROPE_HQ_REFRESH_REPORT || "europe-hq-refresh-report.json";
const MIN_YEAR = 2020;
const MIN_IMAGES = 5;
const MAX_IMAGES = Math.min(30, Math.max(MIN_IMAGES, Number(process.env.CATALOG_MAX_IMAGES_PER_OFFER || 30)));
const CONCURRENCY = Math.max(1, Math.min(8, Number(process.env.EUROPE_HQ_REFRESH_CONCURRENCY || 4)));

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}
function hashOffers(offers) {
  const sorted = [...offers].sort((a,b) => String(a.id || a.sourceOfferId || "").localeCompare(String(b.id || b.sourceOfferId || "")));
  return crypto.createHash("sha256").update(JSON.stringify(canonical(sorted))).digest("hex");
}
function dimensions(image) {
  const match = String(image?.url || "").match(/\/(\d{2,5})x(\d{2,5})\.(?:jpe?g|webp|avif|png)(?:[?#]|$)/i);
  return { width: Number(image?.width || match?.[1] || 0), height: Number(image?.height || match?.[2] || 0) };
}
function isBoundHqImage(image, sourceOfferId) {
  const url = String(image?.url || "");
  if (!/^https:\/\/prod\.pictures\.autoscout24\.net\/listing-images\//i.test(url)) return false;
  let pathname = "";
  try { pathname = new URL(url).pathname.toLowerCase(); } catch { return false; }
  if (!pathname.startsWith(`/listing-images/${String(sourceOfferId).toLowerCase()}_`)) return false;
  const { width, height } = dimensions(image);
  return width >= 900 && height >= 600;
}
function galleryIsBoundHq(offer, images = offer?.images || []) {
  return Array.isArray(images) && images.length >= MIN_IMAGES && images.every((image) => isBoundHqImage(image, offer.sourceOfferId));
}
function exactAutoScoutOffer(offer) {
  const id = String(offer?.sourceOfferId || "");
  const url = String(offer?.operational?.sourceUrl || "");
  return offer?.market === "europe" && offer?.sourceId === "autoscout_europe_open" && Number(offer?.year || 0) >= MIN_YEAR
    && id.length > 0 && /^https:\/\/www\.autoscout24\.com\/offers\//i.test(url) && url.includes(id);
}
async function mapLimit(items, limit, mapper) {
  const result = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, Math.max(1, items.length)) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      result[index] = await mapper(items[index], index);
    }
  }));
  return result;
}

const markets = [...PUBLIC_CATALOG_MARKETS];
if (markets.filter((market) => market !== "europe").length !== 6) throw new Error(`unexpected_market_set:${markets.join(",")}`);
const baseline = Object.fromEntries(await Promise.all(markets.map(async (market) => {
  const offers = await readMarketOffers(market);
  return [market, { offers, count: offers.length, hash: hashOffers(offers) }];
})));
const sixMarkets = markets.filter((market) => market !== "europe");

// persistCatalogOffers normalizes/enriches every row it receives. Prove before any write
// that this exact code path is a no-op for every non-Europe object in the current generation.
const roundTrip = {};
for (const market of sixMarkets) {
  const normalized = await mapLimit(baseline[market].offers, 12, async (offer) => normalizeVehicleOfferSpecs(await enrichOfferWithVehicleKnowledge(structuredClone(offer))));
  roundTrip[market] = { count: normalized.length, before: baseline[market].hash, after: hashOffers(normalized), identical: hashOffers(normalized) === baseline[market].hash };
}
const unsafeMarkets = sixMarkets.filter((market) => !roundTrip[market].identical);
if (unsafeMarkets.length) {
  const report = { stage: "preflight", generatedAt: new Date().toISOString(), unsafeMarkets, roundTrip };
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
  throw new Error(`non_europe_roundtrip_not_identity:${unsafeMarkets.join(",")}`);
}

const europe = baseline.europe.offers;
const eligible = europe.filter(exactAutoScoutOffer);
const alreadyHq = eligible.filter((offer) => galleryIsBoundHq(offer));
const needsUpgrade = eligible.filter((offer) => !galleryIsBoundHq(offer));
if (!eligible.length) {
  const report = { stage: "preflight", generatedAt: new Date().toISOString(), baseline: Object.fromEntries(markets.map((m) => [m, { count: baseline[m].count, hash: baseline[m].hash }])), roundTrip, autoscout: { eligible: 0 } };
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
  throw new Error("autoscout_existing_selection_empty");
}

const attempts = await mapLimit(needsUpgrade, CONCURRENCY, async (stored) => {
  const candidate = structuredClone(stored);
  try {
    const fresh = credibleCatalogImages(await autoscoutEuropeHqSource.fetchImages(candidate)).slice(0, MAX_IMAGES);
    const ok = galleryIsBoundHq(candidate, fresh);
    return { id: stored.id, sourceOfferId: stored.sourceOfferId, ok, candidate: ok ? { ...candidate, images: fresh } : null,
      images: fresh.length, firstImage: fresh[0] ? { url: fresh[0].url, width: dimensions(fresh[0]).width, height: dimensions(fresh[0]).height } : null };
  } catch (error) {
    return { id: stored.id, sourceOfferId: stored.sourceOfferId, ok: false, candidate: null, error: String(error?.message || error), images: 0 };
  }
});
const failures = attempts.filter((attempt) => !attempt.ok);
if (failures.length) {
  const report = { stage: "preflight", generatedAt: new Date().toISOString(), baseline: Object.fromEntries(markets.map((m) => [m, { count: baseline[m].count, hash: baseline[m].hash }])), roundTrip,
    autoscout: { eligible: eligible.length, alreadyHq: alreadyHq.length, needsUpgrade: needsUpgrade.length, refreshSucceeded: attempts.length - failures.length, failures: failures.map(({candidate, ...rest}) => rest) } };
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
  throw new Error(`autoscout_hq_refresh_incomplete:${failures.length}/${needsUpgrade.length}`);
}

if (!needsUpgrade.length) {
  const report = { stage: "no_write_needed", generatedAt: new Date().toISOString(), baseline: Object.fromEntries(markets.map((m) => [m, { count: baseline[m].count, hash: baseline[m].hash }])), roundTrip,
    autoscout: { eligible: eligible.length, alreadyHq: alreadyHq.length, needsUpgrade: 0, upgraded: 0 }, changed: false };
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

const replacement = new Map(attempts.filter((attempt) => attempt.candidate).map((attempt) => [attempt.id, attempt.candidate]));
const nextEurope = europe.map((offer) => replacement.get(offer.id) || offer);
if (nextEurope.length !== europe.length) throw new Error("europe_count_changed_before_publish");
const nextOffers = markets.flatMap((market) => market === "europe" ? nextEurope : baseline[market].offers);

// Final no-write invariants immediately before the single atomic-generation publish.
for (const market of sixMarkets) {
  const current = await readMarketOffers(market);
  const currentHash = hashOffers(current);
  if (currentHash !== baseline[market].hash) throw new Error(`concurrent_catalog_change_detected:${market}`);
}
const currentEurope = await readMarketOffers("europe");
if (hashOffers(currentEurope) !== baseline.europe.hash) throw new Error("concurrent_catalog_change_detected:europe");

const manifest = await persistCatalogOffers(nextOffers);
const report = {
  stage: "published",
  generatedAt: new Date().toISOString(),
  generationId: manifest.generationId,
  baseline: Object.fromEntries(markets.map((m) => [m, { count: baseline[m].count, hash: baseline[m].hash }])),
  roundTrip,
  autoscout: {
    eligible: eligible.length,
    alreadyHq: alreadyHq.length,
    needsUpgrade: needsUpgrade.length,
    upgraded: attempts.length,
    upgradedOffers: attempts.map(({ candidate, ...rest }) => rest),
  },
  expectedEuropeCount: nextEurope.length,
  changed: true,
};
fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
