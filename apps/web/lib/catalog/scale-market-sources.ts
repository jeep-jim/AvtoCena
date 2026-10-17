import { autoPapaGeorgiaSource } from "./autopapa-georgia-source";
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
 *
 * Каждый источник изолирован: временный 403, CAPTCHA или изменение верстки
 * фиксируется probe-отчётом и не останавливает остальные сайты и рынки.
 */
const configs: OpenMarketSourceConfig[] = [
  // Korea: Encar and K Car have dedicated adapters. These public inventories
  // bring the market to five independent sites and remain optional when blocked.
  {
    sourceId: "autowini_korea_open",
    market: "korea",
    label: "Autowini Korea",
    baseUrl: "https://www.autowini.com",
    currency: "USD",
    detailPattern: /\/Cars\/[A-Z0-9_-]+\/cars-detail|\/cars\/[A-Z0-9_-]+\/cars-detail/i,
    listUrls: (page) => [
      pageQuery("https://www.autowini.com/en/cars", page),
      pageQuery("https://www.autowini.com/Cars/list", page),
      pageQuery("https://m.autowini.com/en", page),
    ],
  },
  {
    sourceId: "kbchachacha_korea_open",
    market: "korea",
    label: "KB ChaChaCha Korea",
    baseUrl: "https://www.kbchachacha.com",
    currency: "KRW",
    detailPattern: /\/public\/(?:car|search)\/.*(?:detail|view).*\.kbc|(?:carSeq|vehicleId)=\d+/i,
    listUrls: (page) => [
      pageQuery("https://www.kbchachacha.com/public/search/main.kbc", page),
    ],
  },
  {
    sourceId: "bobaedream_korea_open",
    market: "korea",
    label: "Bobaedream Korea",
    baseUrl: "https://www.bobaedream.co.kr",
    currency: "KRW",
    detailPattern: /\/mycar\/.*(?:view|detail).*\.php|(?:no|carNo|carSeq)=\d+/i,
    listUrls: (page) => [
      pageQuery("https://www.bobaedream.co.kr/mycar/mycar_list.php", page),
      pageQuery("https://m.bobaedream.co.kr/mycar/mlist", page),
    ],
  },

  // UAE: DubiCars, Dubizzle and BE FORWARD are already registered elsewhere.
  {
    sourceId: "yallamotor_uae_open",
    market: "uae",
    label: "YallaMotor UAE",
    baseUrl: "https://uae.yallamotor.com",
    currency: "AED",
    detailPattern: /\/used-cars\/(?!search(?:[/?#]|$)|(?:dubai|abu-dhabi|sharjah|ajman)(?:[/?#]|$))[^?#]{8,}/i,
    listUrls: (page) => [pageQuery("https://uae.yallamotor.com/used-cars", page)],
  },
  {
    sourceId: "carswitch_uae_open",
    market: "uae",
    label: "CarSwitch UAE",
    baseUrl: "https://carswitch.com",
    currency: "AED",
    detailPattern: /\/uae\/(?:used-car|used-cars)\/(?!search(?:[/?#]|$))[^?#]{8,}/i,
    listUrls: (page) => [pageQuery("https://carswitch.com/uae/used-cars/search", page)],
  },
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

  // Georgia is intentionally restricted to the dedicated company anchor adapters:
  // MyAuto and AutoPapa. AUTO.GE, SS.GE and MyMarket are banned.

  // Additional Korea and Japan sources used for deep daily accumulation.
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

export const scaleMarketSources: CatalogSourceAdapter[] = [...configs.map((config) => new OpenMarketAdapter(config)), autoPapaGeorgiaSource];
export const SCALE_MARKET_SOURCE_IDS = scaleMarketSources.map((source) => source.sourceId);
