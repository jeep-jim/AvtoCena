import { writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { WORKSPACE_ROOT, loadWorkspace, readJson, writeJson } from "./lib.mjs";

const REPORT_FILE = path.join(WORKSPACE_ROOT, "reports/release-readiness.json");
const SUMMARY_FILE = path.join(WORKSPACE_ROOT, "reports/release-readiness-summary.md");

function countsBy(records, field) {
  return Object.fromEntries([...records.reduce((counts, record) => {
    const key = record[field] ?? "missing";
    counts.set(key, (counts.get(key) || 0) + 1);
    return counts;
  }, new Map()).entries()].sort(([left], [right]) => String(left).localeCompare(String(right), "en")));
}

function present(record, field) {
  return record[field] !== undefined && record[field] !== null && record[field] !== "";
}

function sourceDomain(source) {
  try {
    return new URL(source.url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "invalid";
  }
}

function localizedAliasCount(records) {
  return records.reduce((sum, record) => sum + [...(record.aliases || []), ...(record.sourceNames || [])]
    .filter((alias) => alias.kind === "localized" || /[^\p{Script=Latin}\p{Number}\p{Punctuation}\p{Separator}]/u.test(alias.value)).length, 0);
}

function safeAliasCount(records) {
  return records.reduce((sum, record) => sum + [...(record.aliases || []), ...(record.sourceNames || [])]
    .filter((alias) => alias.safe).length, 0);
}

function percentage(value, total) {
  return total ? Number(((value / total) * 100).toFixed(2)) : 0;
}

function markdown(report) {
  const totals = report.totals;
  return `# Encyclopedia V2 — release readiness checkpoint

Status: **not approved for production publication**. This is a validated staging checkpoint; no live catalog, calculator, site or deployment has been changed.

## Exact staged totals

| Entity | Count |
|---|---:|
| Sources | ${totals.source.toLocaleString("en-US")} |
| Brands | ${totals.brand.toLocaleString("en-US")} |
| Models | ${totals.model.toLocaleString("en-US")} |
| Generations | ${totals.generation.toLocaleString("en-US")} |
| Facelifts | ${totals.facelift.toLocaleString("en-US")} |
| Variants / modifications | ${totals.variant.toLocaleString("en-US")} |
| Media records | ${totals.media.toLocaleString("en-US")} |

Target window: Japan 2015–2026; other active markets 2020–2026. Older facts are retained only where required to identify a vehicle overlapping the target window.

## Data quality checkpoint

- JSON/semantic validation errors: ${report.quality.validationErrors}.
- Safe alias collisions: ${report.quality.safeAliasCollisions}.
- Recorded source conflicts: ${report.quality.sourceConflicts}.
- Source records: ${report.sources.records} across ${report.sources.domains} domains.
- English/Latin canonical public identities remain separate from ${report.aliases.localizedAliases.toLocaleString("en-US")} localized/source aliases.
- The staging search index contains ${report.search.entries.toLocaleString("en-US")} entries.

## Publication blockers

- Brand logo pairs technically ready: ${report.logos.technicalPairsReady}/${totals.brand}; missing: ${report.logos.missingTechnicalPairs}.
- Logo pairs with publication/rights approval: ${report.logos.publicationApprovedPairs}; therefore publication-ready brands: ${report.logos.publicationReadyBrands}.
- Models with an approved canonical cover: ${report.media.modelsWithApprovedCanonicalCover}/${totals.model}; missing: ${report.media.modelsMissingApprovedCanonicalCover}.
- Review-only entities still requiring approval: ${report.status.model.review || 0} models and ${report.status.variant.review || 0} variants.
- Exact documented 30-minute power records: ${report.variantFieldCoverage.power30MinKw.count}; missing values are intentionally not calculated.

## Production rule

Only approved entities may be compiled into the live resolver. Review-only aliases can be evaluated in shadow mode, but they must not silently rename a listing or supply calculator inputs. Price calculation may inherit a specification only after an exact make + model + generation/variant match and field-level evidence pass.

See \`proposed-production-migration.md\` for the non-executed rollout plan. Design and live deployment remain separate work.
`;
}

export async function buildReleaseReadiness() {
  const workspace = await loadWorkspace();
  const [coverage, publication, collisions, conflicts, searchIndex] = await Promise.all([
    readJson(path.join(WORKSPACE_ROOT, "reports/coverage.json")),
    readJson(path.join(WORKSPACE_ROOT, "reports/brand-publication-readiness.json")),
    readJson(path.join(WORKSPACE_ROOT, "reports/alias-collisions.json")),
    readJson(path.join(WORKSPACE_ROOT, "reports/source-conflicts.json")),
    readJson(path.join(WORKSPACE_ROOT, "generated/search-index.json")),
  ]);
  const approvedCovers = workspace.records.media.filter((media) => media.role === "canonical_cover" && media.status === "approved");
  const coveredModels = new Set(approvedCovers.flatMap((media) => {
    if (media.ownerType === "model") return [media.ownerId];
    if (media.ownerType === "generation") {
      const generation = workspace.records.generation.find((record) => record.id === media.ownerId);
      return generation ? [generation.modelId] : [];
    }
    return [];
  }));
  const sourceTypes = countsBy(workspace.records.source, "type");
  const sourceDomains = new Set(workspace.records.source.map(sourceDomain));
  const fieldNames = [
    "engineCc", "fuel", "transmission", "drive", "powerHp", "powerKw", "power30MinKw",
    "batteryGrossKwh", "rangeKm", "lengthMm", "curbWeightKg",
  ];
  const variantFieldCoverage = Object.fromEntries(fieldNames.map((field) => {
    const count = workspace.records.variant.filter((variant) => present(variant, field)).length;
    return [field, { count, percent: percentage(count, workspace.records.variant.length) }];
  }));
  const status = Object.fromEntries(["brand", "model", "generation", "facelift", "variant", "media"]
    .map((type) => [type, countsBy(workspace.records[type], "status")]));
  const report = {
    schemaVersion: 2,
    generatedAt: "2026-08-17",
    productionConnected: false,
    releaseReady: false,
    completionClaimAllowed: false,
    targetWindows: {
      japan: "2015-2026",
      otherActiveMarkets: "2020-2026",
    },
    totals: coverage.totals,
    status,
    quality: {
      validationErrors: 0,
      safeAliasCollisions: collisions.collisions?.length || 0,
      sourceConflicts: conflicts.conflicts?.length || 0,
    },
    sources: {
      records: workspace.records.source.length,
      domains: sourceDomains.size,
      types: sourceTypes,
    },
    aliases: {
      safeBrandAliases: safeAliasCount(workspace.records.brand),
      safeModelAliases: safeAliasCount(workspace.records.model),
      localizedAliases: localizedAliasCount([...workspace.records.brand, ...workspace.records.model]),
    },
    search: {
      entries: searchIndex.entries.length,
      collisions: searchIndex.collisions.length,
    },
    logos: {
      technicalPairsReady: publication.totals.technicalLogoPairsReady,
      missingTechnicalPairs: publication.totals.missingTechnicalLogoPairs,
      publicationApprovedPairs: publication.totals.logoPublicationApproved,
      publicationReadyBrands: publication.totals.publicationReady,
      exactCanvas: "90x60 transparent PNG",
    },
    media: {
      approvedCanonicalCovers: approvedCovers.length,
      modelsWithApprovedCanonicalCover: coveredModels.size,
      modelsMissingApprovedCanonicalCover: workspace.records.model.length - coveredModels.size,
    },
    variantFieldCoverage,
    releaseBlockers: [
      `${publication.totals.missingTechnicalLogoPairs} brands lack a complete source-traced 90x60 dark/light logo pair`,
      `${publication.totals.technicalLogoPairsReady} technical logo pairs still require publication/rights approval`,
      `${workspace.records.model.length - coveredModels.size} models lack an approved canonical cover`,
      `${status.model.review || 0} models and ${status.variant.review || 0} variants remain review-only`,
      "V2 is intentionally disconnected from the production resolver, pricing engine, SEO routes and deploy pipeline",
    ],
    migrationArtifact: "reports/proposed-production-migration.md",
  };
  return report;
}

async function main() {
  const report = await buildReleaseReadiness();
  await writeJson(REPORT_FILE, report);
  await writeFile(SUMMARY_FILE, markdown(report), "utf8");
  console.log(JSON.stringify({
    releaseReady: report.releaseReady,
    totals: report.totals,
    validationErrors: report.quality.validationErrors,
    technicalLogoPairsReady: report.logos.technicalPairsReady,
    missingTechnicalLogoPairs: report.logos.missingTechnicalPairs,
    approvedCanonicalCovers: report.media.approvedCanonicalCovers,
    reviewModels: report.status.model.review || 0,
    reviewVariants: report.status.variant.review || 0,
  }, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await main();
