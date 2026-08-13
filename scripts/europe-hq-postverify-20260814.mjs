import crypto from "node:crypto";
import fs from "node:fs";
import { readMarketOffers } from "../apps/web/lib/catalog/storage.ts";
import { PUBLIC_CATALOG_MARKETS } from "../apps/web/lib/catalog/runtime-config.ts";

const input = process.env.EUROPE_HQ_REFRESH_REPORT || "europe-hq-refresh-report.json";
const output = process.env.EUROPE_HQ_POSTVERIFY_REPORT || "europe-hq-postverify-report.json";
const before = JSON.parse(fs.readFileSync(input, "utf8"));
const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
const hash = (rows) => crypto.createHash("sha256").update(JSON.stringify(canonical([...rows].sort((a,b) => String(a.id || a.sourceOfferId || "").localeCompare(String(b.id || b.sourceOfferId || ""))))).digest("hex");
const markets = [...PUBLIC_CATALOG_MARKETS];
const rows = Object.fromEntries(await Promise.all(markets.map(async (market) => [market, await readMarketOffers(market)])));
const nonEurope = Object.fromEntries(markets.filter((market) => market !== "europe").map((market) => {
  const currentHash = hash(rows[market]);
  return [market, { count: rows[market].length, beforeHash: before.baseline?.[market]?.hash, afterHash: currentHash, unchanged: currentHash === before.baseline?.[market]?.hash }];
}));
const changedMarkets = Object.entries(nonEurope).filter(([, value]) => !value.unchanged).map(([market]) => market);
const result = {
  verifiedAt: new Date().toISOString(),
  changedMarkets,
  nonEurope,
  europe: { count: rows.europe.length, expectedCount: before.expectedEuropeCount ?? before.baseline?.europe?.count, countPreserved: rows.europe.length === Number(before.expectedEuropeCount ?? before.baseline?.europe?.count) },
};
fs.writeFileSync(output, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
if (changedMarkets.length || !result.europe.countPreserved) process.exit(2);
