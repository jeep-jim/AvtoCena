const { credibleCatalogImages, hasCredibleOfferContent } = await import("../apps/web/lib/catalog/offer-quality.ts");
const { persistCatalogOffers, readAllOffersForMaintenance } = await import("../apps/web/lib/catalog/storage.ts");

const RECOVERY_WINDOW_MS = Number(process.env.CATALOG_RECOVERY_WINDOW_MS || 45 * 24 * 60 * 60 * 1000);
const now = Date.now();
const offers = await readAllOffersForMaintenance();
let reactivated = 0;
let imagesRemoved = 0;
let keptInactive = 0;

const recovered = offers.map((offer) => {
  const previousImageCount = Array.isArray(offer.images) ? offer.images.length : 0;
  const images = credibleCatalogImages(offer.images || []);
  imagesRemoved += Math.max(0, previousImageCount - images.length);

  const candidate = { ...offer, images };
  const lastSeen = Date.parse(String(offer?.operational?.lastSeenAt || offer.updatedAt || offer.firstSeenAt || ""));
  const recentEnough = !Number.isFinite(lastSeen) || now - lastSeen <= RECOVERY_WINDOW_MS;
  const recoverableStatus = offer.status === "active" || offer.status === "stale";
  const credible = hasCredibleOfferContent({ ...candidate, status: "active" });

  if (recoverableStatus && recentEnough && credible) {
    if (offer.status !== "active") reactivated++;
    return { ...candidate, status: "active" };
  }

  keptInactive++;
  return candidate;
});

const manifest = await persistCatalogOffers(recovered);
const publicOffers = recovered.filter((offer) => offer.status === "active" && hasCredibleOfferContent(offer));
const byMarket = publicOffers.reduce((totals, offer) => {
  totals[offer.market] = (totals[offer.market] || 0) + 1;
  return totals;
}, {});

const result = {
  generationId: manifest.generationId,
  totalStored: recovered.length,
  publicOffers: publicOffers.length,
  byMarket,
  reactivated,
  imagesRemoved,
  keptInactive,
};
console.log(JSON.stringify(result, null, 2));

const minimum = Number(process.env.CATALOG_RECOVERY_MIN_PUBLIC || 20);
if (offers.length >= minimum && publicOffers.length < minimum) {
  console.error(`catalog_recovery_underfilled_${publicOffers.length}_of_${offers.length}`);
  process.exitCode = 1;
}
