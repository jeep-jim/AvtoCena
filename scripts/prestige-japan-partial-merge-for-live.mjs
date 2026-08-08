import fs from "node:fs/promises";
import path from "node:path";

const inputDir = process.env.PRESTIGE_PARTIAL_INPUT_DIR || "prestige-source-chunks";
const output = process.env.PRESTIGE_PARTIAL_OUTPUT || "prestige-japan-exact-sold-partial-live.json";
const EXACT_URL = /^https:\/\/prestigemotorsport\.com\.au\/auction-vehicle-display\/\?car_id=[A-Za-z0-9_-]+$/;
const EXACT_IMAGE = /^https:\/\/(?:\d+\.)?ajes\.com\/imgs\/[A-Za-z0-9_-]+$/i;
const GRADE = /^(?:[0-6](?:\.5)?|R|RA|A\d?|S)$/i;
const COMMERCIAL_RE = /\b(?:truck|dump|tipper|bus|minibus|commercial|cargo|lorry|tractor|forklift|excavator|machinery|canter|fighter|dutro|forward|giga|elf|profia)\b/i;

async function walk(dir) {
  const result = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...await walk(full));
    else if (entry.isFile() && entry.name.endsWith(".json")) result.push(full);
  }
  return result;
}
function validate(offer) {
  const op = offer?.operational || {};
  const raw = op?.raw || {};
  if (!offer?.sourceOfferId || offer.sourceId !== "prestige_japan_auctions_open" || offer.market !== "japan") return "identity";
  if (!EXACT_URL.test(String(op.sourceUrl || ""))) return "source_url";
  if (String(raw.carId || "") !== String(offer.sourceOfferId)) return "detail_identity";
  if (offer.offerType !== "auction" || offer.catalogKind !== "auction_result" || offer.auctionResult !== "sold" || offer.auctionPriceKind !== "published_result") return "auction_semantics";
  if (raw.currentStatus !== "Sold") return "sold_status";
  if (!(Number(offer.sourcePrice) > 0) || offer.sourceCurrency !== "JPY" || Number(raw.finalPriceJpy || 0) !== Number(offer.sourcePrice)) return "final_price";
  if (op.auctionResultPriceVerified !== true || op.resultPriceVerified !== true || op.exactDetail !== true || op.sourceOnlyFieldsPreserved !== true) return "exact_flags";
  if (!offer.make || !offer.model || !(Number(offer.year) >= new Date().getFullYear() - 15)) return "core";
  if (offer.auctionGrade && !GRADE.test(String(offer.auctionGrade))) return "grade";
  if (COMMERCIAL_RE.test(`${offer.make} ${offer.model} ${offer.trim || ""}`)) return "commercial";
  const images = Array.isArray(offer.images) ? offer.images : [];
  if (images.length < 5 || images.length > 30 || images.some((image) => !EXACT_IMAGE.test(String(image?.url || "")))) return "gallery";
  if (op.photoIdentityVerified !== true || op.gallerySafetyMode !== "prestige_ajes_exact_detail_v1") return "gallery_flags";
  if (offer.powerHp || offer.powerKw || offer.power30MinKw || offer.drive || offer.fuel) return "unsupported_source_fields";
  return "";
}

const files = await walk(inputDir);
const offers = new Map();
const rejected = {};
let chunkFiles = 0;
let chunkPassed = 0;
let chunkFailed = 0;
let rowsSeen = 0;
function reject(reason) { rejected[reason] = Number(rejected[reason] || 0) + 1; }

for (const file of files) {
  let data;
  try { data = JSON.parse(await fs.readFile(file, "utf8")); }
  catch { reject("invalid_json"); continue; }
  if (!data?.report || data.report.sourceId !== "prestige_japan_auctions_open") continue;
  chunkFiles++;
  if (data.report.passed === true) chunkPassed++; else chunkFailed++;
  const rows = Array.isArray(data.offers) ? data.offers : [];
  rowsSeen += rows.length;
  for (const offer of rows) {
    const reason = validate(offer);
    if (reason) { reject(reason); continue; }
    const key = String(offer.sourceOfferId);
    const existing = offers.get(key);
    if (existing && (Number(existing.sourcePrice) !== Number(offer.sourcePrice) || String(existing.operational?.sourceUrl) !== String(offer.operational?.sourceUrl))) {
      reject("identity_conflict");
      continue;
    }
    if (!existing) offers.set(key, offer);
  }
}

const outputOffers = [...offers.values()].sort((a, b) => String(b.auctionDate || "").localeCompare(String(a.auctionDate || "")) || Number(b.year || 0) - Number(a.year || 0));
const report = {
  version: 1,
  mode: "prestige_partial_chunks_strict_offer_merge_for_live",
  sourceId: "prestige_japan_auctions_open",
  market: "japan",
  chunkFiles,
  chunkPassed,
  chunkFailed,
  rowsSeen,
  uniqueAccepted: outputOffers.length,
  rejected,
  passed: outputOffers.length > 0,
};
await fs.writeFile(output, JSON.stringify({ report, offers: outputOffers }, null, 2));
console.log(JSON.stringify(report, null, 2));
if (!outputOffers.length) process.exit(1);
