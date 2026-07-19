const { readDataJson } = await import("../apps/web/lib/data.ts");
const { credibleCatalogImages, hasCredibleOfferContent } = await import("../apps/web/lib/catalog/offer-quality.ts");
const { normalizeVehicleOfferSpecs } = await import("../apps/web/lib/catalog/spec-normalization.ts");
const { chunkName, offerPath, persistCatalogOffers, readAllOffersForMaintenance } = await import("../apps/web/lib/catalog/storage.ts");

const requestedMarkets = String(process.env.CATALOG_RECOVERY_MARKETS || "").split(",").map((value) => value.trim()).filter(Boolean);
const MARKETS = [...new Set([...requestedMarkets, "korea", "china", "japan", "uae", "europe"])];
const CONFIRMED_GENERATIONS = ["gen_1784276049832_9868cbbe"];
const configured = String(process.env.CATALOG_RECOVERY_GENERATIONS || "").split(",").map((value) => value.trim()).filter(Boolean);
const history = await readDataJson("catalog/history/public-manifests.json", []);
const historyGenerations = Array.isArray(history) ? history.map((item) => String(item?.generationId || "")).filter(Boolean).reverse() : [];
const generations = [...new Set([...configured, ...CONFIRMED_GENERATIONS, ...historyGenerations])];
const maxChunks = Math.max(1, Number(process.env.CATALOG_RECOVERY_MAX_CHUNKS || 50));
const forceRestore = ["1", "true", "yes", "on"].includes(String(process.env.CATALOG_RECOVERY_FORCE || "true").toLowerCase());
const recoveredAt = new Date().toISOString();

function completeness(offer) {
  return [offer?.mileageKm != null, offer?.engineCc, offer?.powerHp || offer?.powerKw, offer?.fuel, offer?.transmission, offer?.drive, offer?.bodyType, offer?.color].filter(Boolean).length;
}

function prepare(offer, generationId = "") {
  if (!offer || !["active", "stale"].includes(String(offer.status || ""))) return null;
  const images = credibleCatalogImages(Array.isArray(offer.images) ? offer.images : []);
  if (!images.length) return null;
  const candidate = normalizeVehicleOfferSpecs({
    ...offer,
    status: "active",
    images,
    operational: {
      ...(offer.operational || {}),
      galleryImageCount: images.length,
      recoveredAt,
      recoveredFromGeneration: generationId || offer?.operational?.recoveredFromGeneration || "active-storage",
    },
  });
  return hasCredibleOfferContent(candidate) ? candidate : null;
}

function preferCandidate(existing, candidate) {
  if (!existing) return candidate;
  const existingImages = Array.isArray(existing.images) ? existing.images.length : 0;
  const candidateImages = Array.isArray(candidate.images) ? candidate.images.length : 0;
  if (candidateImages !== existingImages) return candidateImages > existingImages ? candidate : existing;
  const existingSpecs = completeness(existing);
  const candidateSpecs = completeness(candidate);
  if (candidateSpecs !== existingSpecs) return candidateSpecs > existingSpecs ? candidate : existing;
  const existingTime = Date.parse(String(existing.updatedAt || existing.firstSeenAt || "")) || 0;
  const candidateTime = Date.parse(String(candidate.updatedAt || candidate.firstSeenAt || "")) || 0;
  return candidateTime > existingTime ? candidate : existing;
}

async function readGeneration(generationId) {
  const offers = [];
  for (const market of MARKETS) {
    let misses = 0;
    for (let index = 1; index <= maxChunks; index++) {
      const rows = await readDataJson(offerPath(generationId, market, chunkName(index)), null);
      if (!Array.isArray(rows) || !rows.length) {
        misses++;
        if (misses >= 2) break;
        continue;
      }
      misses = 0;
      offers.push(...rows);
    }
  }
  return offers;
}

const current = await readAllOffersForMaintenance();
const beforeByMarket = current.reduce((totals, offer) => {
  const candidate = prepare(offer);
  if (candidate) totals[candidate.market] = (totals[candidate.market] || 0) + 1;
  return totals;
}, {});

const merged = new Map();
for (const offer of current) {
  const candidate = prepare(offer);
  if (candidate) merged.set(candidate.id, candidate);
}

const recoveredByGeneration = {};
for (const generationId of generations) {
  const rows = await readGeneration(generationId);
  let accepted = 0;
  for (const offer of rows) {
    const candidate = prepare(offer, generationId);
    if (!candidate) continue;
    const existing = merged.get(candidate.id);
    const preferred = preferCandidate(existing, candidate);
    if (preferred !== existing) accepted++;
    merged.set(candidate.id, preferred);
  }
  if (accepted) recoveredByGeneration[generationId] = accepted;
}

const next = [...merged.values()];
const afterByMarket = next.reduce((totals, offer) => {
  totals[offer.market] = (totals[offer.market] || 0) + 1;
  return totals;
}, {});
const restoredMissingMarket = MARKETS.some((market) => Number(beforeByMarket[market] || 0) === 0 && Number(afterByMarket[market] || 0) > 0);
const richerMarket = MARKETS.some((market) => Number(afterByMarket[market] || 0) > Number(beforeByMarket[market] || 0));
const shouldPublish = next.length > 0 && (forceRestore || restoredMissingMarket || richerMarket);

if (!shouldPublish) {
  console.log(JSON.stringify({ restored: false, beforeByMarket, afterByMarket, recoveredByGeneration, reason: "no_recoverable_market_data" }, null, 2));
  process.exit(1);
}

const manifest = await persistCatalogOffers(next);
console.log(JSON.stringify({ restored: true, generationId: manifest.generationId, beforeTotal: current.length, afterTotal: next.length, beforeByMarket, afterByMarket, recoveredByGeneration }, null, 2));
