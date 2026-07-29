import { OpenMarketAdapter, type OpenMarketSourceConfig } from "./open-market-sources";
import type { CatalogSourceAdapter } from "./types";

function pageQuery(base: string, page: number) {
  const url = new URL(base);
  url.searchParams.set("page", String(page));
  return url.toString();
}

const configs: OpenMarketSourceConfig[] = [
  {
    sourceId: "auto_georgia_open",
    market: "georgia",
    label: "AUTO.GE live homepage",
    baseUrl: "https://www.auto.ge",
    currency: "USD",
    detailPattern: /\/(?:en|ru|ka)\/auto\/[^?#]+-\d+\.html(?:[?#]|$)/i,
    listUrls: (page) => [
      page <= 1 ? "https://www.auto.ge/en/index.html" : `https://www.auto.ge/en/auto/index${page}.html`,
      pageQuery("https://www.auto.ge/en/index.html", page),
      pageQuery("https://www.auto.ge/en/auto/index.html", page),
    ],
  },
  {
    sourceId: "mashina_kyrgyzstan_exact",
    market: "kyrgyzstan",
    label: "Mashina.kg current listings",
    baseUrl: "https://www.mashina.kg",
    currency: "USD",
    detailPattern: /\/(?:en\/)?details\/[^?#]+(?:[?#]|$)/i,
    listUrls: (page) => [
      pageQuery("https://www.mashina.kg/search/all/", page),
      pageQuery("https://www.mashina.kg/en/search/all/", page),
      pageQuery("https://m.mashina.kg/search/all/", page),
    ],
  },
  {
    sourceId: "turbo_kyrgyzstan_open",
    market: "kyrgyzstan",
    label: "Turbo.kg current listings",
    baseUrl: "https://turbo.kg",
    currency: "USD",
    detailPattern: /\/cars\/[A-Za-z0-9_-]+(?:[/?#]|$)/i,
    listUrls: (page) => [pageQuery("https://turbo.kg/", page)],
  },
];

export const regionalLiveOverrides: CatalogSourceAdapter[] = configs.map((config) => new OpenMarketAdapter(config));
