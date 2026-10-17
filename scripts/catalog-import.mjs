await import("../apps/web/lib/catalog/encar-resilience.ts");
const { importCatalog } = await import("../apps/web/lib/catalog/importer.ts");
const sources = process.argv.slice(2).filter(Boolean);
importCatalog(sources.length ? sources : undefined).then((report) => { console.log(JSON.stringify(report, null, 2)); }).catch((error) => { console.error(error); process.exit(1); });
