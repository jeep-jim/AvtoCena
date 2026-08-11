import { readMarketOffers } from "../apps/web/lib/catalog/storage.ts";

const rows: any[] = await readMarketOffers("europe");
const sparse = rows.filter((row: any) => (Array.isArray(row?.images) ? row.images.length : 0) < 5);
const bySource: Record<string, number> = {};
const byCount: Record<string, number> = {};
const samples = sparse.map((row: any) => {
  const sourceId = String(row?.sourceId || "unknown");
  const images = Array.isArray(row?.images) ? row.images : [];
  bySource[sourceId] = (bySource[sourceId] || 0) + 1;
  byCount[String(images.length)] = (byCount[String(images.length)] || 0) + 1;
  return {
    id: row?.id,
    sourceId,
    sourceOfferId: row?.sourceOfferId,
    year: row?.year,
    make: row?.make,
    model: row?.model,
    imageCount: images.length,
    sourceUrl: row?.operational?.sourceUrl || "",
    rawImageCount: Array.isArray(row?.operational?.raw?.images) ? row.operational.raw.images.length : 0,
    photoIdentityVerified: row?.operational?.photoIdentityVerified === true || row?.operational?.raw?.photoIdentityVerified === true || row?.operational?.raw?.detailIdentityVerified === true,
    listingBoundImages: row?.operational?.raw?.listingBoundImages === true,
    gallerySafetyMode: row?.operational?.gallerySafetyMode || "",
    imageHosts: [...new Set(images.map((img: any) => { try { return new URL(String(img?.url || "")).hostname; } catch { return ""; } }).filter(Boolean))],
  };
});
console.log(JSON.stringify({checkedAt:new Date().toISOString(),publicEuropeCount:rows.length,currentBelow5:sparse.length,bySource,byCount,samples},null,2));
