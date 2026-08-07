import fs from "node:fs/promises";

process.env.CATALOG_PRIORITY_MAX_AGE_YEARS = "6";
process.env.CATALOG_MAX_IMAGES_PER_OFFER = "30";

const { JpaucPastAdapter } = await import("../apps/web/lib/catalog/jpauc-past-source.ts");
const source = new JpaucPastAdapter();
const page = await source.fetchPage(null);
const candidates = [];
for (const raw of page.items || []) {
  const offer = source.normalizeOffer(raw);
  if (offer) candidates.push(offer);
}
if (!candidates.length) throw new Error("jpauc_smoke_no_priced_recent_candidates");

const offer = candidates[0];
const images = await source.fetchImages(offer);
const imageChecks = [];
for (const image of images.slice(0, 3)) {
  let state = { url: image.url, ok: false, status: 0, contentType: "", bytes: 0, error: "" };
  try {
    const response = await fetch(image.url, {
      headers: {
        accept: "image/avif,image/webp,image/*,*/*;q=0.8",
        referer: "https://jpauc.com/",
        range: "bytes=0-32767",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150.0.0.0 Safari/537.36",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(30000),
    });
    const body = new Uint8Array(await response.arrayBuffer());
    state = {
      url: image.url,
      ok: response.ok && /^image\//i.test(response.headers.get("content-type") || "") && body.length > 500,
      status: response.status,
      contentType: response.headers.get("content-type") || "",
      bytes: body.length,
      error: "",
    };
  } catch (error) {
    state.error = String(error?.message || error);
  }
  imageChecks.push(state);
}

const checks = {
  pageItems: Number(page.items?.length || 0) > 0,
  pageTotal: Number(page.count || 0) >= Number(page.items?.length || 0),
  stableId: Boolean(offer.id && offer.sourceOfferId),
  sourceTitle: Boolean(offer.sourceTitle && offer.sourceTitle.length > 2),
  year: Number(offer.year || 0) >= new Date().getFullYear() - 6,
  sourcePrice: Number(offer.sourcePrice || 0) > 0 && offer.sourceCurrency === "JPY",
  sourceUrl: /^https:\/\/jpauc\.com\/auction\/past\/detail\//i.test(String(offer.operational?.sourceUrl || "")),
  photoCount: images.length >= 3 && images.length <= 30,
  sourceUrlsOnly: images.every((image) => /^https?:\/\//i.test(image.url) && !image.objectKey && !image.checksum),
  photosOpen: imageChecks.length >= 3 && imageChecks.every((check) => check.ok),
};
const passed = Object.values(checks).every(Boolean);
const report = {
  checkedAt: new Date().toISOString(),
  passed,
  checks,
  page: { items: page.items?.length || 0, total: page.count || 0, nextCursor: page.nextCursor || null },
  card: {
    id: offer.id,
    sourceOfferId: offer.sourceOfferId,
    sourceUrl: offer.operational?.sourceUrl,
    sourceTitle: offer.sourceTitle,
    make: offer.make,
    model: offer.model,
    trim: offer.trim,
    year: offer.year,
    mileageKm: offer.mileageKm,
    engineCc: offer.engineCc,
    sourcePrice: offer.sourcePrice,
    sourceCurrency: offer.sourceCurrency,
    auctionDate: offer.auctionDate,
    auctionName: offer.auctionName,
    lotNumber: offer.lotNumber,
    auctionGrade: offer.auctionGrade,
    imageCount: images.length,
    images: images.map((image) => image.url),
  },
  imageChecks,
};
await fs.writeFile("jpauc-past-adapter-smoke.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (!passed) process.exit(1);
