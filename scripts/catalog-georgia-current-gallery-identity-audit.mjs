import fs from "node:fs/promises";

const { readMarketOffers } = await import("../apps/web/lib/catalog/storage.ts");

const output = String(process.env.GEORGIA_GALLERY_AUDIT_OUTPUT || "catalog-georgia-gallery-identity-audit.json");
const concurrency = Math.max(1, Math.min(6, Number(process.env.GEORGIA_GALLERY_AUDIT_CONCURRENCY || 4)));
const timeoutMs = Math.max(5_000, Number(process.env.GEORGIA_GALLERY_AUDIT_TIMEOUT_MS || 25_000));
const HEADERS = {
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9,ka;q=0.8,ru;q=0.7",
  "cache-control": "no-cache",
  pragma: "no-cache",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
};
const BAD_IMAGE_RE = /logo|icon|avatar|qrcode|qr-code|placeholder|banner|sprite|tracking|pixel|favicon|appstore|googleplay|no[-_ ]?(?:photo|image)/i;

function compact(value) {
  return String(value || "").toLocaleLowerCase("en-US").replace(/[^\p{L}\p{N}]+/gu, "");
}
function decodeHtml(value) {
  return String(value || "")
    .replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&#x2F;/gi, "/")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}
function plainText(value) {
  return decodeHtml(value).replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/[\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim();
}
function absoluteUrl(value, base) {
  if (!value || /^(?:data:|javascript:|mailto:|tel:)/i.test(value)) return "";
  try { return new URL(String(value).replace(/\\\//g, "/").replace(/&amp;/gi, "&"), base).toString(); } catch { return ""; }
}
function imageUrls(markup, base) {
  const values = [];
  for (const match of markup.matchAll(/<(?:img|source|meta)[^>]+(?:data-original|data-lazy-src|data-src|src|content)\s*=\s*["']([^"']+)["'][^>]*>/gi)) values.push(match[1]);
  for (const match of markup.matchAll(/(?:data-srcset|srcset)\s*=\s*["']([^"']+)["']/gi)) match[1].split(",").forEach((item) => values.push(item.trim().split(/\s+/)[0]));
  for (const match of markup.matchAll(/https?:\\?\/\\?\/[^"'\\\s<>]+?\.(?:jpe?g|png|webp|avif)(?:\?[^"'\\\s<>]*)?/gi)) values.push(match[0].replace(/\\\//g, "/"));
  return [...new Set(values.map((value) => absoluteUrl(value, base)).filter((url) => /^https?:/i.test(url) && !BAD_IMAGE_RE.test(url)))];
}
function fingerprint(value) {
  try {
    const url = new URL(String(value || ""));
    const parts = url.pathname.split("/").filter(Boolean);
    let name = decodeURIComponent(parts.at(-1) || "").toLocaleLowerCase("en-US");
    name = name.replace(/^(?:\d+x\d+|\d+x0|w\d+|h\d+)[_-]+/i, "");
    return name || url.pathname.toLocaleLowerCase("en-US");
  } catch {
    return String(value || "").split(/[?#]/)[0].split("/").at(-1)?.toLocaleLowerCase("en-US") || "";
  }
}
function offerImageUrls(offer) {
  return (Array.isArray(offer?.images) ? offer.images : []).map((image) => String(image?.url || "")).filter(Boolean);
}
function rawImageUrls(offer) {
  const raw = offer?.operational?.raw || {};
  return (Array.isArray(raw?.images) ? raw.images : []).map(String).filter(Boolean);
}
function identityMatches(markup, offer) {
  const text = compact(plainText(markup).slice(0, 30_000));
  const make = compact(offer?.make);
  const modelTokens = String(offer?.model || "").split(/\s+/).map(compact).filter((token) => token.length >= 2).slice(0, 4);
  return Boolean(make && text.includes(make) && modelTokens.some((token) => text.includes(token)));
}
async function fetchDetail(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { headers: { ...HEADERS, referer: url }, redirect: "follow", signal: controller.signal });
    const markup = await response.text();
    if (!response.ok) throw new Error(`http_${response.status}`);
    if (/captcha|cloudflare|access denied|request blocked|verify you are human|forbidden/i.test(markup.slice(0, 3_000))) throw new Error(`blocked_${response.status}`);
    return { finalUrl: response.url || url, markup };
  } finally { clearTimeout(timer); }
}
async function pool(rows, limit, worker) {
  const output = new Array(rows.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, rows.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= rows.length) return;
      output[index] = await worker(rows[index], index);
    }
  }));
  return output;
}

const offers = await readMarketOffers("georgia");
const sourceRows = offers.filter((offer) => String(offer?.sourceId || "") === "auto_georgia_open");
const foreignSourceRows = offers.filter((offer) => String(offer?.sourceId || "") !== "auto_georgia_open");

const currentFingerprintOwners = new Map();
const rawFingerprintOwners = new Map();
for (const offer of sourceRows) {
  for (const url of offerImageUrls(offer)) {
    const fp = fingerprint(url);
    if (!fp) continue;
    if (!currentFingerprintOwners.has(fp)) currentFingerprintOwners.set(fp, new Set());
    currentFingerprintOwners.get(fp).add(String(offer.sourceOfferId || offer.id));
  }
  for (const url of rawImageUrls(offer)) {
    const fp = fingerprint(url);
    if (!fp) continue;
    if (!rawFingerprintOwners.has(fp)) rawFingerprintOwners.set(fp, new Set());
    rawFingerprintOwners.get(fp).add(String(offer.sourceOfferId || offer.id));
  }
}
const duplicateCurrentFingerprints = [...currentFingerprintOwners.entries()]
  .filter(([, owners]) => owners.size > 1)
  .map(([fingerprint, owners]) => ({ fingerprint, owners: [...owners] }));
const duplicateRawFingerprints = [...rawFingerprintOwners.entries()]
  .filter(([, owners]) => owners.size > 1)
  .map(([fingerprint, owners]) => ({ fingerprint, owners: [...owners] }));

const checks = await pool(sourceRows, concurrency, async (offer) => {
  const id = String(offer?.sourceOfferId || offer?.id || "");
  const sourceUrl = String(offer?.operational?.sourceUrl || "");
  const raw = offer?.operational?.raw || {};
  const current = offerImageUrls(offer);
  const listing = rawImageUrls(offer);
  const base = {
    id,
    sourceUrl,
    make: String(offer?.make || ""),
    model: String(offer?.model || ""),
    currentImageCount: current.length,
    listingImageCount: listing.length,
    storedListingBoundImages: raw?.listingBoundImages === true,
    storedPhotoIdentityVerified: raw?.photoIdentityVerified === true,
    storedDetailIdentityVerified: raw?.detailIdentityVerified === true,
  };
  if (!sourceUrl) return { ...base, exactFetchOk: false, identityOk: false, exactImageCount: 0, error: "source_url_missing" };
  try {
    const detail = await fetchDetail(sourceUrl);
    const exactUrls = imageUrls(detail.markup, detail.finalUrl);
    const exactSet = new Set(exactUrls.map(fingerprint).filter(Boolean));
    const listingMisses = listing.filter((url) => !exactSet.has(fingerprint(url)));
    const currentMisses = current.filter((url) => {
      const fp = fingerprint(url);
      return fp && !exactSet.has(fp);
    });
    return {
      ...base,
      exactFetchOk: true,
      identityOk: identityMatches(detail.markup, offer),
      exactImageCount: exactUrls.length,
      listingMatchedOnExact: listing.length - listingMisses.length,
      listingMissCount: listingMisses.length,
      currentMatchedOnExact: current.length - currentMisses.length,
      currentMissCount: currentMisses.length,
      listingMissSamples: listingMisses.slice(0, 5),
      currentMissSamples: currentMisses.slice(0, 5),
    };
  } catch (error) {
    return { ...base, exactFetchOk: false, identityOk: false, exactImageCount: 0, error: String(error?.message || error) };
  }
});

const exactFetchFailures = checks.filter((row) => !row.exactFetchOk);
const identityFailures = checks.filter((row) => row.exactFetchOk && !row.identityOk);
const listingMismatchRows = checks.filter((row) => Number(row.listingMissCount || 0) > 0);
const currentMismatchRows = checks.filter((row) => Number(row.currentMissCount || 0) > 0);
const unverifiedStoredRows = checks.filter((row) => !row.storedListingBoundImages || !row.storedPhotoIdentityVerified);

const report = {
  version: 1,
  mode: "no_publish_current_georgia_gallery_identity_audit",
  checkedAt: new Date().toISOString(),
  productionCount: offers.length,
  autoGeorgiaCount: sourceRows.length,
  foreignSourceCount: foreignSourceRows.length,
  exactFetchSuccessCount: checks.length - exactFetchFailures.length,
  exactFetchFailureCount: exactFetchFailures.length,
  identityFailureCount: identityFailures.length,
  listingMismatchRowCount: listingMismatchRows.length,
  currentMismatchRowCount: currentMismatchRows.length,
  unverifiedStoredRowCount: unverifiedStoredRows.length,
  duplicateCurrentFingerprintCount: duplicateCurrentFingerprints.length,
  duplicateRawFingerprintCount: duplicateRawFingerprints.length,
  passed: foreignSourceRows.length === 0
    && exactFetchFailures.length === 0
    && identityFailures.length === 0
    && listingMismatchRows.length === 0
    && currentMismatchRows.length === 0
    && duplicateCurrentFingerprints.length === 0
    && duplicateRawFingerprints.length === 0,
  foreignSourceRows: foreignSourceRows.slice(0, 30).map((offer) => ({ id: offer.id, sourceId: offer.sourceId, sourceOfferId: offer.sourceOfferId })),
  exactFetchFailures: exactFetchFailures.slice(0, 30),
  identityFailures: identityFailures.slice(0, 30),
  listingMismatchRows: listingMismatchRows.slice(0, 30),
  currentMismatchRows: currentMismatchRows.slice(0, 30),
  duplicateCurrentFingerprints: duplicateCurrentFingerprints.slice(0, 100),
  duplicateRawFingerprints: duplicateRawFingerprints.slice(0, 100),
  checks,
};
await fs.writeFile(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify({
  productionCount: report.productionCount,
  autoGeorgiaCount: report.autoGeorgiaCount,
  exactFetchSuccessCount: report.exactFetchSuccessCount,
  exactFetchFailureCount: report.exactFetchFailureCount,
  identityFailureCount: report.identityFailureCount,
  listingMismatchRowCount: report.listingMismatchRowCount,
  currentMismatchRowCount: report.currentMismatchRowCount,
  duplicateCurrentFingerprintCount: report.duplicateCurrentFingerprintCount,
  duplicateRawFingerprintCount: report.duplicateRawFingerprintCount,
  passed: report.passed,
}, null, 2));