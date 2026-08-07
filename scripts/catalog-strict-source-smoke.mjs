import fs from "node:fs/promises";

const { catalogImportSources } = await import("../apps/web/lib/catalog/importer.ts");
const { calculateOfferWithRussiaCustomsSourceOnly } = await import("../apps/web/lib/catalog/source-only-pricing.ts");
const { credibleCatalogImages, hasCredibleOfferContent } = await import("../apps/web/lib/catalog/offer-quality.ts");

const market = String(process.env.CATALOG_STRICT_MARKET || "korea").trim();
const sourceId = String(process.env.CATALOG_STRICT_SOURCE_ID || "encar_direct").trim();
const target = Math.max(1, Math.min(100, Number(process.env.CATALOG_STRICT_TARGET || 10)));
const maxPages = Math.max(1, Math.min(50, Number(process.env.CATALOG_STRICT_MAX_PAGES || 8)));
const output = process.env.CATALOG_STRICT_OUTPUT || `catalog-strict-${market}-${sourceId}-${target}.json`;
const currentYear = new Date().getFullYear();

process.env.CATALOG_REBUILD_MIN_IMAGES_PER_OFFER = "5";
process.env.CATALOG_MAX_IMAGES_PER_OFFER = "30";
process.env.CATALOG_COLLECTION_IMAGE_LIMIT = "30";
process.env.CATALOG_KNOWLEDGE_DISABLED = "1";

const source = catalogImportSources.find((adapter) => adapter.sourceId === sourceId);
if (!source) throw new Error(`strict_adapter_missing:${sourceId}`);
if (source.market !== market && source.market !== "multi") throw new Error(`strict_market_mismatch:${sourceId}:${source.market}:${market}`);

