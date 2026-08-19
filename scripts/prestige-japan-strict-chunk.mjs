import fs from "node:fs/promises";
import crypto from "node:crypto";

process.env.CATALOG_KNOWLEDGE_DISABLED = "1";
process.env.CATALOG_IMAGE_STORAGE_MODE = "source_urls_only";
process.env.PRESTIGE_JAPAN_SEARCH_PAGES_PER_FETCH = "1";
process.env.PRESTIGE_JAPAN_DESIRED_SOLD_PER_FETCH = "20";

const { prestigeJapanExactSource: source } = await import("../apps/web/lib/catalog/prestige-japan-exact-source.ts");

const startCursor = String(process.env.PRESTIGE_CHUNK_START_CURSOR || "").trim();
const expectedMakeIndex = Number(process.env.PRESTIGE_CHUNK_MAKE_INDEX);
const expectedModelIndex = Number(process.env.PRESTIGE_CHUNK_MODEL_INDEX);
const endOffset = Math.max(0, Number(process.env.PRESTIGE_CHUNK_END_OFFSET || 0));
const maxPages = Math.max(1, Math.min(120, Number(process.env.PRESTIGE_CHUNK_MAX_PAGES || 60)));
const id = String(process.env.PRESTIGE_CHUNK_ID || startCursor || "chunk").replace(/[^A-Za-z0-9_.-]+/g, "-");
const output = process.env.PRESTIGE_CHUNK_OUTPUT || `prestige-japan-chunk-${id}.json`;
const detailConcurrency = Math.max(1, Math.min(5, Number(process.env.PRESTIGE_JAPAN_DETAIL_CONCURRENCY || 5)));
const timeoutMs = Math.max(8_000, Number(process.env.CATALOG_SOURCE_REQUEST_TIMEOUT_MS || 30_000));
const retryAttempts = Math.max(1, Math.min(6, Number(process.env.PRESTIGE_CHUNK_RETRY_ATTEMPTS || 4)));
const retryBaseMs = Math.max(250, Math.min(10_000, Number(process.env.PRESTIGE_CHUNK_RETRY_BASE_MS || 1_000)));
const exactImage = /^https:\/\/(?:\d+\.)?ajes\.com\/imgs\/[A-Za-z0-9_-]+$/i;
const exactUrl = /^https:\/\/prestigemotorsport\.com\.au\/auction-vehicle-display\/\?car_id=[A-Za-z0-9_-]+$/;
const gradeToken = /^(?:[0-6](?:\.5)?|R|RA|A\d?|S)$/i;
const commercial = /\b(?:truck|dump|tipper|bus|minibus|commercial|cargo|lorry|tractor|forklift|excavator|machinery)\b/i;
const JAPAN_MIN_MODEL_YEAR = 2015;

if (!/^\d+:\d+:\d+$/.test(startCursor)) throw new Error("prestige_chunk_start_cursor_invalid");
if (!Number.isInteger(expectedMakeIndex) || !Number.isInteger(expectedModelIndex) || !(endOffset > 0)) throw new Error("prestige_chunk_boundary_invalid");

