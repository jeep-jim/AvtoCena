import { encarCompleteSource } from "../apps/web/lib/catalog/encar-complete-source.ts";
import { kcarKoreaExactSource } from "../apps/web/lib/catalog/kcar-exact-source.ts";

async function retry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  let last: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try { return await fn(); }
    catch (error) {
      last = error;
      console.warn(JSON.stringify({ label, attempt, error: String((error as Error)?.message || error) }));
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 2500 * attempt));
    }
  }
  throw last;
}

async function main() {
  const encarPage: any = await retry("encar_page", () => encarCompleteSource.fetchPage(null));
  const encarRaw = encarPage.items?.[0];
  if (!encarRaw) throw new Error("encar_no_live_row");
  const encarOffer: any = encarCompleteSource.normalizeOffer(encarRaw);
  if (!encarOffer) throw new Error("encar_normalize_failed");
  const encarImages: any[] = await retry("encar_gallery", () => encarCompleteSource.fetchImages(encarOffer));
  console.log(JSON.stringify({ source: "encar", id: encarOffer.sourceOfferId, count: encarImages.length, first: encarImages[0]?.url, mode: encarOffer.operational?.gallerySafetyMode }));
  if (encarImages.length < 5) throw new Error(`encar_gallery_too_small:${encarImages.length}`);
  if (encarOffer.operational?.gallerySafetyMode !== "encar_source_cover_photolist_v3") throw new Error("encar_wrong_gallery_mode");

  const kcarPage: any = await retry("kcar_page", () => kcarKoreaExactSource.fetchPage("1"));
  const kcarRows: any[] = Array.isArray(kcarPage.items) ? kcarPage.items : [];
  if (!kcarRows.length) throw new Error("kcar_no_verified_rows");
  const badCover = kcarRows.find((row: any) => /\/extra\//i.test(String(row?.images?.[0] || "")));
  console.log(JSON.stringify({ source: "kcar", rows: kcarRows.length, first: kcarRows[0]?.images?.[0] || null, badCover: badCover?.id || null }));
  if (badCover) throw new Error(`kcar_extra_cover:${badCover.id}`);
  if (kcarRows.some((row: any) => !Array.isArray(row.images) || row.images.length < 5)) throw new Error("kcar_verified_row_below_5");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
