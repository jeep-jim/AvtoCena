import path from "node:path";
import { pathToFileURL } from "node:url";
import { WORKSPACE_ROOT, loadWorkspace, readJson, writeJson } from "./lib.mjs";

const DEFAULT_ASSET_REPORT = path.join(WORKSPACE_ROOT, "reports/brand-logo-assets.json");
const DEFAULT_OUTPUT = path.join(WORKSPACE_ROOT, "ingest/brand-logo-assets-2026-08-17.json");
const SOURCE_ID = "src-drom-brand-logo-archive-2026";
const VERIFIED_AT = "2026-08-17";

function argument(name, fallback) {
  const prefix = `--${name}=`;
  const value = process.argv.find((item) => item.startsWith(prefix));
  return value ? path.resolve(value.slice(prefix.length)) : fallback;
}

function chunks(rows, size) {
  return Array.from({ length: Math.ceil(rows.length / size) }, (_, index) => rows.slice(index * size, (index + 1) * size));
}

export function buildBrandLogoBatch({ workspace, assetReport }) {
  const brandBySlug = new Map(workspace.records.brand.map((brand) => [brand.slug, brand]));
  const media = [];
  const skipped = [];

  for (const asset of assetReport.assets || []) {
    const brand = brandBySlug.get(asset.slug);
    if (!brand) {
      skipped.push({ slug: asset.slug, reason: "no-v2-brand-owner" });
      continue;
    }
    if (!asset.pairComplete || !asset.formatReady || !asset.sourceTraceComplete || !asset.fallbackFree) {
      skipped.push({ slug: asset.slug, reason: "asset-gate-incomplete" });
      continue;
    }
    for (const theme of ["dark", "light"]) {
      const item = asset.themes[theme];
      media.push({
        id: `brand-logo/${brand.id}/${theme}`,
        ownerType: "brand",
        ownerId: brand.id,
        role: "brand_logo",
        sourceId: SOURCE_ID,
        originalUrl: item.source,
        pageUrl: "https://www.drom.ru/catalog/",
        license: "Trademark asset; publication rights review required",
        attribution: `Drom brand-logo archive; ${brand.canonicalName} trademark belongs to its respective owner`,
        identityStatus: "exact_brand",
        theme,
        assetPath: item.assetPath,
        widthPx: item.outputWidthPx,
        heightPx: item.outputHeightPx,
        sha256: item.sha256,
        rightsStatus: "review_required",
        status: "review",
        verifiedAt: VERIFIED_AT,
      });
    }
  }

  media.sort((left, right) => left.id.localeCompare(right.id, "en"));
  const source = {
    id: SOURCE_ID,
    type: "authoritative_catalog",
    title: "Drom brand-logo source archive",
    publisher: "Drom",
    url: "https://www.drom.ru/catalog/",
    documentId: null,
    documentDate: null,
    verifiedAt: VERIFIED_AT,
    market: "Global",
    language: "ru",
    supportedFields: ["brandLogo"],
    confidence: "high",
    status: "active",
    license: null,
    notes: "The supplied 284-file archive is byte-identical to the repository's existing Drom source archive. Only exact brand pairs with complete source trace and no fallback are staged. Trademark/publication rights remain explicitly unresolved.",
  };
  const batches = [
    { schemaVersion: 2, entityType: "source", chunk: 1, maxRecords: 250, records: [source] },
    ...chunks(media, 250).map((records, index) => ({ schemaVersion: 2, entityType: "media", chunk: index + 1, maxRecords: 250, records })),
  ];
  return {
    batch: { schemaVersion: 2, batches },
    summary: {
      v2Brands: workspace.records.brand.length,
      stagedBrandPairs: media.length / 2,
      mediaRecords: media.length,
      skipped,
    },
  };
}

async function main() {
  const assetReportFile = argument("asset-report", DEFAULT_ASSET_REPORT);
  const outputFile = argument("output", DEFAULT_OUTPUT);
  const [workspace, assetReport] = await Promise.all([loadWorkspace(), readJson(assetReportFile)]);
  const result = buildBrandLogoBatch({ workspace, assetReport });
  await writeJson(outputFile, result.batch);
  console.log(JSON.stringify({ output: path.relative(process.cwd(), outputFile), ...result.summary }, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await main();
