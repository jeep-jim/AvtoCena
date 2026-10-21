import fs from "node:fs/promises";

const { getJsonStorage, readChunkedDataJson } = await import("../apps/web/lib/data.ts");
const { REQUIRED_CATALOG_SOURCES } = await import("../apps/web/lib/catalog/required-catalog-sources.ts");
const { PUBLIC_CATALOG_MARKETS } = await import("../apps/web/lib/catalog/runtime-config.ts");
const { sanitizeDubizzleStoredRangeMetrics } = await import("../apps/web/lib/catalog/dubizzle-exact-source.ts");
const {
  SPECIFICATION_AUDIT_FIELDS,
  classifySpecificationEvidence,
  isElectrifiedSpecification,
} = await import("../apps/web/lib/catalog/specification-evidence-audit.ts");

const OUTPUT = process.env.CATALOG_SOURCE_SPECIFICATION_AUDIT_OUTPUT || "catalog-source-specification-audit.json";
const SAMPLE_LIMIT = Math.max(5, Math.min(100, Number(process.env.CATALOG_SOURCE_SPECIFICATION_SAMPLE_LIMIT || 20)));
const CANDIDATE_PREFIX = "catalog/source-candidates";

function cleanSourceId(value) {
  return String(value || "").replace(/[^a-z0-9_-]/gi, "-");
}

export function discoverCandidatePoolPaths(objects, market, sourceId) {
  const sourcePrefix = `${CANDIDATE_PREFIX}/${market}/${cleanSourceId(sourceId)}`;
  const keys = objects.map((object) => String(object?.key || ""));
  const indexed = keys
    .filter((key) => key.startsWith(sourcePrefix) && key.endsWith("-index.json"))
    .map((key) => `${key.slice(0, -"-index.json".length)}.json`);
  const bases = keys.filter((key) => key === `${sourcePrefix}.json` || new RegExp(`^${sourcePrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/page-shard-\\d+-of-\\d+\\.json$`).test(key));
  return [...new Set([...indexed, ...bases])].sort();
}

function emptyFieldCounts() {
  return { exact: 0, ambiguous: 0, conflict: 0, missing: 0, not_applicable: 0 };
}

function summarizeRows(rows) {
  const fields = Object.fromEntries(SPECIFICATION_AUDIT_FIELDS.map((field) => [field, {
    counts: emptyFieldCounts(),
    provenance: { source_evidence: 0, knowledge_core: 0, stored_unclassified: 0, none: 0 },
    reasons: {},
    samples: [],
  }]));
  let electrified = 0;
  for (const original of rows) {
    const offer = sanitizeDubizzleStoredRangeMetrics(original);
    if (isElectrifiedSpecification(offer)) electrified++;
    for (const field of SPECIFICATION_AUDIT_FIELDS) {
      const result = classifySpecificationEvidence(offer, field);
      const summary = fields[field];
      summary.counts[result.state]++;
      summary.provenance[result.provenance]++;
      summary.reasons[result.reason] = Number(summary.reasons[result.reason] || 0) + 1;
      if (result.state !== "exact" && result.state !== "not_applicable" && summary.samples.length < SAMPLE_LIMIT) {
        summary.samples.push({
          id: offer?.id || null,
          sourceOfferId: offer?.sourceOfferId || null,
          make: offer?.make || null,
          model: offer?.model || null,
          year: offer?.year || null,
          fuel: offer?.fuel || null,
          powertrainKind: offer?.powertrainKind || null,
          engineCc: offer?.engineCc || null,
          powerHp: offer?.powerHp || null,
          powerKw: offer?.powerKw || null,
          power30MinKw: offer?.power30MinKw || null,
          state: result.state,
          reason: result.reason,
        });
      }
    }
  }
  return { rows: rows.length, electrified, fields };
}

const storage = getJsonStorage();
if (storage.driver !== "object") throw new Error("source_specification_audit_requires_object_storage");
if (!storage.listObjects) throw new Error("source_specification_audit_requires_object_listing");

