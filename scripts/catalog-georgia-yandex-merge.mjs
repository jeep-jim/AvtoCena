import fs from "node:fs/promises";
import path from "node:path";

const inputDir = String(process.env.GEORGIA_YANDEX_INPUT_DIR || "georgia-yandex-shards").trim();
const output = String(process.env.GEORGIA_YANDEX_OUTPUT || "catalog-rebuild-georgia.json").trim();
const reportOutput = String(process.env.GEORGIA_YANDEX_REPORT || "catalog-georgia-yandex-merge-report.json").trim();
const minFresh = Math.max(1, Number(process.env.GEORGIA_YANDEX_MIN_FRESH || 1000));
const allowedSources = new Set(["myauto_georgia_list", "autopapa_georgia_open"]);

async function walkJson(root) {
  const rows = [];
  async function walk(current) {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(target);
      else if (entry.isFile() && entry.name.endsWith(".json")) rows.push(target);
    }
  }
  await walk(root);
  return rows.sort();
}

function normalizedImageIdentity(rawUrl) {
  try {
    const url = new URL(String(rawUrl || ""));
    url.hash = "";
    url.search = "";
    return `${url.protocol}//${url.hostname.toLowerCase()}${url.pathname}`;
  } catch {
    return String(rawUrl || "").replace(/[?#].*$/, "");
  }
}

function sourceHostOk(offer) {
  try {
    const host = new URL(String(offer?.operational?.sourceUrl || "")).hostname.toLowerCase();
    if (offer.sourceId === "myauto_georgia_list") return host === "myauto.ge" || host.endsWith(".myauto.ge");
    if (offer.sourceId === "autopapa_georgia_open") return host === "autopapa.ge" || host.endsWith(".autopapa.ge");
    return false;
  } catch {
    return false;
  }
}

function offerErrors(offer) {
  const errors = [];
  const id = String(offer?.sourceOfferId || "");
  const images = Array.isArray(offer?.images) ? offer.images : [];
  const op = offer?.operational || {};
  const raw = op?.raw || {};
  if (String(offer?.market || "") !== "georgia") errors.push("market");
  if (!allowedSources.has(String(offer?.sourceId || ""))) errors.push("source");
  if (!/^\d+$/.test(id)) errors.push("sourceOfferId");
  if (Number(offer?.year || 0) < 2020) errors.push("year");
  if (!offer?.make || !offer?.model) errors.push("identity");
  if (!(Number(offer?.sourcePrice || 0) > 0) || !String(offer?.sourceCurrency || "").trim()) errors.push("price");
  if (!sourceHostOk(offer)) errors.push("sourceUrl");
  if (images.length < 5 || images.length > 30) errors.push("images");
  if (op.photoIdentityVerified !== true || raw.listingBoundImages !== true) errors.push("photoIdentity");
  if (raw.recoveryExactSourceUrl !== true || raw.recoveryExactPhotoIdentity !== true || raw.recoveryCalculatedRub !== true || raw.recoveryBodySourceOnly !== true) errors.push("recoveryBinding");
  if (offer.sourceId === "myauto_georgia_list" && String(raw.myAutoProductCarId || "") !== id) errors.push("myautoProductIdentity");
  if (offer.sourceId === "autopapa_georgia_open") {
    const bad = images.some((image) => !/\/system\/car\/photos\/(?:[^/?#]+\/)+original\.jpg(?:[?#]|$)/i.test(String(image?.url || image?.objectKey || "")));
    if (bad) errors.push("autopapaOriginalGallery");
  }
  const imageIds = images.map((image) => normalizedImageIdentity(image?.url || image?.objectKey)).filter(Boolean);
  if (new Set(imageIds).size !== imageIds.length) errors.push("duplicateImagesWithinListing");
  return errors;
}

const files = await walkJson(inputDir);
if (!files.length) throw new Error("georgia_yandex_no_shard_files");

const byListing = new Map();
const duplicateListings = new Set();
const shardReports = [];
const invalid = [];
for (const file of files) {
  const doc = JSON.parse(await fs.readFile(file, "utf8"));
  if (String(doc?.market || "") !== "georgia" || !Array.isArray(doc?.offers)) {
    throw new Error(`georgia_yandex_bad_shard:${file}`);
  }
  shardReports.push({
    file,
    count: doc.offers.length,
    source: doc?.report?.source || null,
    startPage: doc?.report?.startPage || null,
    pagesPerSource: doc?.report?.pagesPerSource || null,
    sourceCounts: doc?.report?.sourceCounts || {},
    rejected: doc?.report?.rejected || {},
  });
  for (const offer of doc.offers) {
    const errors = offerErrors(offer);
    if (errors.length) {
      invalid.push({ id: offer?.id || null, sourceId: offer?.sourceId || null, sourceOfferId: offer?.sourceOfferId || null, errors });
      continue;
    }
    const key = `${offer.sourceId}:${offer.sourceOfferId}`;
    if (byListing.has(key)) duplicateListings.add(key);
    else byListing.set(key, offer);
  }
}

if (invalid.length) {
  const preview = invalid.slice(0, 20).map((row) => `${row.sourceId}:${row.sourceOfferId}:${row.errors.join("+")}`).join("|");
  throw new Error(`georgia_yandex_invalid_offers:${invalid.length}:${preview}`);
}

const offers = [...byListing.values()].sort((a, b) => String(a.sourceId).localeCompare(String(b.sourceId))
  || String(a.sourceOfferId).localeCompare(String(b.sourceOfferId), "en", { numeric: true }));
const sourceCounts = Object.fromEntries([...allowedSources].map((sourceId) => [sourceId, offers.filter((offer) => offer.sourceId === sourceId).length]));
if (Object.values(sourceCounts).some((count) => Number(count) <= 0)) throw new Error(`georgia_yandex_missing_canonical_source:${JSON.stringify(sourceCounts)}`);
if (offers.length < minFresh) throw new Error(`georgia_yandex_fresh_floor:${offers.length}:${minFresh}`);

const imageOwners = new Map();
const crossListing = [];
for (const offer of offers) {
  const owner = `${offer.sourceId}:${offer.sourceOfferId}`;
  for (const image of offer.images || []) {
    const identity = normalizedImageIdentity(image?.url || image?.objectKey);
    if (!identity) continue;
    const previous = imageOwners.get(identity);
    if (previous && previous !== owner) crossListing.push({ identity, owners: [previous, owner] });
    else imageOwners.set(identity, owner);
  }
}
if (crossListing.length) throw new Error(`georgia_yandex_cross_listing_images:${crossListing.length}`);

const imageCounts = offers.map((offer) => offer.images.length);
const report = {
  mode: "georgia_yandex_canonical_shard_merge",
  generatedAt: new Date().toISOString(),
  files: files.length,
  freshCount: offers.length,
  minFresh,
  sourceCounts,
  duplicateListingCount: duplicateListings.size,
  duplicateListings: [...duplicateListings].slice(0, 50),
  crossListingDuplicateImages: 0,
  minYear: Math.min(...offers.map((offer) => Number(offer.year || 0))),
  imageStats: {
    min: Math.min(...imageCounts),
    max: Math.max(...imageCounts),
    average: Number((imageCounts.reduce((sum, count) => sum + count, 0) / imageCounts.length).toFixed(2)),
    belowFive: imageCounts.filter((count) => count < 5).length,
  },
  shards: shardReports,
};

await fs.writeFile(output, JSON.stringify({ market: "georgia", count: offers.length, partial: true, report, offers }, null, 2));
await fs.writeFile(reportOutput, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
