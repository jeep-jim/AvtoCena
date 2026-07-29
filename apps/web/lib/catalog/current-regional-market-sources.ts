import { MashinaKyrgyzstanAdapter } from "./regional-market-sources";
import type { CatalogSourceAdapter } from "./types";

function pageQuery(base: string, page: number) {
  const url = new URL(base);
  url.searchParams.set("page", String(page));
  return url.toString();
}

/**
 * Mashina.kg moved the public inventory from /search/all/ to /search/.
 * Keep the exact detail parser, but probe the current desktop, Russian and
 * mobile routes so one redirect or locale outage does not collapse Kyrgyzstan.
 */
class CurrentMashinaKyrgyzstanAdapter extends MashinaKyrgyzstanAdapter {
  listUrls(page: number) {
    return [
      pageQuery("https://www.mashina.kg/en/search/", page),
      pageQuery("https://www.mashina.kg/search/", page),
      pageQuery("https://m.mashina.kg/search/en/", page),
      pageQuery("https://m.mashina.kg/search/", page),
    ];
  }
}

export const currentRegionalMarketSources: CatalogSourceAdapter[] = [
  new CurrentMashinaKyrgyzstanAdapter(),
];
