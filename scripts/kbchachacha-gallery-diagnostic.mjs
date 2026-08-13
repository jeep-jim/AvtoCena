const { kbChaChaChaExactSource } = await import("../apps/web/lib/catalog/kbchachacha-exact-source.ts");

const limit = Math.max(1, Math.min(20, Number(process.env.KB_GALLERY_DIAGNOSTIC_LIMIT || 12)));
const maxPages = Math.max(1, Math.min(5, Number(process.env.KB_GALLERY_DIAGNOSTIC_PAGES || 2)));
const rows = [];
let cursor = null;
for (let page = 0; page < maxPages && rows.length < limit; page++) {
  const result = await kbChaChaChaExactSource.fetchPage(cursor);
  for (const raw of Array.isArray(result?.items) ? result.items : []) {
    const offer = kbChaChaChaExactSource.normalizeOffer(raw);
    if (!offer || Number(offer.year || 0) < 2020) continue;
    rows.push(offer);
    if (rows.length >= limit) break;
  }
  if (!result?.nextCursor || result?.finished) break;
  cursor = result.nextCursor;
}

const samples = [];
for (const offer of rows) {
  const before = offer.images?.length || 0;
  try {
    const images = await kbChaChaChaExactSource.fetchImages(offer);
    samples.push({
      sourceOfferId: String(offer.sourceOfferId || ""),
      year: Number(offer.year || 0),
      make: String(offer.make || ""),
      model: String(offer.model || ""),
      before,
      after: images.length,
      safetyMode: String(offer.operational?.gallerySafetyMode || ""),
      detailIdentityVerified: offer.operational?.detailIdentityVerified === true,
      passedFive: images.length >= 5,
      error: null,
    });
  } catch (error) {
    samples.push({
      sourceOfferId: String(offer.sourceOfferId || ""),
      year: Number(offer.year || 0),
      make: String(offer.make || ""),
      model: String(offer.model || ""),
      before,
      after: 0,
      safetyMode: String(offer.operational?.gallerySafetyMode || ""),
      detailIdentityVerified: offer.operational?.detailIdentityVerified === true,
      passedFive: false,
      error: String(error?.message || error),
    });
  }
}

const report = {
  version: 1,
  mode: "kbchachacha_readonly_gallery_diagnostic",
  limit,
  sampled: samples.length,
  detailVerified: samples.filter((row) => row.detailIdentityVerified).length,
  fallback: samples.filter((row) => row.safetyMode === "kbchachacha_exact_listing_card_car_seq_v1").length,
  passedFive: samples.filter((row) => row.passedFive).length,
  belowFive: samples.filter((row) => !row.passedFive).length,
  minAfter: samples.length ? Math.min(...samples.map((row) => row.after)) : 0,
  maxAfter: samples.length ? Math.max(...samples.map((row) => row.after)) : 0,
  samples,
};
console.log(JSON.stringify(report, null, 2));
