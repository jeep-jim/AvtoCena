import fs from "node:fs/promises";
import path from "node:path";

const inputDir = process.env.PRESTIGE_MERGE_INPUT_DIR || "prestige-japan-chunks";
const output = process.env.PRESTIGE_MERGE_OUTPUT || "prestige-japan-exact-sold-up-to-30000.json";
const target = Math.max(1, Math.min(30_000, Number(process.env.PRESTIGE_MERGE_TARGET || 30_000)));
const expectedChunks = Math.max(1, Number(process.env.PRESTIGE_EXPECTED_CHUNKS || 1));
const minimumChunkCoverage = Math.max(0.5, Math.min(1, Number(process.env.PRESTIGE_MIN_CHUNK_COVERAGE || 0.95)));
const exactImage = /^https:\/\/(?:\d+\.)?ajes\.com\/imgs\/[A-Za-z0-9_-]+$/i;
const exactUrl = /^https:\/\/prestigemotorsport\.com\.au\/auction-vehicle-display\/\?car_id=[A-Za-z0-9_-]+$/;
const gradeToken = /^(?:[0-6](?:\.5)?|R|RA|A\d?|S)$/i;
const JAPAN_MIN_MODEL_YEAR = 2015;

async function walk(dir) {
  const result = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...await walk(full));
    else if (entry.isFile() && entry.name.endsWith(".json")) result.push(full);
  }
  return result;
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
  if (
    op.photoIdentityVerified !== true
    || op.galleryVerified !== true
    || op.gallerySafetyMode !== "prestige_ajes_exact_detail_v2_cover_content_verified"
    || raw.photoIdentityVerified !== true
    || raw.listingBoundImages !== true
    || raw.coverContentVerified !== true
  ) problems.push("galleryFlags");
  if (offer?.powerHp || offer?.powerKw || offer?.power30MinKw || offer?.drive || offer?.fuel) problems.push("unsupportedFields");
  return problems;
}

const files = (await walk(inputDir)).sort();
const chunks = [];
const errors = [];
const warnings = [];
const offers = new Map();
let pages = 0;
let seen = 0;
let acceptedAcrossChunks = 0;

const inputCoverage = Math.min(1, files.length / expectedChunks);
if (inputCoverage < minimumChunkCoverage) errors.push(`chunk_coverage_${inputCoverage.toFixed(4)}_below_${minimumChunkCoverage.toFixed(4)}`);
else if (files.length !== expectedChunks) warnings.push(`chunk_count_${files.length}_expected_${expectedChunks}`);
for (const file of files) {
  const data = JSON.parse(await fs.readFile(file, "utf8"));
  const report = data?.report || {};
  const rows = Array.isArray(data?.offers) ? data.offers : [];
  chunks.push(report);
  pages += Number(report.pages || 0);
  seen += Number(report.seen || 0);
  acceptedAcrossChunks += rows.length;
  // A chunk may keep individually verified rows and still end as incomplete
  // after a transient page/gallery failure. Do not discard thousands of exact
  // sold lots because one later request exhausted its retries. Contract and
  // row-level failures remain fatal below; incomplete ranges are retried by
  // the next scheduled collection.
  if (report.passed !== true) warnings.push(`chunk_incomplete_${report.id || path.basename(file)}`);
  if (report.sourceId !== "prestige_japan_auctions_open" || report.mode !== "prestige_exact_sold_source_only_chunk_no_publish") errors.push(`chunk_contract_${report.id || path.basename(file)}`);
  for (const offer of rows) {
    const problems = checkOffer(offer);
    if (problems.length) { errors.push(`offer_${offer?.sourceOfferId || "missing"}_${problems.join("+")}`); continue; }
    const key = String(offer.sourceOfferId);
    const existing = offers.get(key);
    if (existing) {
      if (String(existing.operational?.sourceUrl) !== String(offer.operational?.sourceUrl) || Number(existing.sourcePrice) !== Number(offer.sourcePrice)) errors.push(`identity_conflict_${key}`);
      continue;
    }
    offers.set(key, offer);
  }
}

const unique = [...offers.values()]
  .sort((a, b) => String(b.auctionDate || "").localeCompare(String(a.auctionDate || "")) || Number(b.year || 0) - Number(a.year || 0) || String(a.sourceOfferId).localeCompare(String(b.sourceOfferId)));
const outputOffers = unique.slice(0, target);
const reachedTarget = unique.length >= target;
// The workflow is explicitly "up-to-30k": target is a safe output cap, not a
// minimum source-volume promise. A small number of transiently missing shards is
// tolerated only when the configured coverage floor is still met; every row that
// is present must independently pass the strict identity/price/gallery contract.
const passed = errors.length === 0 && outputOffers.length > 0;
const report = {
  version: 2,
  mode: "prestige_exact_sold_source_only_merged_certification_no_publish",
  sourceId: "prestige_japan_auctions_open",
  market: "japan",
  galleryContract: "prestige_ajes_exact_detail_v2_cover_content_verified",
  target,
  expectedChunks,
  chunkFiles: files.length,
  minimumChunkCoverage,
  inputCoverage,
  pages,
  seen,
  acceptedAcrossChunks,
  uniqueAccepted: unique.length,
  outputCount: outputOffers.length,
  reachedTarget,
  errors,
  warnings,
  passed,
};
await fs.writeFile(output, JSON.stringify({ report, offers: outputOffers }, null, 2));
console.log(JSON.stringify(report, null, 2));
if (!passed) process.exit(1);
