import type { CatalogMarket } from "./types";

export type CatalogV2SourceSlot = {
  sourceId: string;
  label: string;
  role: "primary" | "secondary" | "auction_history";
};

export const CATALOG_V2_SOURCE_SLOTS: Record<CatalogMarket, readonly CatalogV2SourceSlot[]> = {
  korea: [
    { sourceId: "encar_direct", label: "Encar", role: "primary" },
    { sourceId: "kcar_korea_open", label: "K Car", role: "primary" },
    { sourceId: "kbchachacha_korea_open", label: "KB ChaChaCha", role: "secondary" },
    { sourceId: "bobaedream_korea_open", label: "Bobaedream", role: "secondary" },
    { sourceId: "autowini_korea_open", label: "Autowini", role: "secondary" },
  ],
  china: [
    { sourceId: "autohome_used_china_open", label: "Che168 / Autohome Export", role: "primary" },
    { sourceId: "che168_global", label: "Che168 Global", role: "primary" },
    { sourceId: "guazi_china_open", label: "Guazi", role: "secondary" },
    { sourceId: "uxin_china_open", label: "Uxin", role: "secondary" },
    { sourceId: "dongchedi_china_open", label: "Dongchedi", role: "secondary" },
  ],
  japan: [
    { sourceId: "goonet_japan_exact", label: "Goonet", role: "primary" },
    { sourceId: "tcv_japan_open", label: "TCV", role: "primary" },
    { sourceId: "beforward_japan_public", label: "BE FORWARD", role: "secondary" },
    { sourceId: "carused_japan_open", label: "Carused", role: "secondary" },
    { sourceId: "jpauc_japan_past_open", label: "JPAuc completed lots", role: "auction_history" },
    { sourceId: "carvector_japan_stat_open", label: "CarVector auction statistics", role: "auction_history" },
  ],
  uae: [
    { sourceId: "dubicars_uae_exact", label: "DubiCars", role: "primary" },
    { sourceId: "dubizzle_uae_open", label: "Dubizzle", role: "primary" },
    { sourceId: "carswitch_uae_open", label: "CarSwitch", role: "secondary" },
    { sourceId: "yallamotor_uae_open", label: "YallaMotor", role: "secondary" },
    { sourceId: "beforward_uae_public", label: "BE FORWARD UAE", role: "secondary" },
  ],
  europe: [
    { sourceId: "mobile_europe_exact", label: "mobile.de", role: "primary" },
    { sourceId: "autoscout24_europe_open", label: "AutoScout24", role: "primary" },
    { sourceId: "otomoto_europe_exact", label: "OTOMOTO", role: "primary" },
    { sourceId: "autotrader_uk_open", label: "AutoTrader UK", role: "secondary" },
    { sourceId: "standvirtual_pt_open", label: "Standvirtual", role: "secondary" },
  ],
  georgia: [
    { sourceId: "myauto_georgia_exact", label: "MyAuto", role: "primary" },
    { sourceId: "auto_georgia_open", label: "AUTO.GE", role: "primary" },
    { sourceId: "autopapa_georgia_open", label: "AutoPapa", role: "secondary" },
    { sourceId: "mymarket_georgia_open", label: "MyMarket", role: "secondary" },
    { sourceId: "ss_georgia_open", label: "SS.GE", role: "secondary" },
  ],
  kyrgyzstan: [
    { sourceId: "mashina_kyrgyzstan_exact", label: "Mashina.kg", role: "primary" },
    { sourceId: "bazar_kyrgyzstan_open", label: "Bazar.kg", role: "primary" },
    { sourceId: "lalafo_kyrgyzstan_open", label: "Lalafo", role: "secondary" },
    { sourceId: "turbo_kyrgyzstan_open", label: "Turbo.kg", role: "secondary" },
    { sourceId: "omarket_kyrgyzstan_open", label: "O!Market", role: "secondary" },
  ],
};

export const CATALOG_V2_MIN_SOURCE_SLOTS = 5;

export function catalogV2SourceIds(market: CatalogMarket) {
  return CATALOG_V2_SOURCE_SLOTS[market].map((source) => source.sourceId);
}

export function assertCatalogV2SourceRegistry() {
  const failures = Object.entries(CATALOG_V2_SOURCE_SLOTS)
    .filter(([, sources]) => new Set(sources.map((source) => source.sourceId)).size < CATALOG_V2_MIN_SOURCE_SLOTS)
    .map(([market]) => market);
  if (failures.length) throw new Error(`catalog_v2_source_slots_missing:${failures.join(",")}`);
  return true;
}
