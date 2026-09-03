import fs from "node:fs/promises";
import { CarvectorJapanExactAdapter } from "../apps/web/lib/catalog/carvector-current-source";

const output =
  process.env.CARVECTOR_EXACT_READINESS_OUTPUT ||
  "carvector-exact-readiness.json";
const maxPages = Math.max(
  1,
  Math.min(20, Number(process.env.CARVECTOR_EXACT_READINESS_MAX_PAGES || 8)),
);
const minimum = Math.max(
  1,
  Number(process.env.CARVECTOR_EXACT_READINESS_MIN_ROWS || 3),
);

async function main() {
  const source = new CarvectorJapanExactAdapter();
  const offers = [];
  const pages = [];
  let cursor: string | null = "1";

  for (
    let index = 0;
    index < maxPages && cursor && offers.length < minimum;
    index++
  ) {
    const page = await source.fetchPage(cursor);
    const normalized = page.items
      .map((row) => source.normalizeOffer(row))
      .filter(Boolean);
    pages.push({
      cursor,
      seen: page.items.length,
      exact: normalized.length,
      health: page.health,
    });
    offers.push(...normalized);
    cursor = page.finished ? null : String(page.nextCursor || "");
  }

  const report = {
    version: 1,
    mode: "carvector_auction_history_no_write_readiness",
    sourceId: source.sourceId,
    query: process.env.CATALOG_CARVECTOR_QUERY || "",
    pages,
    pagesRead: pages.length,
    seen: pages.reduce((sum, page) => sum + page.seen, 0),
    exactRows: offers.length,
    noPublicGalleryByDesign: true,
    galleryOwnerAfterExactJoin: "jpauc_japan_past_open",
  };
  await fs.writeFile(output, JSON.stringify({ report, offers }, null, 2));
  console.log(
    JSON.stringify(
      {
        ...report,
        sample: offers.slice(0, 5).map((offer) => ({
          id: offer?.sourceOfferId,
          title: offer?.sourceTitle,
          year: offer?.year,
          engineCc: offer?.engineCc,
          powerHp: offer?.powerHp,
          fuel: offer?.fuel,
          price: offer?.sourcePrice,
          auction: offer?.auctionName,
          date: offer?.auctionDate,
          lot: offer?.lotNumber,
          url: offer?.operational?.sourceUrl,
        })),
      },
      null,
      2,
    ),
  );
  if (offers.length < minimum)
    throw new Error(
      `carvector_exact_rows_below_minimum:${offers.length}/${minimum}`,
    );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
