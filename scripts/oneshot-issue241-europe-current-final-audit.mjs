import fs from "node:fs/promises";

const { getJsonStorage } = await import("../apps/web/lib/data.ts");
const { canonicalSourceModelIdentity } = await import("../apps/web/lib/catalog/open-source-normalizer.ts");
const { catalogModelYearQuotaKey } = await import("../apps/web/lib/catalog/inventory-quota.ts");
const { catalogMinYearForMarket } = await import("../apps/web/lib/catalog/offer-quality.ts");
const { offerPath } = await import("../apps/web/lib/catalog/storage.ts");
const { PUBLIC_CATALOG_MARKETS } = await import("../apps/web/lib/catalog/runtime-config.ts");

const storage = getJsonStorage();
const TARGET_MARKET = "europe";
const AUTOSCOUT = "autoscout_europe_open";
const BAD_IMAGE_RE = /(?:no[-_ ]?photo|no[-_ ]?image|nophoto|noimage|image[-_ ]?not[-_ ]?available|coming[-_ ]?soon|default[-_ ]?(?:car|vehicle|image)|upload[-_ ]?image|placeholder|qrcode|qr-code|qr_|weixin|wechat|scan|download[-_ ]?app|appstore|googleplay|favicon|sprite|tracking|pixel|social|share[-_ ]?icon|camera[-_ ]?off|dummy[-_ ]?(?:car|image))/i;

