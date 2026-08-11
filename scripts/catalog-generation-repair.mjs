const { readDataJson } = await import("../apps/web/lib/data.ts");
const { persistCatalogOffers, readMarketOffers, offerPath } = await import("../apps/web/lib/catalog/storage.ts");
const { credibleCatalogImages, hasCredibleOfferContent, isCatalogYearAllowed } = await import("../apps/web/lib/catalog/offer-quality.ts");
const { normalizeVehicleOfferSpecs } = await import("../apps/web/lib/catalog/spec-normalization.ts");
const { PUBLIC_CATALOG_MARKETS } = await import("../apps/web/lib/catalog/runtime-config.ts");

const sourceGeneration = String(process.env.CATALOG_REPAIR_SOURCE_GENERATION || "").trim();
const dryRun = String(process.env.CATALOG_REPAIR_DRY_RUN || "1") !== "0";
const requestedMarkets = String(process.env.CATALOG_REPAIR_MARKETS || PUBLIC_CATALOG_MARKETS.join(","))
  .split(",").map((value) => value.trim()).filter(Boolean);
const repairMarkets = new Set(requestedMarkets);
if (!/^gen_[A-Za-z0-9_-]+$/.test(sourceGeneration)) throw new Error("catalog_repair_source_generation_invalid");
for (const market of repairMarkets) if (!PUBLIC_CATALOG_MARKETS.includes(market)) throw new Error(`catalog_repair_market_invalid:${market}`);
if (!repairMarkets.size) throw new Error("catalog_repair_markets_empty");

const maxOffersPerModel = 20;
function modelKey(offer) {
  const make = String(offer?.make || "").trim().toLowerCase().replace(/\s+/g, " ");
  const model = String(offer?.model || "").trim().toLowerCase().replace(/\s+/g, " ");
  return make && model ? `${make}|${model}` : "";
}
function japanSold(offer) {
  if (offer?.market !== "japan") return true;
  const raw = offer?.operational?.raw || {};
  return offer?.offerType === "auction"
    && offer?.catalogKind === "auction_result"
    && offer?.auctionResult === "sold"
    && offer?.auctionPriceKind === "published_result"
    && String(raw.currentStatus || "") === "Sold"
    && Number(raw.finalPriceJpy || 0) > 0
    && Number(raw.finalPriceJpy || 0) === Number(offer?.sourcePrice || 0)
    && String(offer?.sourceCurrency || "") === "JPY";
}
function canonicalize(rows, market) {
  const unique = new Map();
  const rejected = {};
  const reject = (key) => { rejected[key] = Number(rejected[key] || 0) + 1; };
  for (const raw of rows) {
    const offer = normalizeVehicleOfferSpecs({ ...raw, status: "active", images: credibleCatalogImages(raw?.images || []).slice(0, 30) });
    if (!offer?.id || unique.has(offer.id)) continue;
    if (!isCatalogYearAllowed(offer.year, market)) { reject("year"); continue; }
    if (!hasCredibleOfferContent({ ...offer, status: "active" })) { reject("public_quality"); continue; }
    if (!japanSold(offer)) { reject("japan_sold"); continue; }
    unique.set(offer.id, offer);
  }
  return { kept: [...unique.values()], rejected };
}
async function mapPool(items, limit, worker) {
  const out = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length || 1) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      out[index] = await worker(items[index], index);
    }
  }));
  return out;
}

const byIdIndex = await readDataJson(`catalog/generations/${sourceGeneration}/indexes/offers-by-id.json`, { byId: {} });
const all = [];
const report = { version: 2, sourceGeneration, dryRun, repairMarkets: [...repairMarkets], markets: {}, failures: [] };

for (const market of PUBLIC_CATALOG_MARKETS) {
  let rows = [];
  let indexed = null;
  let sourceMode = "current";
  if (repairMarkets.has(market)) {
    sourceMode = "source_generation";
    const marketIndex = await readDataJson(`catalog/generations/${sourceGeneration}/indexes/market/${market}.json`, { ids: [] });
    const ids = Array.isArray(marketIndex?.ids) ? marketIndex.ids : [];
    indexed = ids.length;
    const wanted = new Set(ids);
    const locations = new Map();
    for (const id of ids) {
      const loc = byIdIndex?.byId?.[id];
      if (loc?.market === market && loc?.chunk) locations.set(`${market}/${loc.chunk}`, loc);
    }
    const chunks = await mapPool([...locations.values()], 12, (loc) => readDataJson(offerPath(sourceGeneration, market, loc.chunk), []));
    rows = chunks.flat().filter((offer) => offer?.id && wanted.has(offer.id));
  } else {
    rows = await readMarketOffers(market);
    indexed = rows.length;
  }

  const { kept, rejected } = canonicalize(rows, market);
  const modelCounts = new Map();
  for (const offer of kept) {
    const key = modelKey(offer);
    if (!key) continue;
    modelCounts.set(key, Number(modelCounts.get(key) || 0) + 1);
  }
  const maxPerExactModel = Math.max(0, ...modelCounts.values());
  if (maxPerExactModel > maxOffersPerModel) throw new Error(`catalog_repair_model_cap:${market}:${maxPerExactModel}`);
  report.markets[market] = {
    sourceMode,
    indexed,
    loaded: rows.length,
    canonical: kept.length,
    rejected,
    distinctModels: modelCounts.size,
    maxPerExactModel,
  };
  all.push(...kept);
}

if (!all.length) throw new Error("catalog_repair_empty");
if (dryRun) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

process.env.CATALOG_GROW_ONLY_MARKETS = "";
const manifest = await persistCatalogOffers(all);
report.published = true;
report.generationId = manifest?.generationId || null;
report.postPersistByMarket = {};
for (const market of PUBLIC_CATALOG_MARKETS) {
  report.postPersistByMarket[market] = (await readMarketOffers(market)).length;
  const expected = Number(report.markets[market]?.canonical || 0);
  if (Number(report.postPersistByMarket[market]) !== expected) {
    report.failures.push(`${market}:postpersist_mismatch:${report.postPersistByMarket[market]}:${expected}`);
  }
}
console.log(JSON.stringify(report, null, 2));
if (report.failures.length) process.exit(1);
