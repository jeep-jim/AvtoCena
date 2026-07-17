process.env.CATALOG_ENCAR_DIRECT_PAGE_SIZE ||= "64";
process.env.CATALOG_CHE168_GLOBAL_PAGE_SIZE ||= "64";
process.env.CATALOG_CHE168_GLOBAL_MAX_BRANDS ||= "36";
process.env.CATALOG_MAX_IMAGES_PER_OFFER ||= "10";
process.env.CATALOG_TARGET_PUBLIC_OFFERS ||= "1250";
process.env.CATALOG_TARGET_PER_MARKET ||= "250";
process.env.CATALOG_OFFER_RETENTION_MS ||= String(3 * 24 * 60 * 60 * 1000);
process.env.CATALOG_STALE_GRACE_MS ||= String(3 * 24 * 60 * 60 * 1000);
process.env.CATALOG_IMPORT_BUDGET_MS ||= String(55 * 60 * 1000);
process.env.CATALOG_SOURCE_BUDGET_MS ||= String(6 * 60 * 1000);

const { catalogImportSources } = await import("../apps/web/lib/catalog/importer.ts");
const { jpaucJapanSource } = await import("../apps/web/lib/catalog/jpauc-source.ts");
if (!catalogImportSources.some((source) => source.sourceId === jpaucJapanSource.sourceId)) catalogImportSources.push(jpaucJapanSource);

const priority = [
  "encar_direct",
  "jpauc_japan",
  "tcv_japan_open",
  "japan_partner_open",
  "goonet_japan",
  "sbt_japan",
  "che168_global",
  "che168_clean",
  "autohome_used_china_open",
  "sohu_auto_china_open",
  "dongchedi_china_open",
  "guazi_china_open",
  "sbt_china",
  "dubicars_clean",
  "dubicars_uae",
  "sbt_uae",
  "gaspedaal_nl_open",
  "otomoto_pl_open",
  "standvirtual_pt_open",
  "subito_it_open",
  "marktplaats_nl_open",
  "finn_no_open",
  "blocket_se_open",
  "autoscout_europe_open",
  "autouncle_europe",
  "autoscout_europe",
  "sbt_uk",
];

const rank = new Map(priority.map((sourceId, index) => [sourceId, index]));
catalogImportSources.sort((left, right) => (rank.get(left.sourceId) ?? 100_000) - (rank.get(right.sourceId) ?? 100_000));
process.env.CATALOG_IMPORT_SOURCES = priority.filter((sourceId) => catalogImportSources.some((source) => source.sourceId === sourceId)).join(",");

console.log(`[catalog] production source pool: ${process.env.CATALOG_IMPORT_SOURCES.split(",").length} enabled adapters`);
await import("./catalog-import-sample.mjs");
