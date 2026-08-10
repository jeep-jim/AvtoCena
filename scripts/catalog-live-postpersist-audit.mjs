const { readMarketOffers } = await import("../apps/web/lib/catalog/storage.ts");
const { PUBLIC_CATALOG_MARKETS } = await import("../apps/web/lib/catalog/runtime-config.ts");

const output = String(process.env.CATALOG_AUDIT_OUTPUT || "catalog-live-postpersist-audit.json");
const assertMarkets = new Set(String(process.env.CATALOG_AUDIT_ASSERT_MARKETS || "").split(",").map((v) => v.trim()).filter(Boolean));
let minimums = {};
try { minimums = JSON.parse(process.env.CATALOG_AUDIT_MIN_COUNTS_JSON || "{}"); } catch { minimums = {}; }
const currentYear = new Date().getFullYear();
const nonVehicle = /\b(?:motorcycle|motorbike|scooter|forklift|excavator|bulldozer|tractor|crane|generator|boat|ship|machinery|spare\s+parts?|engine\s+only|truck|dump|tipper|lorry)\b|(?:货车|卡车|客车|巴士|工程机械|商用车)/i;
function key(offer) {
  const make = String(offer?.make || "").trim().toLowerCase().replace(/\s+/g, " ");
  const model = String(offer?.model || "").trim().toLowerCase().replace(/\s+/g, " ");
  return make && model ? `${String(offer?.market || "")}|${make}|${model}` : "";
}
function isElectric(offer) { return String(offer?.powertrainKind || "") === "electric" || /(?:electric|pure electric|bev|纯电|электро)/i.test(String(offer?.fuel || "")); }
function isHybrid(offer) { return ["series_hybrid", "other_hybrid"].includes(String(offer?.powertrainKind || "")) || /(?:hybrid|phev|hev|增程|混合动力|гибрид)/i.test(String(offer?.fuel || "")); }

const report = { version: 1, checkedAt: new Date().toISOString(), markets: {}, failures: [] };
for (const market of PUBLIC_CATALOG_MARKETS) {
  let rows = [];
  try { rows = await readMarketOffers(market); } catch (error) { report.failures.push(`${market}:read:${String(error?.message || error)}`); continue; }
  const modelCounts = new Map();
  for (const offer of rows) { const k = key(offer); if (k) modelCounts.set(k, Number(modelCounts.get(k) || 0) + 1); }
  const stats = {
    count: rows.length,
    electricCount: rows.filter(isElectric).length,
    hybridCount: rows.filter(isHybrid).length,
    preliminaryCount: rows.filter((offer) => String(offer?.calculationStatus || "") === "preliminary_power_pending" || offer?.calculationSnapshot?.pricingConfidence === "preliminary").length,
    exactCalculatedCount: rows.filter((offer) => String(offer?.calculationSnapshot?.customs?.status || "") === "ready" && Number(offer?.totalRub || 0) > 0).length,
    priorityAgeCount: rows.filter((offer) => Number(offer?.year || 0) >= currentYear - 6).length,
    olderThan15Count: rows.filter((offer) => Number(offer?.year || 0) < currentYear - 15).length,
    distinctModels: modelCounts.size,
    distinctMakes: new Set(rows.map((offer) => String(offer?.make || "").trim().toLowerCase()).filter(Boolean)).size,
    maxPerExactModel: modelCounts.size ? Math.max(...modelCounts.values()) : 0,
    nonVehicleCount: rows.filter((offer) => nonVehicle.test(`${offer?.make || ""} ${offer?.model || ""} ${offer?.trim || ""} ${offer?.bodyType || ""}`)).length,
    sourceCounts: Object.fromEntries([...new Set(rows.map((offer) => String(offer?.sourceId || "unknown")))].sort().map((sourceId) => [sourceId, rows.filter((offer) => String(offer?.sourceId || "unknown") === sourceId).length])),
  };
  report.markets[market] = stats;
  const min = Number(minimums?.[market] || 0);
  if (min > 0 && stats.count < min) report.failures.push(`${market}:count_below_min:${stats.count}<${min}`);
  if (assertMarkets.has(market) && stats.maxPerExactModel > 20) report.failures.push(`${market}:model_quota:${stats.maxPerExactModel}`);
  if (assertMarkets.has(market) && stats.olderThan15Count > 0) report.failures.push(`${market}:older_than_15:${stats.olderThan15Count}`);
  if (assertMarkets.has(market) && stats.nonVehicleCount > 0) report.failures.push(`${market}:non_vehicle:${stats.nonVehicleCount}`);
}

await (await import("node:fs/promises")).writeFile(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (report.failures.length) process.exitCode = 1;
