import type { CatalogMarket } from "./types";

export type CatalogV2SourceSlot = {
  sourceId: string;
  label: string;
  canonicalUrl: string;
  role: "primary" | "secondary" | "auction_history" | "knowledge";
  anchor?: boolean;
};

/**
 * Эталонные площадки задают правильные маршруты, валюту и формат карточек.
 * Дополнительные источники разрешены без верхнего лимита, но не могут
 * подменять данные эталонного объявления или смешивать фотографии.
 */
export const CATALOG_V2_SOURCE_SLOTS: Record<CatalogMarket, readonly CatalogV2SourceSlot[]> = {
  korea: [
    { sourceId: "encar_direct", label: "Encar", canonicalUrl: "https://www.encar.com/", role: "primary", anchor: true },
    { sourceId: "kcar_korea_open", label: "K Car", canonicalUrl: "https://www.kcar.com/", role: "primary", anchor: true },
    { sourceId: "kbchachacha_korea_open", label: "KB ChaChaCha", canonicalUrl: "https://www.kbchachacha.com/", role: "secondary" },
    { sourceId: "bobaedream_korea_open", label: "Bobaedream", canonicalUrl: "https://www.bobaedream.co.kr/", role: "secondary" },
    { sourceId: "autowini_korea_open", label: "Autowini", canonicalUrl: "https://www.autowini.com/", role: "secondary" },
  ],
  china: [
    { sourceId: "autohome_used_china_open", label: "Che168 / Autohome Used", canonicalUrl: "https://www.che168.com/", role: "primary", anchor: true },
    { sourceId: "dongchedi_china_open", label: "Dongchedi", canonicalUrl: "https://www.dongchedi.com/", role: "primary", anchor: true },
    { sourceId: "guazi_china_open", label: "Guazi", canonicalUrl: "https://www.guazi.com/", role: "primary", anchor: true },
    { sourceId: "autohome_new_china_open", label: "Autohome new cars", canonicalUrl: "https://www.autohome.com.cn/", role: "knowledge", anchor: true },
    { sourceId: "taoche_china_open", label: "Taoche", canonicalUrl: "https://www.taoche.com/", role: "secondary" },
    { sourceId: "uxin_china_open", label: "Uxin", canonicalUrl: "https://www.xin.com/", role: "secondary" },
  ],
  japan: [
    { sourceId: "jpauc_japan_current_open", label: "JPAuc current auctions", canonicalUrl: "https://jpauc.com/auction", role: "primary", anchor: true },
    { sourceId: "jpauc_japan_past_open", label: "JPAuc completed auctions", canonicalUrl: "https://jpauc.com/auction/past", role: "auction_history", anchor: true },
    { sourceId: "carvector_japan_stat_open", label: "CarVector auction statistics", canonicalUrl: "https://carvector.com/stat", role: "auction_history", anchor: true },
    { sourceId: "prestige_japan_auctions_open", label: "Prestige Japan auctions", canonicalUrl: "https://prestigemotorsport.com.au/auctions/", role: "auction_history", anchor: true },
    { sourceId: "auctiondatasearch_japan_open", label: "Auction Data Search", canonicalUrl: "https://www.auctiondatasearch.jp/", role: "auction_history", anchor: true },
    { sourceId: "japantransit_japan_stat_open", label: "Japan Transit auction statistics", canonicalUrl: "https://japantransit.ru/stat/", role: "auction_history" },
    { sourceId: "auctions22_japan_upcoming_open", label: "Auctions22 upcoming auctions", canonicalUrl: "https://auctions22.com/upcoming", role: "secondary" },
    { sourceId: "auctions22_japan_past_open", label: "Auctions22 auction results", canonicalUrl: "https://auctions22.com/past", role: "auction_history" },
    { sourceId: "jpcenter_japan_catalog_open", label: "JP Center specifications", canonicalUrl: "https://jp.center/catalog", role: "knowledge", anchor: true },
  ],
  uae: [
    { sourceId: "dubizzle_uae_open", label: "Dubizzle", canonicalUrl: "https://uae.dubizzle.com/", role: "primary", anchor: true },
    { sourceId: "dubicars_uae_exact", label: "DubiCars", canonicalUrl: "https://www.dubicars.com/", role: "primary", anchor: true },
    { sourceId: "carswitch_uae_open", label: "CarSwitch", canonicalUrl: "https://carswitch.com/", role: "secondary" },
    { sourceId: "yallamotor_uae_open", label: "YallaMotor", canonicalUrl: "https://uae.yallamotor.com/", role: "secondary" },
    { sourceId: "beforward_public", label: "BE FORWARD UAE", canonicalUrl: "https://www.beforward.jp/", role: "secondary" },
  ],
  europe: [
    { sourceId: "mobile_de_open", label: "mobile.de", canonicalUrl: "https://www.mobile.de/", role: "primary", anchor: true },
    { sourceId: "autoscout_europe_open", label: "AutoScout24", canonicalUrl: "https://www.autoscout24.com/", role: "primary", anchor: true },
    { sourceId: "otomoto_europe_exact", label: "OTOMOTO", canonicalUrl: "https://www.otomoto.pl/", role: "secondary" },
    { sourceId: "lacentrale_fr_open", label: "La Centrale", canonicalUrl: "https://www.lacentrale.fr/", role: "secondary" },
    { sourceId: "leboncoin_fr_open", label: "Leboncoin", canonicalUrl: "https://www.leboncoin.fr/", role: "secondary" },
  ],
  georgia: [
    { sourceId: "myauto_georgia_list", label: "MyAuto", canonicalUrl: "https://www.myauto.ge/", role: "primary", anchor: true },
    { sourceId: "autopapa_georgia_open", label: "AutoPapa", canonicalUrl: "https://autopapa.ge/", role: "primary", anchor: true },
    { sourceId: "auto_georgia_open", label: "AUTO.GE", canonicalUrl: "https://www.auto.ge/", role: "secondary" },
    { sourceId: "mymarket_georgia_open", label: "MyMarket", canonicalUrl: "https://www.mymarket.ge/", role: "secondary" },
    { sourceId: "ss_georgia_open", label: "SS.GE", canonicalUrl: "https://ss.ge/", role: "secondary" },
  ],
  kyrgyzstan: [
    { sourceId: "mashina_kyrgyzstan_exact", label: "Mashina.kg", canonicalUrl: "https://www.mashina.kg/", role: "primary", anchor: true },
    { sourceId: "bazar_kyrgyzstan_open", label: "Bazar.kg", canonicalUrl: "https://www.bazar.kg/", role: "secondary" },
    { sourceId: "lalafo_kyrgyzstan_open", label: "Lalafo", canonicalUrl: "https://lalafo.kg/", role: "secondary" },
    { sourceId: "turbo_kyrgyzstan_open", label: "Turbo.kg", canonicalUrl: "https://turbo.kg/", role: "secondary" },
    { sourceId: "omarket_kyrgyzstan_open", label: "O!Market", canonicalUrl: "https://market.o.kg/", role: "secondary" },
  ],
};

