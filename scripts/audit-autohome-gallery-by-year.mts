import { readMarketOffers } from "../apps/web/lib/catalog/storage.ts";
import { autohomeNewExactSource } from "../apps/web/lib/catalog/autohome-new-exact-source.ts";

process.env.CATALOG_IMAGE_STORAGE_MODE = "source_urls_only";

const directRe = /^https:\/\/car\d+\.autoimg\.cn\/cardfs\/product\//i;
const resizedRe = /(?:g\.autoimg\.cn\/@img\/|\/(?:240|300|320|360|400|480)x0[_-]|\/(?:small|thumb|thumbnail)\/)/i;
const rows: any[] = (await readMarketOffers("china"))
  .filter((row: any) => String(row?.sourceId || "") === "autohome_new_china_open");

function urls(row: any) {
  return (Array.isArray(row?.images) ? row.images : []).map((x: any) => String(x?.url || "")).filter(Boolean);
}
function stale(row: any) {
  const list = urls(row);
  return list.length < 5 || list.some((url: string) => resizedRe.test(url)) || !list.every((url: string) => directRe.test(url));
}

const byYear: Record<string, any> = {};
for (const row of rows) {
  const year = String(Number(row?.year || 0));
  const list = urls(row);
  byYear[year] ||= { total: 0, below5: 0, stale: 0, directOnly: 0, averageImages: 0, imageSum: 0 };
  const stat = byYear[year];
  stat.total++;
  stat.imageSum += list.length;
  if (list.length < 5) stat.below5++;
  if (stale(row)) stat.stale++;
  if (list.length && list.every((url: string) => directRe.test(url))) stat.directOnly++;
}
for (const stat of Object.values(byYear)) {
  stat.averageImages = stat.total ? Math.round((stat.imageSum / stat.total) * 100) / 100 : 0;
  delete stat.imageSum;
}

const samplePerYear = Math.max(1, Math.min(12, Number(process.env.AUDIT_SAMPLE_PER_YEAR || 8)));
const probes: any[] = [];
for (let year = 2020; year <= new Date().getFullYear(); year++) {
  const candidates = rows
    .filter((row: any) => Number(row?.year || 0) === year && urls(row).length < 5)
    .sort((a: any, b: any) => String(a?.id || "").localeCompare(String(b?.id || "")))
    .slice(0, samplePerYear);
  for (const row of candidates) probes.push({ year, row });
}

const results: any[] = new Array(probes.length);
let cursor = 0;
await Promise.all(Array.from({ length: Math.min(4, probes.length) }, async () => {
  while (true) {
    const index = cursor++;
    if (index >= probes.length) return;
    const { year, row } = probes[index];
    const before = urls(row).length;
    const probe = structuredClone(row);
    probe.images = [];
    try {
      const exact = await autohomeNewExactSource.fetchImages(probe);
      results[index] = {
        year,
        id: row.id,
        sourceOfferId: row.sourceOfferId,
        before,
        exact: exact.length,
        exactDirect: exact.filter((img: any) => directRe.test(String(img?.url || ""))).length,
        galleryUrl: probe?.operational?.raw?.galleryUrl || "",
        exactGalleryImageCount: Number(probe?.operational?.raw?.exactGalleryImageCount || 0),
      };
    } catch (error: any) {
      results[index] = { year, id: row.id, sourceOfferId: row.sourceOfferId, before, exact: 0, error: String(error?.message || error) };
    }
  }
}));

const probeByYear: Record<string, any> = {};
for (const result of results) {
  const year = String(result.year);
  probeByYear[year] ||= { probed: 0, improvedTo5: 0, deep10: 0, exactSum: 0, failures: 0, exactCounts: [] as number[] };
  const stat = probeByYear[year];
  stat.probed++;
  stat.exactSum += Number(result.exact || 0);
  stat.exactCounts.push(Number(result.exact || 0));
  if (Number(result.exact || 0) >= 5) stat.improvedTo5++;
  if (Number(result.exact || 0) >= 10) stat.deep10++;
  if (result.error) stat.failures++;
}
for (const stat of Object.values(probeByYear)) {
  stat.averageExact = stat.probed ? Math.round((stat.exactSum / stat.probed) * 100) / 100 : 0;
  delete stat.exactSum;
}

const report = {
  checkedAt: new Date().toISOString(),
  publicAutoHomeNewCount: rows.length,
  currentBelow5: rows.filter((row: any) => urls(row).length < 5).length,
  currentStale: rows.filter(stale).length,
  byYear,
  probeByYear,
  samples: results,
};
console.log(JSON.stringify(report, null, 2));
