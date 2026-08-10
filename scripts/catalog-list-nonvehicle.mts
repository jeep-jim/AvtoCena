import { readMarketOffers } from "../apps/web/lib/catalog/storage.ts";

const market = String(process.env.CATALOG_DIAG_MARKET || "china");
const rows: any[] = await readMarketOffers(market as any);
const nonVehicle = /\b(?:motorcycle|motorbike|scooter|forklift|excavator|bulldozer|tractor|crane|generator|boat|ship|machinery|spare\s+parts?|engine\s+only|truck|dump|tipper|lorry)\b|(?:货车|卡车|客车|巴士|工程机械|商用车)/i;
const hits = rows.filter((offer) => nonVehicle.test(`${offer?.make || ""} ${offer?.model || ""} ${offer?.trim || ""} ${offer?.bodyType || ""}`));
const safe = hits.map((offer) => ({
  id: offer?.id,
  sourceId: offer?.sourceId,
  sourceOfferId: offer?.sourceOfferId,
  make: offer?.make,
  model: offer?.model,
  trim: offer?.trim,
  bodyType: offer?.bodyType,
  sourceUrl: offer?.operational?.sourceUrl,
}));
console.log(JSON.stringify({ market, total: rows.length, count: safe.length, rows: safe }, null, 2));
if (!safe.length) process.exitCode = 2;
