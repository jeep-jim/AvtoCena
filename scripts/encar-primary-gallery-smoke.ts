import { encarCompleteSource } from "../apps/web/lib/catalog/encar-complete-source.ts";

async function main() {
  const page: any = await encarCompleteSource.fetchPage(null);
  const raw = page.items?.[0];
  if (!raw) throw new Error("encar_no_live_row");
  const offer: any = encarCompleteSource.normalizeOffer(raw);
  if (!offer) throw new Error("encar_normalize_failed");
  const images: any[] = await encarCompleteSource.fetchImages(offer);
  console.log(JSON.stringify({ id: offer.sourceOfferId, count: images.length, first: images[0]?.url, mode: offer.operational?.gallerySafetyMode }));
  if (images.length < 5) throw new Error(`encar_gallery_too_small:${images.length}`);
  if (offer.operational?.gallerySafetyMode !== "encar_source_cover_photolist_v3") throw new Error("encar_wrong_gallery_mode");
  if (!String(images[0]?.url || "").includes("encar.com")) throw new Error("encar_first_not_source_image");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
