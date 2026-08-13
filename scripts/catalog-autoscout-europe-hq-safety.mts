import crypto from "node:crypto";
import fs from "node:fs/promises";
import { hasCredibleOfferContent } from "../apps/web/lib/catalog/offer-quality.ts";
import { normalizeVehicleOfferSpecs } from "../apps/web/lib/catalog/spec-normalization.ts";
import { readAllOffersForMaintenance, readMarketOffers } from "../apps/web/lib/catalog/storage.ts";
import { enrichOfferWithVehicleKnowledge } from "../apps/web/lib/catalog/vehicle-knowledge.ts";
import type { CatalogImage, VehicleOffer } from "../apps/web/lib/catalog/types.ts";

const MARKETS = ["korea", "china", "japan", "uae", "europe", "georgia", "kyrgyzstan"] as const;
const TARGET_SOURCE = "autoscout_europe_open";
const BASELINE = process.env.CATALOG_AUTOSCOUT_HQ_BASELINE || "catalog-autoscout-europe-hq-baseline.json";
const REPORT = process.env.CATALOG_AUTOSCOUT_HQ_SAFETY_REPORT || "catalog-autoscout-europe-hq-safety-report.json";
const mode = String(process.argv[2] || "pre").trim().toLowerCase();

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, nested]) => [key, canonical(nested)]));
  }
  return value;
}

function digest(rows: VehicleOffer[]) {
  const normalized = [...rows]
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))
    .map(canonical);
  return crypto.createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

