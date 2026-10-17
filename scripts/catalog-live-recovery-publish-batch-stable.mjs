import fs from "node:fs/promises";
import path from "node:path";

const { persistCatalogOffers, readMarketOffers } = await import("../apps/web/lib/catalog/storage.ts");
const { credibleCatalogImages, hasCredibleOfferContent, isCatalogYearAllowed } = await import("../apps/web/lib/catalog/offer-quality.ts");
const { normalizeVehicleOfferSpecs } = await import("../apps/web/lib/catalog/spec-normalization.ts");
const { PUBLIC_CATALOG_MARKETS } = await import("../apps/web/lib/catalog/runtime-config.ts");
const { enrichOfferWithKnowledgeCore } = await import("../apps/web/lib/catalog/knowledge-core.ts");
const { CATALOG_MAX_OFFERS_PER_MODEL_YEAR, catalogModelYearQuotaKey, catalogExactModelKey } = await import("../apps/web/lib/catalog/inventory-quota.ts");

const markets = String(process.env.RECOVERY_BATCH_MARKETS || "uae,georgia").split(",").map((value) => value.trim()).filter(Boolean);
const inputDir = String(process.env.RECOVERY_BATCH_INPUT_DIR || "recovery-input").trim();
const output = String(process.env.RECOVERY_BATCH_REPORT || "catalog-direct-recovery-batch-stable-report.json").trim();
const maxPerMarket = Math.max(1, Math.min(5_000, Number(process.env.RECOVERY_PUBLISH_MAX || 3_000)));
const preferredMaxRub = Math.max(500_000, Number(process.env.RECOVERY_PREFERRED_MAX_RUB || 8_000_000));
const maxOffersPerModelYear = CATALOG_MAX_OFFERS_PER_MODEL_YEAR;

if (!markets.length || markets.some((market) => !PUBLIC_CATALOG_MARKETS.includes(market))) throw new Error(`recovery_batch_markets_invalid:${markets.join(",")}`);

function exactCalculation(offer) {
  const total = Number(offer?.totalRub || 0);
  const customs = offer?.calculationSnapshot?.customs;
  const breakdown = offer?.calculationSnapshot?.breakdown;
  if (!(total > 0) || customs?.status !== "ready" || !Number.isFinite(Number(customs?.totalCustomsRub))) return false;
  if (!Array.isArray(breakdown) || !breakdown.some((line) => line?.id === "car") || !breakdown.some((line) => line?.id === "customs")) return false;
  const kind = String(offer?.powertrainKind || "");
  if (!["electric", "series_hybrid", "other_hybrid"].includes(kind)) return Number(offer?.engineCc || 0) > 0 && Number(offer?.powerHp || 0) > 0;
  if (Number(offer?.utilizationPowerKw || 0) > 0) return true;
  const motor30 = Number(offer?.power30MinKw || 0) || (Array.isArray(offer?.power30MinKwByMotor) ? offer.power30MinKwByMotor.reduce((sum, value) => sum + Math.max(0, Number(value || 0)), 0) : 0);
  return kind === "other_hybrid" ? motor30 > 0 && Number(offer?.icePowerKw || 0) > 0 : motor30 > 0;
}
function exactSourceBound(offer) {
  const raw = offer?.operational?.raw || {};
  return /^https?:\/\//i.test(String(offer?.operational?.sourceUrl || ""))
    && Number(offer?.sourcePrice || 0) > 0
    && Boolean(String(offer?.sourceCurrency || "").trim())
    && raw.recoveryExactSourceUrl === true
    && raw.recoveryExactPhotoIdentity === true
    && raw.recoveryCalculatedRub === true
    && raw.recoveryBodySourceOnly === true;
}
function quality(a, b) {
  const ap = Number(a.totalRub || 0) <= preferredMaxRub ? 0 : 1;
  const bp = Number(b.totalRub || 0) <= preferredMaxRub ? 0 : 1;
  return ap - bp || Number(b.year || 0) - Number(a.year || 0) || Number(b.images?.length || 0) - Number(a.images?.length || 0)
    || Number(a.totalRub || Number.MAX_SAFE_INTEGER) - Number(b.totalRub || Number.MAX_SAFE_INTEGER) || String(a.id || "").localeCompare(String(b.id || ""));
}
function makeKey(offer) { return String(offer?.make || "").trim().toLocaleLowerCase("en-US").replace(/\s+/g, " "); }
function normalizeVisible(raw) {
  const op = raw?.operational || {};
  const sourceRaw = op?.raw || {};
  const exactPhoto = sourceRaw.recoveryExactPhotoIdentity === true;
  return normalizeVehicleOfferSpecs({
    ...raw,
    status: "active",
    images: credibleCatalogImages(raw?.images || []).slice(0, 30),
    operational: {
      ...op,
      ...(exactPhoto ? { photoIdentityVerified: true } : {}),
      raw: { ...sourceRaw, ...(exactPhoto ? { photoIdentityVerified: true, listingBoundImages: true } : {}) },
    },
  });
}
async function normalizeAsPersisted(raw) {
  return normalizeVehicleOfferSpecs(await enrichOfferWithKnowledgeCore(normalizeVisible(raw)));
}
function applyDiversity(rows, rejected, market) {
  const selected = [];
  const countByModelYear = new Map();
  for (const offer of rows) {
    const key = catalogModelYearQuotaKey(offer, market);
    if (!key) continue;
    if (Number(countByModelYear.get(key) || 0) >= maxOffersPerModelYear) {
      rejected.model_year_quota = Number(rejected.model_year_quota || 0) + 1;
      continue;
    }
    countByModelYear.set(key, Number(countByModelYear.get(key) || 0) + 1);
    selected.push(offer);
    if (selected.length >= maxPerMarket) break;
  }
  return selected;
}

