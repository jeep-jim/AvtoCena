process.env.CATALOG_RAW_LISTING_MODE = "1";
process.env.CATALOG_KNOWLEDGE_DISABLED = "1";
process.env.CATALOG_IMAGE_STORAGE_MODE = "source_urls_only";
process.env.CATALOG_MAX_IMAGES_PER_OFFER = "30";
process.env.CATALOG_REBUILD_MIN_IMAGES_PER_OFFER = "5";
process.env.CATALOG_ENCAR_DIRECT_LIST_RETRIES = "5";

const fs = await import("node:fs/promises");
const { encarCompleteSource } = await import("../apps/web/lib/catalog/encar-complete-source.ts");

const target = 120;
const maxPages = 4;
const offers = new Map();
const pageReports = [];
const samples = [];
let cursor = null;

for (let pageNo = 1; pageNo <= maxPages && offers.size < target; pageNo++) {
  const page = await encarCompleteSource.fetchPage(cursor);
  const rawItems = Array.isArray(page?.items) ? page.items : [];
  let normalized = 0;
  let accepted = 0;
  let sample = null;

  for (const raw of rawItems) {
    const offer = encarCompleteSource.normalizeOffer(raw);
    if (!offer) continue;
    normalized++;
    const validCore = Boolean(
      offer.id
        && offer.sourceId === "encar_direct"
        && offer.sourceOfferId
        && Number(offer.year || 0) >= 2011
        && Number(offer.sourcePrice || 0) > 0
        && offer.sourceCurrency === "KRW"
        && /^https:\/\/fem\.encar\.com\/cars\/detail\//.test(String(offer.operational?.sourceUrl || "")),
    );
    if (!validCore) continue;
    if (!offers.has(offer.id)) {
      offers.set(offer.id, offer);
      accepted++;
    }
    if (!sample) sample = offer;
  }

  if (sample && samples.length < 3) {
    const images = await encarCompleteSource.fetchImages(sample);
    samples.push({
      id: sample.id,
      sourceOfferId: sample.sourceOfferId,
      sourceUrl: sample.operational?.sourceUrl,
      make: sample.make,
      model: sample.model,
      trim: sample.trim,
      year: sample.year,
      mileageKm: sample.mileageKm,
      sourcePrice: sample.sourcePrice,
      sourceCurrency: sample.sourceCurrency,
      engineCc: sample.engineCc || null,
      powerHp: sample.powerHp || null,
      imageCount: images.length,
      firstImage: images[0]?.url || null,
    });
  }

  pageReports.push({
    page: pageNo,
    raw: rawItems.length,
    normalized,
    accepted,
    uniqueTotal: offers.size,
    finished: Boolean(page?.finished),
    nextCursor: page?.nextCursor || null,
  });

  cursor = page?.nextCursor || null;
  if (!cursor || page?.finished) break;
}

const result = {
  ok: offers.size >= target && pageReports.length >= 3 && samples.every((sample) => sample.imageCount >= 5),
  target,
  uniqueOffers: offers.size,
  pagesFetched: pageReports.length,
  pageReports,
  samples,
  knowledgeUsed: false,
  published: false,
  generatedAt: new Date().toISOString(),
};

await fs.writeFile("encar-pagination-smoke.json", JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));

if (!result.ok) {
  throw new Error(`encar_pagination_smoke_failed:unique=${result.uniqueOffers}:pages=${result.pagesFetched}`);
}
