import { OpenMarketAdapter, type OpenMarketSourceConfig } from "./open-market-sources";
import type { CatalogSourceAdapter } from "./types";

function pageQuery(base: string, page: number, key = "page") {
  const url = new URL(base);
  url.searchParams.set(key, String(page));
  return url.toString();
}

/**
 * Дополнительные публичные витрины для масштабного каталога.
 * Источники, требующие логин/платную подписку, сюда намеренно не включаются:
 * для них используется partner-feed после официального подключения.
 */
const configs: OpenMarketSourceConfig[] = [
  {
    sourceId: "dubizzle_uae_open",
    market: "uae",
    label: "Dubizzle UAE",
    baseUrl: "https://uae.dubizzle.com",
    currency: "AED",
    detailPattern: /\/motors\/used-cars\/(?!search\/?$|s\/|o\/)[^?#]{12,}/i,
    listUrls: (page) => [
      pageQuery("https://uae.dubizzle.com/motors/used-cars/", page),
      pageQuery("https://uae.dubizzle.com/en/motors/used-cars/", page),
    ],
  },
  {
    sourceId: "kcar_korea_open",
    market: "korea",
    label: "K Car Korea",
    baseUrl: "https://www.kcar.com",
    currency: "KRW",
    detailPattern: /\/bc\/detail\/CarInfoDtl|\/car\/detail|carCd=|carSeq=/i,
    listUrls: (page) => [
      pageQuery("https://www.kcar.com/bc/search", page),
      pageQuery("https://www.kcar.com/bc/search/carSearchList", page),
      pageQuery("https://m.kcar.com/bc/search", page),
    ],
  },
  {
    sourceId: "autopapa_georgia_open",
    market: "georgia",
    label: "AutoPapa Georgia",
    baseUrl: "https://autopapa.ge",
    currency: "USD",
    detailPattern: /\/(?:en\/)?(?:car|vehicle|auto)\/[^?#]*\d+|\/detail\/\d+/i,
    listUrls: (page) => [
      pageQuery("https://autopapa.ge/en/search", page),
      pageQuery("https://autopapa.ge/en/cars", page),
      pageQuery("https://autopapa.ge/search", page),
    ],
  },
  {
    sourceId: "jpauc_japan_past_open",
    market: "japan",
    label: "JPAuc Past Auctions",
    baseUrl: "https://jpauc.com",
    currency: "JPY",
    detailPattern: /\/auction\/past\/(?!listing-?\d+\/?$)[^?#]+|\/auction\/[^?#]*lot[^?#]*/i,
    listUrls: (page) => [
      page <= 1 ? "https://jpauc.com/auction/past" : `https://jpauc.com/auction/past/listing-${page}`,
      pageQuery("https://jpauc.com/auction/past", page),
    ],
  },
  {
    sourceId: "carvector_japan_stat_open",
    market: "japan",
    label: "CarVector Auction Statistics",
    baseUrl: "https://carvector.com",
    currency: "JPY",
    detailPattern: /\/stat\/(?!page(?:[/?#]|$))[^?#]+\/[a-f0-9-]{12,}|\/stat\/[^?#]+\/[^?#]+\/[^?#]+/i,
    listUrls: (page) => [pageQuery("https://carvector.com/stat", page)],
  },
  {
    sourceId: "jpcenter_japan_catalog_open",
    market: "japan",
    label: "JP Center Japan",
    baseUrl: "https://jp.center",
    currency: "JPY",
    detailPattern: /\/catalog\?.*(?:mdl_id|mnf_id|only)=/i,
    listUrls: (page) => [
      pageQuery("https://jp.center/catalog?lang=en", page),
      pageQuery("https://jp.center/catalog", page),
    ],
  },
  {
    sourceId: "prestige_japan_auctions_open",
    market: "japan",
    label: "Prestige Motorsport Japan Auctions",
    baseUrl: "https://prestigemotorsport.com.au",
    currency: "JPY",
    detailPattern: /\/auctions?\/[^?#]+|\/vehicle\/[^?#]+|\/stock\/[^?#]+/i,
    listUrls: (page) => [
      pageQuery("https://prestigemotorsport.com.au/auctions/", page),
      pageQuery("https://prestigemotorsport.com.au/japanese-car-auctions/", page),
    ],
  },
];

export const scaleMarketSources: CatalogSourceAdapter[] = configs.map((config) => new OpenMarketAdapter(config));
export const SCALE_MARKET_SOURCE_IDS = scaleMarketSources.map((source) => source.sourceId);
