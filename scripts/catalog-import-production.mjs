process.env.CATALOG_ENCAR_DIRECT_PAGE_SIZE ||= "48";
process.env.CATALOG_CHE168_GLOBAL_PAGE_SIZE ||= "48";
process.env.CATALOG_CHE168_GLOBAL_MAX_BRANDS ||= "24";
process.env.CATALOG_MAX_IMAGES_PER_OFFER ||= "10";
process.env.CATALOG_TARGET_PUBLIC_OFFERS ||= "1250";
process.env.CATALOG_TARGET_PER_MARKET ||= "250";
process.env.CATALOG_OFFER_RETENTION_MS ||= String(3 * 24 * 60 * 60 * 1000);
process.env.CATALOG_STALE_GRACE_MS ||= String(3 * 24 * 60 * 60 * 1000);
process.env.CATALOG_IMPORT_BUDGET_MS ||= String(42 * 60 * 1000);
process.env.CATALOG_SOURCE_BUDGET_MS ||= String(3 * 60 * 1000);

const { catalogImportSources } = await import("../apps/web/lib/catalog/importer.ts");
const { jpaucJapanSource } = await import("../apps/web/lib/catalog/jpauc-source.ts");

if (!catalogImportSources.some((source) => source.sourceId === jpaucJapanSource.sourceId)) catalogImportSources.push(jpaucJapanSource);

const priority = [
  // Korea: stable public JSON API.
  "encar_direct",

  // Japan: a public auction-lot mirror first, then public export inventories.
  "jpauc_japan",
  "beforward_japan_open",
  "tcv_japan_open",
  "japan_partner_open",
  "carused_japan_open",
  "carfromjapan_open",
  "cardealpage_japan_open",
  "picknbuy24_japan_open",
  "autocom_japan_open",
  "everycar_japan_open",
  "autorec_japan_open",
  "nikkyo_japan_open",
  "providecars_japan_open",
  "dvm_japan_open",
  "jvsglobal_japan_open",
  "buymycar_japan_open",
  "japanese_car_trade_open",
  "royal_trading_japan_open",
  "goonet_japan",
  "sbt_japan",

  // China: public marketplaces and manufacturer/spec portals.
  "che168_global",
  "che168_clean",
  "autocango_china_open",
  "dongchedi_china_open",
  "guazi_china_open",
  "taoche_china_open",
  "uxin_china_open",
  "renrenche_china_open",
  "autohome_used_china_open",
  "autohome_new_china_open",
  "58che_china_open",
  "58market_china_open",
  "ganji_china_open",
  "273_china_open",
  "cn2che_china_open",
  "xcar_china_open",
  "yiche_china_open",
  "cheyipai_china_open",
  "che300_china_open",
  "haoche_china_open",
  "iautos_china_open",
  "sohu_auto_china_open",
  "sbt_china",

  // UAE.
  "dubicars_clean",
  "dubicars_uae",
  "sbt_uae",

  // Europe: broad public listing sources, stopping once the market target is reached.
  "autoscout_europe_open",
  "mobile_de_open",
  "otomoto_pl_open",
  "lacentrale_fr_open",
  "leboncoin_fr_open",
  "subito_it_open",
  "coches_es_open",
  "standvirtual_pt_open",
  "marktplaats_nl_open",
  "gaspedaal_nl_open",
  "bilbasen_dk_open",
  "finn_no_open",
  "blocket_se_open",
  "bytbil_se_open",
  "willhaben_at_open",
  "cargr_open",
  "autotrader_uk_open",
  "motors_uk_open",
  "hasznaltauto_hu_open",
  "tipcars_cz_open",
  "bazos_cz_open",
  "autouncle_europe",
  "autoscout_europe",
  "sbt_uk",
];

const rank = new Map(priority.map((sourceId, index) => [sourceId, index]));
catalogImportSources.sort((left, right) => (rank.get(left.sourceId) ?? 100_000) - (rank.get(right.sourceId) ?? 100_000));
process.env.CATALOG_IMPORT_SOURCES = priority.filter((sourceId) => catalogImportSources.some((source) => source.sourceId === sourceId)).join(",");

console.log(`[catalog] production source pool: ${process.env.CATALOG_IMPORT_SOURCES.split(",").length} enabled adapters`);
await import("./catalog-import-sample.mjs");
