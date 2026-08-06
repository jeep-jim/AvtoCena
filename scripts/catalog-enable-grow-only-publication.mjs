import fs from "node:fs/promises";

const filename = process.env.CATALOG_MARKET_PUBLISHER_FILE || "scripts/catalog-publish-market.mjs";
const source = await fs.readFile(filename, "utf8");
const unsafeLine = 'process.env.CATALOG_GROW_ONLY_MARKETS = "";';
const guardedLine = "process.env.CATALOG_GROW_ONLY_MARKETS = market;";
const occurrences = source.split(unsafeLine).length - 1;

if (occurrences !== 1) {
  throw new Error(`catalog_grow_only_patch_expected_once_found_${occurrences}`);
}

await fs.writeFile(filename, source.replace(unsafeLine, guardedLine));
console.log(JSON.stringify({ filename, mode: "grow_only", scope: "current_market" }, null, 2));
