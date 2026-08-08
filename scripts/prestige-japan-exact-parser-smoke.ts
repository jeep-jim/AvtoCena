import fs from "node:fs/promises";
import { parsePrestigeJapanExactDetail } from "../apps/web/lib/catalog/prestige-japan-exact-source";

async function main() {
  const url = "https://prestigemotorsport.com.au/auction-vehicle-display/?car_id=oWw3Q9WWIb1hfR";
  const response = await fetch(url, {
    headers: {
      accept: "text/html,application/xhtml+xml,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9",
      referer: "https://prestigemotorsport.com.au/auctions/",
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(30_000),
  });
  const markup = await response.text();
  if (!response.ok) throw new Error(`prestige_canary_http_${response.status}`);
  const row = parsePrestigeJapanExactDetail(markup, response.url);
  const problems: string[] = [];
  if (!row) problems.push("parser_returned_null");
  if (row && row.carId !== "oWw3Q9WWIb1hfR") problems.push(`car_id_${row.carId}`);
  if (row && row.make !== "TOYOTA") problems.push(`make_${row.make}`);
  if (row && row.model !== "ALPHARD") problems.push(`model_${row.model}`);
  if (row && row.year !== 2017) problems.push(`year_${row.year}`);
  if (row && row.finalPrice !== 1_263_000) problems.push(`final_price_${row.finalPrice}`);
  if (row && row.currentStatus !== "Sold") problems.push(`status_${row.currentStatus}`);
  if (row && row.lotNumber !== "1726") problems.push(`lot_${row.lotNumber}`);
  if (row && row.auctionName !== "ARAI Oyama") problems.push(`auction_${row.auctionName}`);
  if (row && row.auctionGrade !== "3.5") problems.push(`grade_${row.auctionGrade || "missing"}`);
  if (row && row.frameNumber !== "AGH30W") problems.push(`chassis_${row.frameNumber}`);
  if (row && (row.images?.length || 0) < 5) problems.push(`images_${row.images?.length || 0}`);
  if (row && row.images.some((image) => !/^https:\/\/(?:\d+\.)?ajes\.com\/imgs\/[A-Za-z0-9_-]+$/i.test(image))) problems.push("non_exact_image");
  const report = { status: response.status, bytes: markup.length, problems, row };
  await fs.writeFile("prestige-japan-exact-parser-smoke.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: response.status, bytes: markup.length, problems, row: row ? { ...row, images: row.images.slice(0, 12) } : null }, null, 2));
  if (problems.length) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