const selectedByMarket = new Map();
const rejectedByMarket = {};
for (const market of markets) {
  const payload = JSON.parse(await fs.readFile(path.join(inputDir, `catalog-rebuild-${market}.json`), "utf8"));
  const sourceRows = Array.isArray(payload?.offers) ? payload.offers : [];
  const seen = new Set(), selected = [], rejected = {};
  const reject = (reason) => { rejected[reason] = Number(rejected[reason] || 0) + 1; };
  for (const raw of sourceRows) {
    const offer = await normalizeAsPersisted(raw);
    if (!offer?.id || seen.has(offer.id)) continue;
    seen.add(offer.id);
    if (offer.market !== market) { reject("market"); continue; }
    const year = Number(offer.year || 0);
    if (!isCatalogYearAllowed(year, market)) { reject("year"); continue; }
    if (!offer.make || !offer.model || !offer.images.length) { reject("visible_core"); continue; }
    if (!exactSourceBound(offer)) { reject("source_binding"); continue; }
    if (!exactCalculation(offer)) { reject("calculation"); continue; }
    if (!hasCredibleOfferContent(offer)) { reject("public_gate"); continue; }
    selected.push(offer);
  }
  selected.sort(quality);
  const rows = applyDiversity(selected, rejected, market);
  if (!rows.length) throw new Error(`recovery_batch_empty_market:${market}`);
  selectedByMarket.set(market, rows);
  rejectedByMarket[market] = rejected;
}

const combined = [...selectedByMarket.values()].flat();
const preservedByMarket = {};
for (const other of PUBLIC_CATALOG_MARKETS) {
  if (markets.includes(other)) continue;
  let rows = [];
  try { rows = await readMarketOffers(other); } catch { rows = []; }
  const preserved = [];
  for (const raw of rows) {
    const offer = await normalizeAsPersisted(raw);
    if (["active", "stale"].includes(String(raw?.status || "")) && offer.id && offer.make && offer.model && isCatalogYearAllowed(offer.year, other) && hasCredibleOfferContent({ ...offer, status: "active" })) preserved.push({ ...offer, status: "active" });
    if (preserved.length >= 5_000) break;
  }
  preservedByMarket[other] = preserved.length;
  combined.push(...preserved);
}
const unique = new Map();
for (const offer of combined) if (offer?.id && !unique.has(offer.id)) unique.set(offer.id, offer);
process.env.CATALOG_GROW_ONLY_MARKETS = "";
const manifest = await persistCatalogOffers([...unique.values()]);

const marketReports = {};
for (const market of markets) {
  const rows = selectedByMarket.get(market) || [];
  const manifestCount = Number(manifest?.markets?.[market]?.count || 0);
  if (manifestCount !== rows.length) throw new Error(`recovery_batch_manifest_mismatch_after_preflight:${market}:${manifestCount}:${rows.length}`);
  marketReports[market] = {
    count: rows.length,
    preferredCount: rows.filter((offer) => Number(offer.totalRub || 0) <= preferredMaxRub).length,
    calculatedCount: rows.filter(exactCalculation).length,
    maxOffersPerModelYear,
    distinctModels: new Set(rows.map((offer) => catalogExactModelKey(offer, market)).filter(Boolean)).size,
    distinctModelYears: new Set(rows.map((offer) => catalogModelYearQuotaKey(offer, market)).filter(Boolean)).size,
    distinctMakes: new Set(rows.map(makeKey)).size,
    sourceCounts: Object.fromEntries([...new Set(rows.map((offer) => String(offer.sourceId || "unknown")))].map((sourceId) => [sourceId, rows.filter((offer) => String(offer.sourceId || "unknown") === sourceId).length])),
    rejected: rejectedByMarket[market],
  };
}
const report = { version: 3, mode: "live_markets_exact_calculated_batch_publish_preflight", published: true, generationId: manifest.generationId, byMarket: marketReports, preservedByMarket,
  manifestCounts: Object.fromEntries(PUBLIC_CATALOG_MARKETS.map((market) => [market, Number(manifest?.markets?.[market]?.count || 0)])) };
await fs.writeFile(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
