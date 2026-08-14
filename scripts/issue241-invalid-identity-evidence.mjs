import fs from "node:fs/promises";
const { readMarketOffers } = await import("../apps/web/lib/catalog/storage.ts");
const { hasCredibleCatalogIdentity } = await import("../apps/web/lib/catalog/offer-quality.ts");

const markets = ["china", "europe", "georgia", "kyrgyzstan"];
const report = { checkedAt: new Date().toISOString(), markets: {}, total: 0 };

for (const market of markets) {
  const rows = await readMarketOffers(market);
  const invalid = rows
    .filter((offer) => !hasCredibleCatalogIdentity(offer))
    .map((offer) => {
      const raw = offer?.operational?.raw || {};
      return {
        id: offer?.id,
        sourceId: offer?.sourceId,
        sourceOfferId: offer?.sourceOfferId,
        make: offer?.make,
        model: offer?.model,
        trim: offer?.trim,
        year: offer?.year,
        sourceTitle: offer?.sourceTitle,
        sourceUrl: offer?.sourceUrl,
        bodyType: offer?.bodyType,
        drive: offer?.drive,
        transmission: offer?.transmission,
        fuel: offer?.fuel,
        raw: {
          title: raw?.title,
          name: raw?.name,
          make: raw?.make,
          model: raw?.model,
          url: raw?.url,
          sourceUrl: raw?.sourceUrl,
          href: raw?.href,
          recoveryExactSourceUrl: raw?.recoveryExactSourceUrl,
          recoverySourceUrl: raw?.recoverySourceUrl,
          listingUrl: raw?.listingUrl,
          originalUrl: raw?.originalUrl,
          sourceTitle: raw?.sourceTitle,
        },
      };
    });
  report.markets[market] = { count: rows.length, invalidCount: invalid.length, invalid };
  report.total += invalid.length;
}

await fs.writeFile("issue241-invalid-identity-evidence.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (report.total !== 38) throw new Error(`issue241_invalid_identity_total_changed:${report.total}`);
