const { readDataJson } = await import("../apps/web/lib/data.ts");
const { credibleCatalogImages, hasCredibleOfferContent } = await import("../apps/web/lib/catalog/offer-quality.ts");
const { normalizeVehicleOfferSpecs } = await import("../apps/web/lib/catalog/spec-normalization.ts");
const { chunkName, offerPath, persistCatalogOffers, readAllOffersForMaintenance } = await import("../apps/web/lib/catalog/storage.ts");

const MARKETS = String(process.env.CATALOG_RECOVERY_MARKETS || "korea,china,japan,uae,europe").split(",").map((value) => value.trim()).filter(Boolean);
const EMERGENCY_GENERATIONS = [
  // Last confirmed production generation before the destructive underfill.
  "gen_1784276049832_9868cbbe",
];
const configured = String(process.env.CATALOG_RECOVERY_GENERATIONS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const history = await readDataJson("catalog/history/public-manifests.json", []);
const historyGenerations = Array.isArray(history)
  ? history.map((item) => String(item?.generationId || "")).filter(Boolean).reverse()
  : [];
const generations = [...new Set([...configured, ...historyGenerations, ...EMERGENCY_GENERATIONS])];
const maxChunks = Math.max(1, Number(process.env.CATALOG_RECOVERY_MAX_CHUNKS || 20));
const minimumGain = Math.max(1, Number(process.env.CATALOG_RECOVERY_MIN_GAIN || 5));
const recoveredAt = new Date().toISOString();

function specScore(offer) {
  const fuel = String(offer?.fuel || "").trim();
  const electric = /electric|bev|электро|纯电|전기/i.test(fuel);
  return [
    Number(offer?.mileageKm) >= 0,
    Boolean(fuel),
    Boolean(String(offer?.transmission || "").trim()),
    Boolean(String(offer?.drive || "").trim()),
    Boolean(String(offer?.bodyType || "").trim()),
    electric || Number(offer?.engineCc || 0) > 0,
    Number(offer?.powerHp || offer?.powerKw || 0) > 0,
  ].filter(Boolean).length;
}

function prepare(offer, generationId = "") {
  if (!offer || !["active", "stale"].includes(String(offer.status || ""))) return null;
  const images = credibleCatalogImages(Array.isArray(offer.images) ? offer.images : []).slice(0, 3);
  if (images.length < 3) return null;
  const candidate = normalizeVehicleOfferSpecs({
    ...offer,
    status: "active",
    images,
    operational: {
      ...(offer.operational || {}),
      galleryVerified: true,
      galleryImageCount: images.length,
      emergencyRecoveredAt: recoveredAt,
      emergencySourceGeneration: generationId || offer?.operational?.emergencySourceGeneration || "active-storage",
    },
  });
  if (specScore(candidate) < 4) return null;
  return hasCredibleOfferContent(candidate) ? candidate : null;
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
const merged = new Map();
for (const offer of current) {
  const prepared = prepare(offer);
  if (prepared) merged.set(prepared.id, prepared);
}
const recoveredByGeneration = {};
let recovered = 0;

for (const generationId of generations) {
  const rows = await readGeneration(generationId);
  let accepted = 0;
  for (const offer of rows) {
    const prepared = prepare(offer, generationId);
    if (!prepared) continue;
    const existing = merged.get(prepared.id);
    const existingTime = Date.parse(String(existing?.updatedAt || existing?.firstSeenAt || "")) || 0;
    const recoveredTime = Date.parse(String(prepared.updatedAt || prepared.firstSeenAt || "")) || 0;
    if (!existing || recoveredTime > existingTime) {
      merged.set(prepared.id, prepared);
      accepted++;
    }
  }
  if (accepted) {
    recovered += accepted;
    recoveredByGeneration[generationId] = accepted;
  }
}

const beforePublic = current.map((offer) => prepare(offer)).filter(Boolean).length;
const next = [...merged.values()];
const afterPublic = next.length;
const byMarket = next.reduce((totals, offer) => {
  totals[offer.market] = (totals[offer.market] || 0) + 1;
  return totals;
}, {});

if (afterPublic >= beforePublic + minimumGain || (beforePublic === 0 && afterPublic > 0)) {
  const manifest = await persistCatalogOffers(next);
  console.log(JSON.stringify({ restored: true, generationId: manifest.generationId, beforePublic, afterPublic, byMarket, recovered, recoveredByGeneration }, null, 2));
} else {
  console.log(JSON.stringify({ restored: false, beforePublic, afterPublic, byMarket, recovered, recoveredByGeneration, reason: "no_better_historical_generation" }, null, 2));
}
