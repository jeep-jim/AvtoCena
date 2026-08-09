process.env.CATALOG_RAW_LISTING_MODE ||= "1";
process.env.CATALOG_IMAGE_STORAGE_MODE ||= "source_urls_only";
process.env.CATALOG_ENCAR_DIRECT_LIST_RPM ||= "10";
process.env.CATALOG_ENCAR_DIRECT_LIST_RETRIES ||= "2";
process.env.CATALOG_SOURCE_TIMEOUT_MS ||= "35000";
process.env.CATALOG_SOURCE_REQUEST_TIMEOUT_MS ||= "35000";

const { catalogImportSources } = await import("../apps/web/lib/catalog/importer.ts");
const source = catalogImportSources.find((candidate) => candidate.sourceId === "encar_direct");
if (!source) throw new Error("encar_direct_missing");

let cursor = undefined;
const seen = new Set();
for (let pageIndex = 0; pageIndex < 8; pageIndex += 1) {
  const started = Date.now();
  try {
    const page = await source.fetchPage(cursor);
    const rows = Array.isArray(page?.offers) ? page.offers : [];
    const ids = rows.map((row) => String(row?.sourceOfferId || row?.id || "")).filter(Boolean);
    const duplicateIds = ids.filter((id) => seen.has(id));
    for (const id of ids) seen.add(id);
    console.log(JSON.stringify({
      event: "encar_adapter_page",
      pageIndex,
      cursor: cursor ?? null,
      elapsedMs: Date.now() - started,
      rows: rows.length,
      uniqueIds: new Set(ids).size,
      duplicateIds: duplicateIds.slice(0, 10),
      nextCursor: page?.nextCursor ?? null,
      finished: page?.finished === true,
      sampleIds: ids.slice(0, 3),
    }));
    if (!rows.length || page?.finished === true || page?.nextCursor == null) break;
    cursor = page.nextCursor;
  } catch (error) {
    console.log(JSON.stringify({
      event: "encar_adapter_error",
      pageIndex,
      cursor: cursor ?? null,
      elapsedMs: Date.now() - started,
      name: error?.name || null,
      message: String(error?.message || error),
      cause: String(error?.cause?.message || error?.cause || ""),
      stack: String(error?.stack || "").split("\n").slice(0, 6),
    }));
    process.exit(1);
  }
}
console.log(JSON.stringify({event:"encar_adapter_smoke_complete", totalUniqueIds: seen.size}));