function clean(value) { return String(value ?? "").replace(/\s+/g, " ").trim(); }
function positive(value) { const n = Number(value); return Number.isFinite(n) && n > 0 ? n : 0; }
function exactFields(offer) {
  const list = Array.isArray(offer?.operational?.sourceExactFields)
    ? offer.operational.sourceExactFields
    : Array.isArray(offer?.operational?.raw?.sourceExactFields)
      ? offer.operational.raw.sourceExactFields
      : [];
  return new Set(list.map(clean).filter(Boolean));
}
function imageUrls(offer) {
  return [...new Set(credibleCatalogImages(offer?.images || []).map((image) => clean(image?.url)).filter((url) => /^https?:\/\//i.test(url)))];
}
function checks(offer) {
  const op = offer?.operational || {};
  const snap = offer?.calculationSnapshot || {};
  const customs = snap?.customs || {};
  const urls = imageUrls(offer);
  const fields = exactFields(offer);
  const powertrain = clean(offer?.powertrainKind);
  const electric = powertrain === "electric";
  const exact = (field) => fields.has(field);
  return {
    id: Boolean(offer?.id && offer?.sourceOfferId),
    exactUrl: /^https?:\/\//i.test(clean(op?.sourceUrl)),
    exactDetail: op?.detailIdentityVerified === true,
    exactFields: op?.fieldIdentityVerified === true,
    exactPhotos: op?.photoIdentityVerified === true && op?.vehiclePhotoVerified === true,
    make: exact("make") && Boolean(clean(offer?.make) && !/^(other|unknown)$/i.test(clean(offer?.make))),
    model: exact("model") && Boolean(clean(offer?.model) && !/^(other|unknown)$/i.test(clean(offer?.model))),
    year: exact("year") && Number(offer?.year || 0) >= 2011 && Number(offer?.year || 0) <= currentYear + 1,
    mileage: offer?.mileageKm == null || (exact("mileageKm") && Number(offer.mileageKm) >= 0 && Number(offer.mileageKm) <= 1_000_000),
    price: exact("sourcePrice") && exact("sourceCurrency") && positive(offer?.sourcePrice) > 0 && Boolean(clean(offer?.sourceCurrency)),
    engine: electric || (exact("engineCc") && positive(offer?.engineCc) > 0),
    fuel: exact("fuel") && Boolean(clean(offer?.fuel)),
    transmission: exact("transmission") && Boolean(clean(offer?.transmission)),
    drive: exact("drive") && Boolean(clean(offer?.drive)),
    body: exact("bodyType") && Boolean(clean(offer?.bodyType)),
    power: exact("powerHp") && positive(offer?.powerHp) > 0 && ["source_exact", "documented"].includes(clean(offer?.powerDataConfidence)),
    gallery: urls.length >= 5 && urls.length <= 30,
    sourceUrlsOnly: urls.length >= 5 && (offer?.images || []).every((image) => !clean(image?.objectKey) && !clean(image?.checksum)),
    sourceOnlyCalculation: op?.sourceOnlyCalculation === true && snap?.sourceOnly === true && !snap?.vehicleKnowledge,
    customs: customs?.status === "ready" && positive(customs?.totalCustomsRub) > 0,
    rubPrice: positive(offer?.totalRub) > 0 && ["ready", "estimated"].includes(clean(offer?.calculationStatus)),
    publicGate: hasCredibleOfferContent(offer),
  };
}
function summaryCard(offer, cardChecks) {
  return {
    id: offer?.id,
    sourceOfferId: offer?.sourceOfferId,
    sourceUrl: offer?.operational?.sourceUrl,
    sourceExactFields: [...exactFields(offer)],
    make: offer?.make,
    model: offer?.model,
    trim: offer?.trim,
    year: offer?.year,
    mileageKm: offer?.mileageKm,
    engineCc: offer?.engineCc,
    fuel: offer?.fuel,
    transmission: offer?.transmission,
    drive: offer?.drive,
    bodyType: offer?.bodyType,
    powerHp: offer?.powerHp,
    powerDataConfidence: offer?.powerDataConfidence,
    powerDataSource: offer?.powerDataSource,
    powertrainKind: offer?.powertrainKind,
    sourcePrice: offer?.sourcePrice,
    sourceCurrency: offer?.sourceCurrency,
    imageCount: imageUrls(offer).length,
    imageUrls: imageUrls(offer).slice(0, 10),
    totalRub: offer?.totalRub,
    calculationStatus: offer?.calculationStatus,
    customsStatus: offer?.calculationSnapshot?.customs?.status,
    checks: cardChecks,
  };
}

const accepted = [];
const rejected = [];
const seen = new Set();
let cursor = null;
let pages = 0;
let rowsSeen = 0;

while (accepted.length < target && pages < maxPages) {
  const page = await source.fetchPage(cursor);
  pages++;
  const rows = Array.isArray(page?.items) ? page.items : [];
  rowsSeen += rows.length;
  for (const raw of rows) {
    if (accepted.length >= target) break;
    let offer;
    try { offer = source.normalizeOffer(raw); } catch (error) {
      rejected.push({ stage: "normalize", error: String(error?.message || error) });
      continue;
    }
    if (!offer?.id || seen.has(offer.id)) continue;
    seen.add(offer.id);
    try {
      const gallery = await source.fetchImages(offer);
      offer.images = credibleCatalogImages(gallery || []).slice(0, 30);
      offer.status = "active";
      const calculated = await calculateOfferWithRussiaCustomsSourceOnly(offer);
      const cardChecks = checks(calculated);
      const failed = Object.entries(cardChecks).filter(([, ok]) => !ok).map(([name]) => name);
      const card = summaryCard(calculated, cardChecks);
      if (!failed.length) accepted.push(card);
      else rejected.push({ ...card, failed });
    } catch (error) {
      rejected.push({ id: offer.id, sourceOfferId: offer.sourceOfferId, stage: "detail_or_calculation", error: String(error?.message || error) });
    }
  }
  cursor = page?.nextCursor || null;
  if (!cursor || page?.finished) break;
}

const rejectionReasons = {};
for (const row of rejected) {
  for (const reason of row.failed || [row.stage || "unknown"]) rejectionReasons[reason] = Number(rejectionReasons[reason] || 0) + 1;
}
const report = {
  version: 3,
  mode: "strict_exact_source_only_no_publish_no_generic_normalization",
  checkedAt: new Date().toISOString(),
  market,
  sourceId,
  target,
  pages,
  rowsSeen,
  uniqueSeen: seen.size,
  accepted: accepted.length,
  rejected: rejected.length,
  rejectionReasons,
  cards: accepted,
  rejectedSample: rejected.slice(0, 20),
  passed: accepted.length >= target,
};
await fs.writeFile(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exit(1);
