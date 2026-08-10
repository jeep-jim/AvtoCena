import { autohomeNewExactSource } from "../apps/web/lib/catalog/autohome-new-exact-source.ts";

const offer: any = {
  id: "diag",
  sourceId: "autohome_new_china_open",
  sourceOfferId: "68589",
  market: "china",
  offerType: "fixed",
  status: "active",
  make: "",
  model: "",
  trim: "2025款",
  year: 2025,
  sourcePrice: 1,
  sourceCurrency: "CNY",
  priceMode: "fixed",
  images: [],
  totalRub: null,
  calculationStatus: "needs_data",
  firstSeenAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  operational: { sourceUrl: "https://www.autohome.com.cn/spec/68589/", raw: {} },
};
let last: any;
for (let attempt = 1; attempt <= 4; attempt++) {
  try {
    const images: any[] = await autohomeNewExactSource.fetchImages(offer);
    const urls = images.map((x) => String(x.url || ""));
    console.log(JSON.stringify({ passed: true, count: urls.length, urls, make: offer.make, model: offer.model, trim: offer.trim, gallery: offer.operational?.raw?.galleryUrl, exactGalleryImageCount: offer.operational?.raw?.exactGalleryImageCount }, null, 2));
    process.exit(urls.length >= 5 && urls.every((u) => /https:\/\/car\d+\.autoimg\.cn\/cardfs\/product\//i.test(u)) ? 0 : 2);
  } catch (error) {
    last = error;
    console.warn(`attempt=${attempt}`, String((error as Error)?.message || error));
    await new Promise((resolve) => setTimeout(resolve, attempt * 2500));
  }
}
throw last;
