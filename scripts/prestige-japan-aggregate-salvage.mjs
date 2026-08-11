import fs from "node:fs/promises";

const input = process.env.PRESTIGE_AGGREGATE_INPUT || "prestige-japan-exact-sold-up-to-30000.json";
const output = process.env.PRESTIGE_AGGREGATE_OUTPUT || "prestige-japan-exact-sold-verified-salvage.json";
const minCount = Math.max(1, Number(process.env.PRESTIGE_AGGREGATE_MIN_COUNT || 5_000));
const exactImage = /^https:\/\/(?:\d+\.)?ajes\.com\/imgs\/[A-Za-z0-9_-]+$/i;
const exactUrl = /^https:\/\/prestigemotorsport\.com\.au\/auction-vehicle-display\/\?car_id=[A-Za-z0-9_-]+$/;
const gradeToken = /^(?:[0-6](?:\.5)?|R|RA|A\d?|S)$/i;

function checkOffer(offer) {
  const operational = offer?.operational || {};
  const raw = operational.raw || {};
  const problems = [];
  if (!offer?.sourceOfferId || offer?.sourceId !== "prestige_japan_auctions_open") problems.push("identity");
  if (!exactUrl.test(String(operational.sourceUrl || ""))) problems.push("sourceUrl");
  if (String(raw.carId || "") !== String(offer?.sourceOfferId || "")) problems.push("detailIdentity");
  if (offer?.offerType !== "auction" || offer?.catalogKind !== "auction_result" || offer?.auctionResult !== "sold" || offer?.auctionPriceKind !== "published_result") problems.push("auctionSemantics");
  if (raw.currentStatus !== "Sold") problems.push("soldStatus");
  if (!(Number(offer?.sourcePrice) > 0) || offer?.sourceCurrency !== "JPY" || Number(raw.finalPriceJpy || 0) !== Number(offer?.sourcePrice || 0)) problems.push("price");
  if (operational.auctionResultPriceVerified !== true || operational.resultPriceVerified !== true || operational.exactDetail !== true || operational.sourceOnlyFieldsPreserved !== true) problems.push("exactFlags");
  if (!offer?.make || !offer?.model || !(Number(offer?.year) >= 2011)) problems.push("core");
  if (offer?.auctionGrade && !gradeToken.test(String(offer.auctionGrade))) problems.push("grade");
  const images = Array.isArray(offer?.images) ? offer.images : [];
  if (images.length < 5 || images.length > 30 || images.some((image) => !exactImage.test(String(image?.url || "")))) problems.push("gallery");
  if (operational.photoIdentityVerified !== true || operational.gallerySafetyMode !== "prestige_ajes_exact_detail_v1") problems.push("galleryFlags");
  if (offer?.powerHp || offer?.powerKw || offer?.power30MinKw || offer?.drive || offer?.fuel) problems.push("unsupportedFields");
  return problems;
}

const payload = JSON.parse(await fs.readFile(input, "utf8"));
const sourceReport = payload?.report || {};
const rows = Array.isArray(payload?.offers) ? payload.offers : [];
const fatal = [];
const warnings = [];

if (sourceReport.mode !== "prestige_exact_sold_source_only_merged_certification_no_publish") fatal.push("mode");
if (sourceReport.sourceId !== "prestige_japan_auctions_open" || sourceReport.market !== "japan") fatal.push("source");
if (!(Number(sourceReport.expectedChunks) > 0) || Number(sourceReport.chunkFiles) !== Number(sourceReport.expectedChunks)) fatal.push("chunkCoverage");
if (Number(sourceReport.outputCount) !== rows.length || Number(sourceReport.uniqueAccepted) !== rows.length) fatal.push("countBinding");
if (rows.length < minCount) fatal.push(`belowMin_${rows.length}_${minCount}`);

for (const issue of Array.isArray(sourceReport.errors) ? sourceReport.errors : []) {
  if (/^chunk_failed_[A-Za-z0-9_.-]+$/.test(String(issue))) warnings.push(String(issue).replace(/^chunk_failed_/, "chunk_incomplete_"));
  else fatal.push(`sourceReport_${issue}`);
}

const seen = new Map();
for (const offer of rows) {
  const id = String(offer?.sourceOfferId || "");
  const problems = checkOffer(offer);
  if (problems.length) fatal.push(`offer_${id || "missing"}_${problems.join("+")}`);
  const fingerprint = `${offer?.operational?.sourceUrl || ""}|${Number(offer?.sourcePrice || 0)}`;
  const existing = seen.get(id);
  if (existing && existing !== fingerprint) fatal.push(`identityConflict_${id}`);
  seen.set(id, fingerprint);
}

const report = {
  version: 1,
  mode: "prestige_exact_sold_verified_partial_salvage_no_publish",
  sourceId: "prestige_japan_auctions_open",
  market: "japan",
  sourceRunId: String(process.env.PRESTIGE_SOURCE_RUN_ID || ""),
  expectedChunks: Number(sourceReport.expectedChunks || 0),
  chunkFiles: Number(sourceReport.chunkFiles || 0),
  exactOfferCount: rows.length,
  incompleteChunks: warnings,
  fatalProblems: fatal.slice(0, 200),
  passed: fatal.length === 0,
};

await fs.writeFile(output, JSON.stringify({ report, offers: rows }, null, 2));
console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exit(1);