function parseCursor(value) {
  const match = String(value || "").match(/^(\d+):(\d+):(\d+)$/);
  return match ? { makeIndex: Number(match[1]), modelIndex: Number(match[2]), offset: Number(match[3]) } : null;
}
function withTimeout(promise, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label)), timeoutMs); }),
  ]).finally(() => clearTimeout(timer));
}
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function errorText(error) {
  const parts = [];
  let current = error;
  for (let depth = 0; current && depth < 5; depth++) {
    parts.push(String(current?.code || ""), String(current?.message || current || ""));
    current = current?.cause;
  }
  return parts.filter(Boolean).join(" ");
}
function isRetryable(error) {
  return /UND_ERR_SOCKET|ECONNRESET|ECONNREFUSED|EPIPE|ETIMEDOUT|ENETUNREACH|EAI_AGAIN|fetch failed|socket|other side closed|timeout|HTTP[_ -]?(?:408|425|429|500|502|503|504)|\b(?:408|425|429|500|502|503|504)\b/i.test(errorText(error));
}
async function retryTransient(label, operation) {
  let lastError;
  for (let attempt = 1; attempt <= retryAttempts; attempt++) {
    try {
      return await withTimeout(Promise.resolve().then(operation), `${label}_timeout`);
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt >= retryAttempts) throw error;
      const delay = Math.min(15_000, retryBaseMs * (2 ** (attempt - 1)) + Math.floor(Math.random() * 500));
      console.warn(JSON.stringify({ event: "prestige_transient_retry", label, attempt, retryAttempts, delayMs: delay, error: errorText(error).slice(0, 500) }));
      await sleep(delay);
    }
  }
  throw lastError;
}
async function pool(rows, limit, worker) {
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(limit, rows.length) }, async () => {
    while (true) {
      const current = index++;
      if (current >= rows.length) return;
      await worker(rows[current]);
    }
  }));
}
function reason(counter, key) { counter[key] = (counter[key] || 0) + 1; }
function strictCheck(offer) {
  const op = offer?.operational || {};
  const raw = op.raw || {};
  const problems = [];
  if (!offer?.sourceOfferId) problems.push("sourceOfferId");
  if (offer?.sourceId !== "prestige_japan_auctions_open") problems.push("sourceId");
  if (!exactUrl.test(String(op.sourceUrl || ""))) problems.push("sourceUrl");
  if (String(raw.carId || "") !== String(offer?.sourceOfferId || "")) problems.push("identity");
  if (offer?.offerType !== "auction" || offer?.catalogKind !== "auction_result" || offer?.auctionResult !== "sold" || offer?.auctionPriceKind !== "published_result") problems.push("auctionSemantics");
  if (raw.currentStatus !== "Sold") problems.push("soldStatus");
  if (!(Number(offer?.sourcePrice) > 0) || offer?.sourceCurrency !== "JPY") problems.push("price");
  if (Number(raw.finalPriceJpy || 0) !== Number(offer?.sourcePrice || 0)) problems.push("finalPriceBinding");
  if (op.auctionResultPriceVerified !== true || op.resultPriceVerified !== true || op.exactDetail !== true || op.sourceOnlyFieldsPreserved !== true) problems.push("exactFlags");
  if (!offer?.make || !offer?.model || !(Number(offer?.year) >= JAPAN_MIN_MODEL_YEAR)) problems.push("coreIdentity");
  if (commercial.test(String(offer?.sourceTitle || ""))) problems.push("commercial");
  if (offer?.auctionGrade && !gradeToken.test(String(offer.auctionGrade))) problems.push("grade");
  const images = Array.isArray(offer?.images) ? offer.images : [];
  if (images.length < 5 || images.length > 30) problems.push("images");
  if (images.some((image) => !exactImage.test(String(image?.url || "")))) problems.push("imageIdentity");
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

const offers = new Map();
const rejectionReasons = {};
const invariantProblems = [];
const transportErrors = [];
let cursor = startCursor;
let pages = 0;
let seen = 0;
let normalized = 0;
let nextCursor = startCursor;
let sourceFinished = false;
let boundaryReached = false;
let fatalError = "";

while (pages < maxPages) {
  const parsed = parseCursor(cursor);
  if (!parsed) { invariantProblems.push("cursor_invalid"); break; }
  if (parsed.makeIndex !== expectedMakeIndex || parsed.modelIndex !== expectedModelIndex || parsed.offset >= endOffset) {
    boundaryReached = true;
    break;
  }

  let page;
  try {
    page = await retryTransient("prestige_chunk_page", () => source.fetchPage(cursor));
  } catch (error) {
    fatalError = errorText(error).slice(0, 1_000) || "prestige_chunk_page_failed";
    transportErrors.push({ stage: "page", cursor, error: fatalError, retryable: isRetryable(error) });
    invariantProblems.push("page_fetch_failed_after_retries");
    break;
  }

  pages++;
  const rows = Array.isArray(page?.items) ? page.items : [];
  seen += rows.length;
  const bases = [];
  for (const raw of rows) {
    let offer = null;
    try { offer = source.normalizeOffer(raw); } catch { reason(rejectionReasons, "normalize"); }
    if (!offer) { reason(rejectionReasons, "normalize"); continue; }
    normalized++;
    bases.push(offer);
  }

  await pool(bases, detailConcurrency, async (offer) => {
    try {
      const images = await retryTransient("prestige_chunk_gallery", () => source.fetchImages(offer));
      if (Array.isArray(images) && images.length) offer.images = images;
    } catch (error) {
      reason(rejectionReasons, "galleryFetch");
      transportErrors.push({ stage: "gallery", sourceOfferId: offer?.sourceOfferId || "", error: errorText(error).slice(0, 500), retryable: isRetryable(error) });
    }
    const problems = strictCheck(offer);
    if (problems.length) {
      for (const problem of problems) reason(rejectionReasons, problem);
      return;
    }
    if (!offers.has(offer.sourceOfferId)) offers.set(offer.sourceOfferId, offer);
  });

  nextCursor = page?.nextCursor || "";
  if (!nextCursor || page?.finished) { sourceFinished = true; break; }
  const next = parseCursor(nextCursor);
  if (!next || next.makeIndex !== expectedMakeIndex || next.modelIndex !== expectedModelIndex || next.offset >= endOffset) {
    boundaryReached = true;
    break;
  }
  cursor = nextCursor;
}

const rows = [...offers.values()];
const digest = crypto.createHash("sha256").update(rows.map((offer) => `${offer.sourceOfferId}|${offer.sourcePrice}|${offer.operational?.sourceUrl}`).sort().join("\n")).digest("hex");
const passed = invariantProblems.length === 0 && pages > 0;
const report = {
  version: 3,
  mode: "prestige_exact_sold_source_only_chunk_no_publish",
  sourceId: "prestige_japan_auctions_open",
  market: "japan",
  galleryContract: "prestige_ajes_exact_detail_v2_cover_content_verified",
  id,
  startCursor,
  expectedMakeIndex,
  expectedModelIndex,
  endOffset,
  maxPages,
  pages,
  seen,
  normalized,
  accepted: rows.length,
  rejected: Math.max(0, normalized - rows.length),
  rejectionReasons,
  nextCursor,
  sourceFinished,
  boundaryReached,
  retryAttempts,
  transportErrorCount: transportErrors.length,
  transportErrors: transportErrors.slice(0, 100),
  fatalError,
  digest,
  invariantProblems,
  passed,
};
await fs.writeFile(output, JSON.stringify({ report, offers: rows }, null, 2));
console.log(JSON.stringify(report, null, 2));
if (!passed) process.exit(1);
