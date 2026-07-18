const { readDataJson } = await import("../apps/web/lib/data.ts");
const { chunkName, offerPath, persistCatalogOffers, readAllOffersForMaintenance } = await import("../apps/web/lib/catalog/storage.ts");
const { hasCredibleOfferContent } = await import("../apps/web/lib/catalog/offer-quality.ts");

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

function usable(offer) {
  return offer && ["active", "stale"].includes(String(offer.status || ""))
    && hasCredibleOfferContent({ ...offer, status: "active" });
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
const merged = new Map(current.map((offer) => [offer.id, offer]));
const recoveredByGeneration = {};
let recovered = 0;

for (const generationId of generations) {
  const rows = await readGeneration(generationId);
  let accepted = 0;
  for (const offer of rows) {
    if (!usable(offer)) continue;
    const existing = merged.get(offer.id);
    const existingUsable = existing && usable(existing);
    const existingTime = Date.parse(String(existing?.updatedAt || existing?.firstSeenAt || "")) || 0;
    const recoveredTime = Date.parse(String(offer.updatedAt || offer.firstSeenAt || "")) || 0;
    if (!existingUsable || recoveredTime > existingTime) {
      merged.set(offer.id, { ...offer, status: "active" });
      accepted++;
    }
  }
  if (accepted) {
    recovered += accepted;
    recoveredByGeneration[generationId] = accepted;
  }
}

const beforePublic = current.filter((offer) => offer.status === "active" && usable(offer)).length;
const next = [...merged.values()];
const afterPublic = next.filter((offer) => offer.status === "active" && usable(offer)).length;
const byMarket = next.filter((offer) => offer.status === "active" && usable(offer)).reduce((totals, offer) => {
  totals[offer.market] = (totals[offer.market] || 0) + 1;
  return totals;
}, {});

if (afterPublic >= beforePublic + minimumGain) {
  const manifest = await persistCatalogOffers(next);
  console.log(JSON.stringify({ restored: true, generationId: manifest.generationId, beforePublic, afterPublic, byMarket, recovered, recoveredByGeneration }, null, 2));
} else {
  console.log(JSON.stringify({ restored: false, beforePublic, afterPublic, byMarket, recovered, recoveredByGeneration, reason: "no_better_historical_generation" }, null, 2));
}
