import type { CatalogMarket } from "./types";

export type RequiredCatalogSource = {
  sourceId: string;
  label: string;
  canonicalUrl: string;
  role: "primary" | "auction_history";
  required: true;
  anchor: true;
};

/**
 * Канонический обязательный набор источников каталога AvtoCena.
 *
 * Эти площадки являются несменяемым ядром каждого рынка:
 * - их нельзя заменить дополнительными источниками;
 * - каждый источник проверяется и парсится отдельно;
 * - рынок не считается готовым, пока не подтверждён каждый обязательный источник;
 * - дополнительные площадки разрешены только сверх этого набора.
 */
export const REQUIRED_CATALOG_SOURCES: Record<CatalogMarket, readonly RequiredCatalogSource[]> = {
  uae: [
    { sourceId: "carswitch_uae_open", label: "CarSwitch", canonicalUrl: "https://carswitch.com/", role: "primary", required: true, anchor: true },
    { sourceId: "dubicars_uae_exact", label: "DubiCars", canonicalUrl: "https://www.dubicars.com/", role: "primary", required: true, anchor: true },
  ],
  korea: [
    { sourceId: "encar_direct", label: "Encar", canonicalUrl: "https://www.encar.com/", role: "primary", required: true, anchor: true },
    { sourceId: "kcar_korea_open", label: "K Car", canonicalUrl: "https://www.kcar.com/", role: "primary", required: true, anchor: true },
  ],
  europe: [
    { sourceId: "mobile_de_open", label: "mobile.de", canonicalUrl: "https://www.mobile.de/", role: "primary", required: true, anchor: true },
    { sourceId: "autoscout_europe_open", label: "AutoScout24", canonicalUrl: "https://www.autoscout24.com/", role: "primary", required: true, anchor: true },
  ],
  georgia: [
    { sourceId: "myauto_georgia_list", label: "MyAuto", canonicalUrl: "https://www.myauto.ge/", role: "primary", required: true, anchor: true },
    { sourceId: "autopapa_georgia_open", label: "AutoPapa", canonicalUrl: "https://autopapa.ge/", role: "primary", required: true, anchor: true },
  ],
  china: [
    { sourceId: "autohome_used_china_open", label: "Che168", canonicalUrl: "https://www.che168.com/", role: "primary", required: true, anchor: true },
    { sourceId: "dongchedi_china_open", label: "Dongchedi", canonicalUrl: "https://www.dongchedi.com/", role: "primary", required: true, anchor: true },
    { sourceId: "guazi_china_open", label: "Guazi", canonicalUrl: "https://www.guazi.com/", role: "primary", required: true, anchor: true },
    { sourceId: "autohome_new_china_open", label: "Autohome new cars", canonicalUrl: "https://www.autohome.com.cn/", role: "primary", required: true, anchor: true },
  ],
  japan: [
    { sourceId: "jpauc_japan_past_open", label: "JPAuc completed auctions", canonicalUrl: "https://jpauc.com/auction/past", role: "auction_history", required: true, anchor: true },
    { sourceId: "carvector_japan_stat_open", label: "CarVector auction statistics", canonicalUrl: "https://carvector.com/stat", role: "auction_history", required: true, anchor: true },
    { sourceId: "prestige_japan_auctions_open", label: "Prestige Japan auctions", canonicalUrl: "https://prestigemotorsport.com.au/auctions/", role: "auction_history", required: true, anchor: true },
    { sourceId: "auctiondatasearch_japan_open", label: "Auction Data Search", canonicalUrl: "https://www.auctiondatasearch.jp/", role: "auction_history", required: true, anchor: true },
    { sourceId: "jpcenter_japan_catalog_open", label: "JP Center", canonicalUrl: "https://jp.center/", role: "primary", required: true, anchor: true },
  ],
  kyrgyzstan: [
    { sourceId: "mashina_kyrgyzstan_exact", label: "Mashina.kg", canonicalUrl: "https://www.mashina.kg/", role: "primary", required: true, anchor: true },
  ],
};

export function requiredCatalogSourceIds(market: CatalogMarket) {
  return REQUIRED_CATALOG_SOURCES[market].map((source) => source.sourceId);
}

export function requiredCatalogSourceUrls(market: CatalogMarket) {
  return REQUIRED_CATALOG_SOURCES[market].map((source) => source.canonicalUrl);
}