const objects = await storage.listObjects(CANDIDATE_PREFIX);
const sources = {};
const failures = [];
const zeroRowSources = [];
const totals = {
  requiredMarkets: PUBLIC_CATALOG_MARKETS.length,
  requiredSources: Object.values(REQUIRED_CATALOG_SOURCES).flat().length,
  sourcesWithCandidatePools: 0,
  sourcesWithCandidateRows: 0,
  candidateRows: 0,
  distinctCandidateRows: 0,
  electrifiedRows: 0,
};

for (const market of PUBLIC_CATALOG_MARKETS) {
  for (const source of REQUIRED_CATALOG_SOURCES[market]) {
    const key = `${market}:${source.sourceId}`;
    const poolPaths = discoverCandidatePoolPaths(objects, market, source.sourceId);
    const rowsById = new Map();
    const readErrors = [];
    for (const poolPath of poolPaths) {
      try {
        const rows = await readChunkedDataJson(poolPath, []);
        totals.candidateRows += rows.length;
        for (const row of rows) {
          const id = String(row?.id || `${row?.sourceId || source.sourceId}:${row?.sourceOfferId || rowsById.size}`);
          rowsById.set(id, row);
        }
      } catch (error) {
        readErrors.push({ poolPath, error: String(error?.message || error) });
      }
    }
    const rows = [...rowsById.values()];
    if (poolPaths.length) totals.sourcesWithCandidatePools++;
    if (!poolPaths.length) failures.push(`${key}:candidate_pool_missing`);
    if (readErrors.length) failures.push(`${key}:candidate_pool_read_errors:${readErrors.length}`);
    totals.distinctCandidateRows += rows.length;
    const summary = summarizeRows(rows);
    if (rows.length) totals.sourcesWithCandidateRows++;
    else zeroRowSources.push(key);
    totals.electrifiedRows += summary.electrified;
    sources[key] = {
      market,
      sourceId: source.sourceId,
      label: source.label,
      canonicalUrl: source.canonicalUrl,
      role: source.role,
      candidatePoolPaths: poolPaths,
      candidatePoolObjects: objects.filter((object) => poolPaths.some((path) => String(object.key || "").startsWith(path.replace(/\.json$/, "")))).length,
      readErrors,
      ...summary,
    };
  }
}

const report = {
  version: 1,
  auditedAt: new Date().toISOString(),
  mode: "production_source_candidates_read_only",
  methodology: {
    exact: "Field is present and usable under the current fail-closed runtime contract.",
    ambiguous: "Source/CORE evidence explicitly says ambiguous, or provenance is not exact enough for the field.",
    conflict: "Semantic evidence or runtime sanity checks identify contradictory/unsafe values.",
    missing: "No usable value remains after source-proven range sanitization.",
    certifiedPower: "Evaluated only for EV/hybrid rows; combustion rows are not_applicable.",
    writes: false,
  },
  totals,
  sources,
  structuralGate: {
    allSixMarketsEnumerated: Object.keys(REQUIRED_CATALOG_SOURCES).length === 6,
    allSeventeenSourcesEnumerated: totals.requiredSources === 17,
    everySourceHasCandidatePool: totals.sourcesWithCandidatePools === totals.requiredSources,
    noReadErrors: failures.every((failure) => !failure.includes("read_errors")),
    pass: failures.length === 0,
  },
  coverageGate: {
    everySourceHasCandidateRows: totals.sourcesWithCandidateRows === totals.requiredSources,
    zeroRowSources,
    pass: zeroRowSources.length === 0,
  },
  releaseGate: {
    pass: false,
    reason: "inventory_only_fix_adapters_then_run_six_market_collection_dry_run",
  },
  failures,
};

await fs.writeFile(OUTPUT, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (!report.structuralGate.pass) process.exitCode = 1;
