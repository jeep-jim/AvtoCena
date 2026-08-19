import fs from "node:fs/promises";
import path from "node:path";

const sourceDir = process.env.PRESTIGE_REPAIR_SOURCE_DIR || "prestige-source-chunks";
const repairDir = process.env.PRESTIGE_REPAIR_RESULT_DIR || "prestige-repair-chunks";
const output = process.env.PRESTIGE_REPAIR_MERGE_OUTPUT || "prestige-japan-exact-sold-repaired.json";
const target = Math.max(1, Math.min(30_000, Number(process.env.PRESTIGE_REPAIR_TARGET || 30_000)));
const exactImage = /^https:\/\/(?:\d+\.)?ajes\.com\/imgs\/[A-Za-z0-9_-]+$/i;
const exactUrl = /^https:\/\/prestigemotorsport\.com\.au\/auction-vehicle-display\/\?car_id=[A-Za-z0-9_-]+$/;
const gradeToken = /^(?:[0-6](?:\.5)?|R|RA|A\d?|S)$/i;
const JAPAN_MIN_MODEL_YEAR = 2015;

async function walk(dir) {
  const result = [];
  try {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) result.push(...await walk(full));
      else if (entry.isFile() && entry.name.endsWith(".json")) result.push(full);
    }
  } catch {}
  return result;
}
function parseCursor(value) {
  const match = String(value || "").match(/^(\d+):(\d+):(\d+)$/);
  return match ? { makeIndex: Number(match[1]), modelIndex: Number(match[2]), offset: Number(match[3]) } : null;
}
function checkOffer(offer) {
  const op = offer?.operational || {};
  const raw = op.raw || {};
  const problems = [];
  if (!offer?.sourceOfferId || offer?.sourceId !== "prestige_japan_auctions_open") problems.push("identity");
  if (!exactUrl.test(String(op.sourceUrl || ""))) problems.push("sourceUrl");
  if (String(raw.carId || "") !== String(offer?.sourceOfferId || "")) problems.push("detailIdentity");
  if (offer?.offerType !== "auction" || offer?.catalogKind !== "auction_result" || offer?.auctionResult !== "sold" || offer?.auctionPriceKind !== "published_result") problems.push("auctionSemantics");
  if (raw.currentStatus !== "Sold") problems.push("soldStatus");
  if (!(Number(offer?.sourcePrice) > 0) || offer?.sourceCurrency !== "JPY" || Number(raw.finalPriceJpy || 0) !== Number(offer?.sourcePrice || 0)) problems.push("price");
  if (op.auctionResultPriceVerified !== true || op.resultPriceVerified !== true || op.exactDetail !== true || op.sourceOnlyFieldsPreserved !== true) problems.push("exactFlags");
  if (!offer?.make || !offer?.model || !(Number(offer?.year) >= JAPAN_MIN_MODEL_YEAR)) problems.push("core");
  if (offer?.auctionGrade && !gradeToken.test(String(offer.auctionGrade))) problems.push("grade");
  const images = Array.isArray(offer?.images) ? offer.images : [];
  if (images.length < 5 || images.length > 30 || images.some((image) => !exactImage.test(String(image?.url || "")))) problems.push("gallery");
  if (op.photoIdentityVerified !== true || op.gallerySafetyMode !== "prestige_ajes_exact_detail_v2_cover_content_verified") problems.push("galleryFlags");
  if (offer?.powerHp || offer?.powerKw || offer?.power30MinKw || offer?.drive || offer?.fuel) problems.push("unsupportedFields");
  return problems;
}

async function load(dir, kind) {
  const rows = [];
  for (const file of await walk(dir)) {
    try {
      const data = JSON.parse(await fs.readFile(file, "utf8"));
      const report = data?.report || {};
      if (report.mode !== "prestige_exact_sold_source_only_chunk_no_publish") continue;
      rows.push({ kind, file, report, offers: Array.isArray(data?.offers) ? data.offers : [] });
    } catch {}
  }
  return rows;
}

const originals = (await load(sourceDir, "source")).filter((row) => !String(row.report.id || "").startsWith("repair-"));
const repairs = await load(repairDir, "repair");
const repairByOriginal = new Map();
for (const row of repairs) {
  const id = String(row.report.id || "");
  if (!id.startsWith("repair-")) continue;
  repairByOriginal.set(id.slice("repair-".length), row);
}

const errors = [];
const incompleteChunks = [];
const offers = new Map();
let acceptedAcrossPieces = 0;
let repairedChunks = 0;
let sourcePassedChunks = 0;

for (const original of originals.sort((a, b) => String(a.report.id || "").localeCompare(String(b.report.id || "")))) {
  const id = String(original.report.id || "");
  const pieces = [original];
  let complete = original.report.passed === true;
  if (complete) sourcePassedChunks++;
  if (!complete) {
    const repair = repairByOriginal.get(id);
    if (repair) {
      pieces.push(repair);
      const cursor = parseCursor(repair.report.nextCursor);
      const reachedBoundary = repair.report.boundaryReached === true || repair.report.sourceFinished === true || (cursor && cursor.offset >= Number(original.report.endOffset || 0));
      complete = repair.report.passed === true && Boolean(reachedBoundary);
      if (complete) repairedChunks++;
    }
  }
  if (!complete) incompleteChunks.push(id || "unknown");
  for (const piece of pieces) {
    acceptedAcrossPieces += piece.offers.length;
    for (const offer of piece.offers) {
      const problems = checkOffer(offer);
      if (problems.length) {
        errors.push(`offer_${offer?.sourceOfferId || "missing"}_${problems.join("+")}`);
        continue;
      }
      const key = String(offer.sourceOfferId);
      const existing = offers.get(key);
      if (existing) {
        if (String(existing.operational?.sourceUrl) !== String(offer.operational?.sourceUrl) || Number(existing.sourcePrice) !== Number(offer.sourcePrice)) errors.push(`identity_conflict_${key}`);
        continue;
      }
      offers.set(key, offer);
    }
  }
}

if (!originals.length) errors.push("source_chunks_missing");
for (const id of incompleteChunks) errors.push(`chunk_incomplete_${id}`);
const unique = [...offers.values()].sort((a, b) => String(b.auctionDate || "").localeCompare(String(a.auctionDate || "")) || Number(b.year || 0) - Number(a.year || 0) || String(a.sourceOfferId).localeCompare(String(b.sourceOfferId)));
const outputOffers = unique.slice(0, target);
const reachedTarget = unique.length >= target;
// Repair follows the same "up-to" contract as the source collection: target
// is an output cap. Every source range still has to be complete and error-free.
const passed = errors.length === 0 && outputOffers.length > 0;
const report = {
  version: 1,
  mode: "prestige_exact_sold_source_only_repair_merge_no_publish",
  sourceId: "prestige_japan_auctions_open",
  market: "japan",
  sourceChunks: originals.length,
  sourcePassedChunks,
  repairedChunks,
  incompleteChunks,
  repairArtifacts: repairs.length,
  acceptedAcrossPieces,
  uniqueAccepted: unique.length,
  target,
  outputCount: outputOffers.length,
  reachedTarget,
  errors: errors.slice(0, 500),
  passed,
};
await fs.writeFile(output, JSON.stringify({ report, offers: outputOffers }, null, 2));
console.log(JSON.stringify(report, null, 2));
if (!passed) process.exit(1);
