process.env.CATALOG_ENCAR_DIRECT_PAGE_SIZE ||= "64";
process.env.CATALOG_CHE168_GLOBAL_PAGE_SIZE ||= "64";
process.env.CATALOG_CHE168_GLOBAL_MAX_BRANDS ||= "48";
process.env.CATALOG_MAX_IMAGES_PER_OFFER ||= "80";
process.env.CATALOG_TARGET_PUBLIC_OFFERS ||= "1250";
process.env.CATALOG_TARGET_PER_MARKET ||= "250";
process.env.CATALOG_OFFER_RETENTION_MS ||= String(45 * 24 * 60 * 60 * 1000);
process.env.CATALOG_STALE_GRACE_MS ||= String(45 * 24 * 60 * 60 * 1000);
process.env.CATALOG_IMPORT_BUDGET_MS ||= String(5 * 60 * 60 * 1000);
process.env.CATALOG_SOURCE_BUDGET_MS ||= String(50 * 60 * 1000);
process.env.CATALOG_RESTART_UNDERFILLED_SCANS ||= "true";
process.env.CATALOG_PRESERVE_PREVIOUS_ON_FAILURE ||= "true";

await import("./catalog-import-sample.mjs");