function clean(value) { return String(value || "").replace(/\s+/g, " ").trim(); }
function semanticKey(value) { return clean(value).toLocaleLowerCase("en-US").replace(/[^a-z0-9а-яё]+/gi, ""); }
function imageUrl(image) { return typeof image === "string" ? image : String(image?.url || ""); }
function imageResolution(image) {
  const url = imageUrl(image);
  const match = url.match(/\/(\d{2,5})x(\d{2,5})\.(?:jpe?g|webp|avif|png)(?:[?#]|$)/i);
  return {
    width: Number(image?.width || match?.[1] || 0),
    height: Number(image?.height || match?.[2] || 0),
  };
}
function sourceUrl(offer) { return String(offer?.operational?.sourceUrl || offer?.sourceUrl || ""); }
function titleText(offer) {
  return clean(offer?.sourceTitle || offer?.operational?.sourceTitle || offer?.title || [offer?.make, offer?.model, offer?.trim].filter(Boolean).join(" "));
}
function isExactAutoScoutImage(offer, image) {
  const id = clean(offer?.sourceOfferId);
  const url = imageUrl(image);
  if (!id || !/^https:\/\/prod\.pictures\.autoscout24\.net\/listing-images\//i.test(url)) return false;
  let pathname = "";
  try { pathname = new URL(url).pathname.toLowerCase(); } catch { return false; }
  const { width, height } = imageResolution(image);
  return pathname.startsWith(`/listing-images/${id}_`.toLowerCase())
    && width >= 900
    && height >= 600
    && !/\/250x188\./i.test(url)
    && !BAD_IMAGE_RE.test(url);
}
function autoScoutProblems(offer) {
  const problems = [];
  const id = clean(offer?.sourceOfferId);
  const src = sourceUrl(offer);
  const images = Array.isArray(offer?.images) ? offer.images : [];
  if (!id) problems.push("missing_sourceOfferId");
  if (!/^https:\/\/www\.autoscout24\.com\/offers\//i.test(src) || (id && !src.includes(id))) problems.push("source_url_identity");
  if (images.length < 5) problems.push(`images:${images.length}`);
  if (new Set(images.map(imageUrl).filter(Boolean)).size !== images.length) problems.push("duplicate_urls");
  const bad = images.filter((image) => !isExactAutoScoutImage(offer, image));
  if (bad.length) problems.push(`invalid_hq_images:${bad.length}`);
  return problems;
}
async function readPublicState() {
  const meta = await storage.readJsonWithMeta("catalog/manifest.json", { version: 2, generationId: "", markets: {} });
  if (!meta.found || !meta.etag || !meta.value?.generationId) throw new Error("public_manifest_missing");
  const byMarket = new Map();
  for (const market of PUBLIC_CATALOG_MARKETS) {
    const entry = meta.value.markets?.[market];
    if (!entry || !Array.isArray(entry.chunks)) throw new Error(`public_manifest_market_missing:${market}`);
    const rows = [];
    for (const chunk of entry.chunks) {
      const part = await storage.readJson(offerPath(meta.value.generationId, market, chunk), null);
      if (!Array.isArray(part)) throw new Error(`public_chunk_invalid:${market}:${chunk}`);
      rows.push(...part);
    }
    if (rows.length !== Number(entry.count || 0)) throw new Error(`public_count_mismatch:${market}:${rows.length}:${entry.count || 0}`);
    byMarket.set(market, rows);
  }
  return { meta, byMarket };
}
async function readInternalAutoScout() {
  const meta = await storage.readJsonWithMeta("catalog/internal/manifest.json", { generationId: "", sources: {} });
  if (!meta.found || !meta.etag || !meta.value?.generationId) throw new Error("internal_manifest_missing");
  const source = meta.value.sources?.[AUTOSCOUT];
  if (!source || !Array.isArray(source.chunks)) throw new Error("internal_autoscout_source_missing");
  const rows = [];
  for (const path of source.chunks) {
    const part = await storage.readJson(path, null);
    if (!Array.isArray(part)) throw new Error(`internal_chunk_invalid:${path}`);
    rows.push(...part);
  }
  if (rows.length !== Number(source.count || 0)) throw new Error(`internal_autoscout_count_mismatch:${rows.length}:${source.count || 0}`);
  return { meta, rows };
}

const beforePublic = await readPublicState();
const beforeInternal = await readInternalAutoScout();
const europe = beforePublic.byMarket.get(TARGET_MARKET) || [];
const autoscout = europe.filter((offer) => String(offer?.sourceId || "") === AUTOSCOUT);

const quota = new Map();
for (const offer of europe) {
  const key = catalogModelYearQuotaKey(offer, TARGET_MARKET);
  if (key) quota.set(key, (quota.get(key) || 0) + 1);
}
const maxQuota = Math.max(0, ...quota.values());
const overQuota = [...quota.entries()].filter(([, count]) => count > 20).sort((a, b) => b[1] - a[1]);
const minEuropeYear = catalogMinYearForMarket(TARGET_MARKET);
const badYears = europe.filter((offer) => Number(offer?.year || 0) < minEuropeYear);
const belowFive = europe.filter((offer) => !Array.isArray(offer?.images) || offer.images.length < 5);
const thumb250 = europe.filter((offer) => (offer?.images || []).some((image) => /\/250x188\./i.test(imageUrl(image))));
const placeholders = europe.filter((offer) => (offer?.images || []).some((image) => BAD_IMAGE_RE.test(imageUrl(image))));

const malformedMercedes = europe.filter((offer) => {
  const make = clean(offer?.make);
  const model = clean(offer?.model);
  if (!/mercedes|benz/i.test(`${make} ${model}`)) return false;
  const canonical = clean(canonicalSourceModelIdentity(titleText(offer), make, model));
  return canonical && semanticKey(canonical) !== semanticKey(model);
});

const autoscoutBad = autoscout.map((offer) => ({
  id: offer.id,
  sourceOfferId: offer.sourceOfferId,
  problems: autoScoutProblems(offer),
})).filter((row) => row.problems.length);

const internalById = new Map(beforeInternal.rows.map((row) => [String(row?.id || ""), row]));
const publicMissingInternal = [];
const publicInternalIdentityMismatch = [];
for (const offer of autoscout) {
  const internal = internalById.get(String(offer?.id || ""));
  if (!internal) {
    publicMissingInternal.push(String(offer?.id || ""));
    continue;
  }
  if (clean(internal?.sourceOfferId) !== clean(offer?.sourceOfferId)) {
    publicInternalIdentityMismatch.push({ id: offer.id, public: offer.sourceOfferId, internal: internal.sourceOfferId });
  }
}

const sourceCounts = {};
for (const offer of europe) sourceCounts[String(offer?.sourceId || "unknown")] = (sourceCounts[String(offer?.sourceId || "unknown")] || 0) + 1;
const allSeven = {};
for (const market of PUBLIC_CATALOG_MARKETS) {
  const rows = beforePublic.byMarket.get(market) || [];
  const minYear = catalogMinYearForMarket(market);
  const buckets = new Map();
  let below5 = 0;
  let belowMin = 0;
  for (const offer of rows) {
    if (Number(offer?.year || 0) < minYear) belowMin++;
    if (!Array.isArray(offer?.images) || offer.images.length < 5) below5++;
    const key = catalogModelYearQuotaKey(offer, market);
    if (key) buckets.set(key, (buckets.get(key) || 0) + 1);
  }
  allSeven[market] = {
    count: rows.length,
    minYear,
    belowMinYear: belowMin,
    belowFiveImages: below5,
    maxExactModelYear: Math.max(0, ...buckets.values()),
  };
}

const afterPublic = await storage.readJsonWithMeta("catalog/manifest.json", {});
const afterInternal = await storage.readJsonWithMeta("catalog/internal/manifest.json", {});
const publicStable = afterPublic.etag === beforePublic.meta.etag && afterPublic.value?.generationId === beforePublic.meta.value.generationId;
const internalStable = afterInternal.etag === beforeInternal.meta.etag && afterInternal.value?.generationId === beforeInternal.meta.value.generationId;

const failures = [];
if (!publicStable) failures.push("public_manifest_changed_during_audit");
if (!internalStable) failures.push("internal_manifest_changed_during_audit");
if (badYears.length) failures.push(`europe_below_min_year:${badYears.length}`);
if (belowFive.length) failures.push(`europe_below_five_images:${belowFive.length}`);
if (thumb250.length) failures.push(`europe_250x188:${thumb250.length}`);
if (placeholders.length) failures.push(`europe_placeholder_images:${placeholders.length}`);
if (maxQuota > 20) failures.push(`europe_model_year_quota:${maxQuota}`);
if (malformedMercedes.length) failures.push(`europe_provable_mercedes_identity:${malformedMercedes.length}`);
if (autoscoutBad.length) failures.push(`autoscout_hq_identity_quality:${autoscoutBad.length}`);
if (publicMissingInternal.length) failures.push(`autoscout_public_missing_internal:${publicMissingInternal.length}`);
if (publicInternalIdentityMismatch.length) failures.push(`autoscout_public_internal_identity_mismatch:${publicInternalIdentityMismatch.length}`);

const report = {
  checkedAt: new Date().toISOString(),
  publicGenerationId: beforePublic.meta.value.generationId,
  internalGenerationId: beforeInternal.meta.value.generationId,
  publicStable,
  internalStable,
  allSeven,
  europe: {
    count: europe.length,
    sourceCounts,
    minYear: europe.length ? Math.min(...europe.map((row) => Number(row?.year || 0)).filter(Boolean)) : 0,
    belowMinYear: badYears.length,
    belowFiveImages: belowFive.length,
    thumb250: thumb250.length,
    placeholderRows: placeholders.length,
    maxExactModelYear: maxQuota,
    overQuota: overQuota.slice(0, 20),
    provableMalformedMercedes: malformedMercedes.length,
    malformedMercedesSample: malformedMercedes.slice(0, 20).map((row) => ({ id: row.id, make: row.make, model: row.model, sourceTitle: titleText(row), canonical: canonicalSourceModelIdentity(titleText(row), row.make, row.model) })),
  },
  autoscout: {
    count: autoscout.length,
    invalid: autoscoutBad.length,
    invalidSample: autoscoutBad.slice(0, 20),
    publicMissingInternal: publicMissingInternal.length,
    publicMissingInternalSample: publicMissingInternal.slice(0, 20),
    publicInternalIdentityMismatch: publicInternalIdentityMismatch.length,
    publicInternalIdentityMismatchSample: publicInternalIdentityMismatch.slice(0, 20),
    internalSourceCount: beforeInternal.rows.length,
  },
  failures,
};
await fs.writeFile("issue241-europe-current-final-audit.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (failures.length) process.exitCode = 1;
