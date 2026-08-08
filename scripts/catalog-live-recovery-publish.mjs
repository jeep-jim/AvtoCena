import fs from "node:fs/promises";

const { persistCatalogOffers, readMarketOffers } = await import("../apps/web/lib/catalog/storage.ts");
const { credibleCatalogImages } = await import("../apps/web/lib/catalog/offer-quality.ts");
const { normalizeVehicleOfferSpecs } = await import("../apps/web/lib/catalog/spec-normalization.ts");
const { PUBLIC_CATALOG_MARKETS } = await import("../apps/web/lib/catalog/runtime-config.ts");

const market = String(process.env.RECOVERY_PUBLISH_MARKET || "").trim();
const input = String(process.env.RECOVERY_PUBLISH_INPUT || `catalog-rebuild-${market}.json`).trim();
const output = String(process.env.RECOVERY_PUBLISH_REPORT || `catalog-live-recovery-${market}-publish-report.json`).trim();
const maxPerMarket = Math.max(1, Math.min(5_000, Number(process.env.RECOVERY_PUBLISH_MAX || 3_000)));
const preferredMaxRub = Math.max(500_000, Number(process.env.RECOVERY_PREFERRED_MAX_RUB || 8_000_000));
const minYear = new Date().getFullYear() - 15;

if (!PUBLIC_CATALOG_MARKETS.includes(market)) throw new Error(`recovery_publish_market_invalid:${market}`);

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
  const op = offer?.operational || {};
  const raw = op?.raw || {};
  return /^https?:\/\//i.test(String(op.sourceUrl || ""))
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
  return ap - bp
    || Number(b.year || 0) - Number(a.year || 0)
    || Number(b.images?.length || 0) - Number(a.images?.length || 0)
    || Number(a.totalRub || Number.MAX_SAFE_INTEGER) - Number(b.totalRub || Number.MAX_SAFE_INTEGER)
    || String(a.id || "").localeCompare(String(b.id || ""));
}

const payload = JSON.parse(await fs.readFile(input, "utf8"));
const sourceRows = Array.isArray(payload?.offers) ? payload.offers : [];
const seen = new Set();
const selected = [];
const rejected = {};
function reject(reason) { rejected[reason] = Number(rejected[reason] || 0) + 1; }

for (const raw of sourceRows) {
  const offer = normalizeVehicleOfferSpecs({ ...raw, status: "active", images: credibleCatalogImages(raw?.images || []).slice(0, 30) });
  if (!offer?.id || seen.has(offer.id)) continue;
  seen.add(offer.id);
  if (offer.market !== market) { reject("market"); continue; }
  const year = Number(offer.year || 0);
  if (year < minYear || year > new Date().getFullYear() + 1) { reject("year"); continue; }
  if (!offer.make || !offer.model || !offer.images.length) { reject("visible_core"); continue; }
  if (!exactSourceBound(offer)) { reject("source_binding"); continue; }
  if (!exactCalculation(offer)) { reject("calculation"); continue; }
  selected.push(offer);
}
selected.sort(quality);
const marketRows = selected.slice(0, maxPerMarket);
if (!marketRows.length) {
  const report = { version: 1, mode: "live_market_exact_calculated_publish", market, published: false, generationId: null, count: 0, rejected, publicationError: `recovery_empty_market:${market}` };
  await fs.writeFile(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  process.exit(1);
}

const combined = [...marketRows];
const preservedByMarket = {};
for (const other of PUBLIC_CATALOG_MARKETS) {
  if (other === market) continue;
  let rows = [];
  try { rows = await readMarketOffers(other); } catch { rows = []; }
  const preserved = rows
    .filter((offer) => ["active", "stale"].includes(String(offer?.status || "")))
    .map((offer) => ({ ...offer, status: "active", images: credibleCatalogImages(offer?.images || []).slice(0, 30) }))
    .filter((offer) => offer.id && offer.make && offer.model && Number(offer.year || 0) >= minYear && offer.images.length > 0)
    .slice(0, 5_000);
  preservedByMarket[other] = preserved.length;
  combined.push(...preserved);
}
const unique = new Map();
for (const offer of combined) if (offer?.id && !unique.has(offer.id)) unique.set(offer.id, offer);

let manifest = null;
let publicationError = "";
try {
  process.env.CATALOG_GROW_ONLY_MARKETS = "";
  manifest = await persistCatalogOffers([...unique.values()]);
} catch (error) {
  publicationError = String(error?.message || error);
}

const report = {
  version: 1,
  mode: "live_market_exact_calculated_publish",
  market,
  publishedAt: new Date().toISOString(),
  published: Boolean(manifest),
  generationId: manifest?.generationId || null,
  count: marketRows.length,
  preferredCount: marketRows.filter((offer) => Number(offer.totalRub || 0) <= preferredMaxRub).length,
  calculatedCount: marketRows.filter(exactCalculation).length,
  minYear,
  preferredMaxRub,
  sourceCounts: Object.fromEntries([...new Set(marketRows.map((offer) => String(offer.sourceId || "unknown")))].map((sourceId) => [sourceId, marketRows.filter((offer) => String(offer.sourceId || "unknown") === sourceId).length])),
  imageStats: {
    min: Math.min(...marketRows.map((offer) => offer.images.length)),
    max: Math.max(...marketRows.map((offer) => offer.images.length)),
    average: Number((marketRows.reduce((sum, offer) => sum + offer.images.length, 0) / marketRows.length).toFixed(2)),
  },
  preservedByMarket,
  rejected,
  publicationError,
};
await fs.writeFile(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (!manifest || publicationError) process.exit(1);