function exactHq(image: CatalogImage, sourceOfferId: string) {
  try {
    const raw = String(image?.url || "");
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "prod.pictures.autoscout24.net") return false;
    if (!url.pathname.toLowerCase().startsWith(`/listing-images/${sourceOfferId}_`.toLowerCase())) return false;
    const match = raw.match(/\/(\d{2,5})x(\d{2,5})\.(?:jpe?g|webp|avif|png)(?:[?#]|$)/i);
    const width = Number(image.width || match?.[1] || 0);
    const height = Number(image.height || match?.[2] || 0);
    return width >= 900 && height >= 600;
  } catch {
    return false;
  }
}

function galleryStats(rows: VehicleOffer[]) {
  const counts = rows.map((row) => row.images?.length || 0);
  let imageCount = 0;
  let exactHqImages = 0;
  for (const row of rows) {
    for (const image of row.images || []) {
      imageCount++;
      if (exactHq(image, String(row.sourceOfferId || ""))) exactHqImages++;
    }
  }
  return {
    offers: rows.length,
    minImages: counts.length ? Math.min(...counts) : 0,
    maxImages: counts.length ? Math.max(...counts) : 0,
    averageImages: counts.length ? Number((counts.reduce((sum, count) => sum + count, 0) / counts.length).toFixed(2)) : 0,
    imageCount,
    exactHqImages,
  };
}

async function publicSnapshot() {
  return Object.fromEntries(await Promise.all(MARKETS.map(async (market) => [market, await readMarketOffers(market)] as const))) as Record<string, VehicleOffer[]>;
}

if (mode === "pre") {
  const current = await publicSnapshot();
  const internal = await readAllOffersForMaintenance();
  const normalized = await Promise.all(internal.map(async (offer) => normalizeVehicleOfferSpecs(await enrichOfferWithVehicleKnowledge(structuredClone(offer)))));
  const predicted = new Map<string, VehicleOffer[]>();
  for (const offer of normalized) {
    if (offer.status !== "active" || !hasCredibleOfferContent(offer)) continue;
    predicted.set(String(offer.market), [...(predicted.get(String(offer.market)) || []), offer]);
  }
  const writerPredictionMatches: Record<string, boolean> = {};
  for (const market of MARKETS) {
    writerPredictionMatches[market] = digest(predicted.get(market) || []) === digest(current[market]);
    if (!writerPredictionMatches[market]) {
      throw new Error(`autoscout_writer_preflight_mismatch:${market}:current_${current[market].length}:predicted_${(predicted.get(market) || []).length}`);
    }
  }
  const target = current.europe.filter((offer) => offer.sourceId === TARGET_SOURCE);
  if (!target.length) throw new Error("autoscout_public_target_empty");
  if (target.some((offer) => Number(offer.year || 0) < 2020)) throw new Error("autoscout_public_target_has_pre2020");
  const baseline = {
    createdAt: new Date().toISOString(),
    counts: Object.fromEntries(MARKETS.map((market) => [market, current[market].length])),
    digests: Object.fromEntries(MARKETS.map((market) => [market, digest(current[market])])),
    writerPredictionMatches,
    europeNonAutoScoutDigest: digest(current.europe.filter((offer) => offer.sourceId !== TARGET_SOURCE)),
    targetIds: target.map((offer) => offer.id).sort(),
    targetCount: target.length,
    targetBeforeGallery: galleryStats(target),
  };
  await fs.writeFile(BASELINE, JSON.stringify(baseline, null, 2));
  await fs.writeFile(REPORT, JSON.stringify({ status: "preflight_ok", ...baseline }, null, 2));
  console.log(JSON.stringify({ status: "preflight_ok", ...baseline }, null, 2));
} else if (mode === "post") {
  const baseline = JSON.parse(await fs.readFile(BASELINE, "utf8"));
  const current = await publicSnapshot();
  const otherMarketsUnchanged: Record<string, boolean> = {};
  for (const market of MARKETS.filter((market) => market !== "europe")) {
    otherMarketsUnchanged[market] = digest(current[market]) === baseline.digests[market]
      && current[market].length === Number(baseline.counts[market] || 0);
    if (!otherMarketsUnchanged[market]) throw new Error(`autoscout_post_other_market_changed:${market}`);
  }
  const europeNonTargetUnchanged = digest(current.europe.filter((offer) => offer.sourceId !== TARGET_SOURCE)) === baseline.europeNonAutoScoutDigest;
  if (!europeNonTargetUnchanged) throw new Error("autoscout_post_europe_non_target_changed");
  const target = current.europe.filter((offer) => offer.sourceId === TARGET_SOURCE);
  if (target.length !== Number(baseline.targetCount || 0)) throw new Error(`autoscout_post_target_count_changed:${target.length}:${baseline.targetCount}`);
  const ids = target.map((offer) => offer.id).sort();
  if (JSON.stringify(ids) !== JSON.stringify(baseline.targetIds)) throw new Error("autoscout_post_target_ids_changed");
  const problems: string[] = [];
  for (const offer of target) {
    const sourceOfferId = String(offer.sourceOfferId || "");
    if (Number(offer.year || 0) < 2020) problems.push(`${offer.id}:year_${offer.year}`);
    if ((offer.images || []).length < 5) problems.push(`${offer.id}:images_${offer.images?.length || 0}`);
    if ((offer.images || []).some((image) => !exactHq(image, sourceOfferId))) problems.push(`${offer.id}:identity_or_resolution`);
    if (offer.operational?.photoIdentityVerified !== true || offer.operational?.photoResolutionVerified !== true) problems.push(`${offer.id}:verification_flags`);
  }
  if (problems.length) throw new Error(`autoscout_post_quality_failed:${problems.slice(0, 20).join(",")}`);
  const result = {
    status: "postverify_ok",
    verifiedAt: new Date().toISOString(),
    counts: Object.fromEntries(MARKETS.map((market) => [market, current[market].length])),
    otherMarketsUnchanged,
    europeNonTargetUnchanged,
    targetIdsUnchanged: true,
    targetCount: target.length,
    targetBeforeGallery: baseline.targetBeforeGallery,
    targetAfterGallery: galleryStats(target),
    sample: target.slice(0, 5).map((offer) => ({
      id: offer.id,
      sourceOfferId: offer.sourceOfferId,
      title: offer.sourceTitle,
      year: offer.year,
      images: offer.images.length,
      firstImage: offer.images[0] ? { url: offer.images[0].url, width: offer.images[0].width, height: offer.images[0].height } : null,
      sourceUrl: offer.operational?.sourceUrl,
    })),
  };
  await fs.writeFile(REPORT, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} else {
  throw new Error(`autoscout_safety_mode_invalid:${mode}`);
}
