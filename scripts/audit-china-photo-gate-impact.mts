import { readMarketOffers } from "../apps/web/lib/catalog/storage.ts";

const rows: any[] = await readMarketOffers("china");
const imageCount = (row: any) => Array.isArray(row?.images) ? row.images.length : 0;
const modelKey = (row: any) => `${String(row?.make || "").trim().toLowerCase()}|${String(row?.model || "").trim().toLowerCase()}`;
const isEv = (row: any) => String(row?.powertrainKind || "").toLowerCase() === "electric" || /electric|纯电|\bev\b|электро/i.test(String(row?.fuel || ""));
const isHybrid = (row: any) => ["series_hybrid", "other_hybrid"].includes(String(row?.powertrainKind || "").toLowerCase()) || /hybrid|混合动力|phev|hev|гибрид/i.test(String(row?.fuel || ""));
const isPrelim = (row: any) => String(row?.calculationStatus || "") === "preliminary_power_pending";

function stats(list: any[]) {
  const models = new Set(list.map(modelKey).filter((x) => !x.endsWith("|")));
  const makes = new Set(list.map((row) => String(row?.make || "").trim()).filter(Boolean));
  const modelCounts = new Map<string, number>();
  for (const row of list) modelCounts.set(modelKey(row), (modelCounts.get(modelKey(row)) || 0) + 1);
  return {
    count: list.length,
    ev: list.filter(isEv).length,
    hybrid: list.filter(isHybrid).length,
    preliminary: list.filter(isPrelim).length,
    makes: makes.size,
    models: models.size,
    maxExactModel: Math.max(0, ...modelCounts.values()),
    averageImages: list.length ? Math.round(list.reduce((sum, row) => sum + imageCount(row), 0) / list.length * 100) / 100 : 0,
  };
}

const sparseAll = rows.filter((row) => imageCount(row) < 5);
const sparseAutoHome = sparseAll.filter((row) => String(row?.sourceId || "") === "autohome_new_china_open");
const keepAll5 = rows.filter((row) => imageCount(row) >= 5);
const keepOnlyAutoHomeGate = rows.filter((row) => String(row?.sourceId || "") !== "autohome_new_china_open" || imageCount(row) >= 5);
const beforeModels = new Set(rows.map(modelKey));
const afterModels = new Set(keepAll5.map(modelKey));
const lostModelKeys = [...beforeModels].filter((key) => !afterModels.has(key) && key && !key.endsWith("|"));
const lostMakeNames = [...new Set(rows.filter((row) => lostModelKeys.includes(modelKey(row))).map((row) => String(row?.make || "").trim()).filter(Boolean))];
const sourceCounts: Record<string, number> = {};
const sparseBySource: Record<string, number> = {};
for (const row of rows) sourceCounts[String(row?.sourceId || "unknown")] = (sourceCounts[String(row?.sourceId || "unknown")] || 0) + 1;
for (const row of sparseAll) sparseBySource[String(row?.sourceId || "unknown")] = (sparseBySource[String(row?.sourceId || "unknown")] || 0) + 1;

console.log(JSON.stringify({
  checkedAt: new Date().toISOString(),
  before: stats(rows),
  sparseAll: stats(sparseAll),
  sparseAutoHome: stats(sparseAutoHome),
  keepIfAllSourcesRequire5: stats(keepAll5),
  keepIfOnlyAutoHomeRequires5: stats(keepOnlyAutoHomeGate),
  removedShareAllSourcesPct: rows.length ? Math.round(sparseAll.length / rows.length * 10000) / 100 : 0,
  lostDistinctModelsAllSourcesGate: lostModelKeys.length,
  lostDistinctMakesRepresentedByLostModels: lostMakeNames.length,
  sampleLostModels: lostModelKeys.slice(0, 60),
  sourceCounts,
  sparseBySource,
}, null, 2));
