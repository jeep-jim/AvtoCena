import { OpenMarketAdapter } from "./open-market-sources";

export const carvectorJapanCurrentSource = new OpenMarketAdapter({
  sourceId: "carvector_japan_stat_open",
  market: "japan",
  label: "CarVector Auction Statistics",
  baseUrl: "https://carvector.com",
  currency: "JPY",
  detailPattern: /\/stat\/(?!page(?:[/?#]|$))[^?#]+\/[a-f0-9-]{12,}|\/stat\/[^?#]+\/[^?#]+\/[^?#]+/i,
  listUrls: (page) => [
    `https://carvector.com/stat/toyota/hilux-surf?page=${Math.max(1, Number(page) || 1)}`,
  ],
});
