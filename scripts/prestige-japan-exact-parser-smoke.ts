import fs from "node:fs/promises";
import { prestigeJapanExactSource, type PrestigeJapanExactRow } from "../apps/web/lib/catalog/prestige-japan-exact-source";

async function main() {
  // A fixed sold listing eventually disappears from Prestige and turns a healthy
  // parser red. Discover a current sold lot through the production adapter, then
  // enforce the exact-detail contract on that listing instead.
  const page = await prestigeJapanExactSource.fetchPage(null);
  const row = page.items[0] as PrestigeJapanExactRow | undefined;
  const problems: string[] = [];
  if (!row) problems.push("no_current_exact_sold_listing");
  if (row && !/^[A-Za-z0-9_-]+$/.test(row.carId)) problems.push(`car_id_${row.carId}`);
  if (row && row.sourceUrl !== `https://prestigemotorsport.com.au/auction-vehicle-display/?car_id=${row.carId}`) problems.push("detail_identity_mismatch");
  if (row && (!row.make || !row.model)) problems.push("identity_missing");
  if (row && (row.year < 2010 || row.year > new Date().getUTCFullYear() + 1)) problems.push(`year_${row.year}`);
  if (row && !(row.finalPrice > 0)) problems.push(`final_price_${row.finalPrice}`);
  if (row && row.currentStatus !== "Sold") problems.push(`status_${row.currentStatus}`);
  if (row && !row.lotNumber) problems.push("lot_missing");
  if (row && !row.auctionName) problems.push("auction_missing");
  if (row && !row.frameNumber) problems.push("chassis_missing");
  if (row && (row.images?.length || 0) < 5) problems.push(`images_${row.images?.length || 0}`);
  if (row && row.images.some((image) => !/^https:\/\/(?:\d+\.)?ajes\.com\/imgs\/[A-Za-z0-9_-]+$/i.test(image))) problems.push("non_exact_image");
  if (row && row.coverContentVerified !== true) problems.push("cover_not_verified");
  const report = { health: page.health, count: page.count, nextCursor: page.nextCursor, problems, row };
  await fs.writeFile("prestige-japan-exact-parser-smoke.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ health: page.health, count: page.count, nextCursor: page.nextCursor, problems, row: row ? { ...row, images: row.images.slice(0, 12) } : null }, null, 2));
  if (problems.length) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