/** США сохраняем как следующий рынок, но не смешиваем с действующими семью. */
export const CATALOG_FUTURE_USA_ANCHORS = [
  { label: "Stat.vin", canonicalUrl: "https://stat.vin/" },
  { label: "BidCars", canonicalUrl: "https://bid.cars/" },
  { label: "AuctionStat", canonicalUrl: "https://auctionstat.com/" },
] as const;

export const CATALOG_V2_MIN_SOURCE_SLOTS = 5;

export function catalogV2SourceIds(market: CatalogMarket) {
  return CATALOG_V2_SOURCE_SLOTS[market]
    .filter((source) => source.role !== "knowledge")
    .map((source) => source.sourceId);
}

export function catalogV2AnchorSourceIds(market: CatalogMarket) {
  return CATALOG_V2_SOURCE_SLOTS[market]
    .filter((source) => source.anchor && source.role !== "knowledge")
    .map((source) => source.sourceId);
}

export function catalogV2KnowledgeSourceIds(market: CatalogMarket) {
  return CATALOG_V2_SOURCE_SLOTS[market]
    .filter((source) => source.role === "knowledge")
    .map((source) => source.sourceId);
}

export function assertCatalogV2SourceRegistry() {
  const failures = Object.entries(CATALOG_V2_SOURCE_SLOTS)
    .filter(([, sources]) => new Set(sources.filter((source) => source.role !== "knowledge").map((source) => source.sourceId)).size < CATALOG_V2_MIN_SOURCE_SLOTS)
    .map(([market]) => market);
  if (failures.length) throw new Error(`catalog_v2_source_slots_missing:${failures.join(",")}`);
  return true;
}
