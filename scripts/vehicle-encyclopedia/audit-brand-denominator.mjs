import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { WORKSPACE_ROOT, loadWorkspace, normalizeTerm, readJson, writeJson } from "./lib.mjs";

const REPO_ROOT = path.resolve(WORKSPACE_ROOT, "../../..");
const IMPORT_ROOT = path.join(REPO_ROOT, "data/catalog/imports");
const RAW_LOGO_ROOT = path.join(REPO_ROOT, "apps/web/public/brand-logos/drom-source");
const OUTPUT = path.join(WORKSPACE_ROOT, "reports/brand-denominator-candidates.json");
const RAW_SLUG_OVERRIDES = new Map([
  ["astonmartin", "aston-martin"],
  ["i-car", "icar"],
  ["li", "li-auto"],
  ["lynk_and_co", "lynk-and-co"],
]);
const PROBABLE_PARSER_NOISE = new Set(["location", "alle", "de"]);
const NON_VEHICLE_MAKE_TOKENS = new Map([
  ["highly", {
    reason: "official-company-source-identifies-parts-maker-not-vehicle-make",
    evidenceUrl: "https://en.highly.cc/About.html",
  }],
]);

function walkRawMakes(value, rows, file) {
  if (Array.isArray(value)) {
    for (const item of value) walkRawMakes(item, rows, file);
    return;
  }
  if (!value || typeof value !== "object") return;
  if (typeof value.rawMake === "string" && value.rawMake.trim()) {
    rows.push({
      rawMake: value.rawMake.trim(),
      file,
      market: typeof value.market === "string" ? value.market : null,
      source: typeof value.source === "string" ? value.source : typeof value.sourceId === "string" ? value.sourceId : null,
    });
  }
  for (const child of Object.values(value)) walkRawMakes(child, rows, file);
}

function classifyUnresolved(rawMake) {
  const key = normalizeTerm(rawMake);
  if (!key || /^\d+$/.test(key)) return { status: "probable-parser-noise", reason: "empty-or-numeric" };
  if (PROBABLE_PARSER_NOISE.has(key)) return { status: "probable-parser-noise", reason: "generic-non-brand-token" };
  if (NON_VEHICLE_MAKE_TOKENS.has(key)) return { status: "probable-parser-noise", ...NON_VEHICLE_MAKE_TOKENS.get(key) };
  return { status: "identity-review-required", reason: "no-source-backed-v2-brand-or-alias" };
}

async function parserInventory(workspace) {
  const files = (await readdir(IMPORT_ROOT)).filter((file) => file.endsWith(".json")).sort();
  const observations = [];
  const parsedFiles = [];
  for (const file of files) {
    try {
      const value = JSON.parse(await readFile(path.join(IMPORT_ROOT, file), "utf8"));
      const before = observations.length;
      walkRawMakes(value, observations, `data/catalog/imports/${file}`);
      if (observations.length > before) parsedFiles.push(`data/catalog/imports/${file}`);
    } catch {
      // An invalid historic diagnostic stays outside the denominator; the file is not modified.
    }
  }
  const aliases = new Map();
  for (const brand of workspace.records.brand) {
    for (const value of [brand.canonicalName, ...(brand.aliases || []).filter((alias) => alias.safe).map((alias) => alias.value)]) {
      const key = normalizeTerm(value);
      const list = aliases.get(key) || [];
      list.push(brand);
      aliases.set(key, list);
    }
  }
  const groups = new Map();
  for (const observation of observations) {
    const row = groups.get(observation.rawMake) || { rawMake: observation.rawMake, occurrences: 0, files: new Set(), markets: new Set(), sources: new Set() };
    row.occurrences += 1;
    row.files.add(observation.file);
    if (observation.market) row.markets.add(observation.market);
    if (observation.source) row.sources.add(observation.source);
    groups.set(observation.rawMake, row);
  }
  const rows = [...groups.values()].map((row) => {
    const matches = [...new Map((aliases.get(normalizeTerm(row.rawMake)) || []).map((brand) => [brand.id, brand])).values()];
    const resolution = matches.length === 1
      ? { status: "resolved", brandId: matches[0].id, canonicalName: matches[0].canonicalName, reason: "exact-canonical-or-safe-alias" }
      : matches.length > 1
        ? { status: "ambiguous", candidateBrandIds: matches.map((brand) => brand.id), reason: "safe-alias-collision" }
        : classifyUnresolved(row.rawMake);
    return {
      rawMake: row.rawMake,
      occurrences: row.occurrences,
      files: [...row.files].sort(),
      markets: [...row.markets].sort(),
      sources: [...row.sources].sort(),
      resolution,
    };
  }).sort((left, right) => right.occurrences - left.occurrences || left.rawMake.localeCompare(right.rawMake, "en"));
  return {
    parsedFiles,
    totalObservations: observations.length,
    uniqueRawMakes: rows.length,
    resolved: rows.filter((row) => row.resolution.status === "resolved").length,
    ambiguous: rows.filter((row) => row.resolution.status === "ambiguous").length,
    identityReviewRequired: rows.filter((row) => row.resolution.status === "identity-review-required").length,
    probableParserNoise: rows.filter((row) => row.resolution.status === "probable-parser-noise").length,
    rows,
  };
}

async function rawLogoInventory(workspace) {
  const knownSlugs = new Set(workspace.records.brand.map((brand) => brand.slug));
  const files = (await readdir(RAW_LOGO_ROOT)).filter((file) => file.endsWith(".png"));
  const identities = [...new Set(files.map((file) => file.replace(/\.[^.]+\.png$/, "").replace(/-(dark|light)$/, "")))]
    .map((slug) => RAW_SLUG_OVERRIDES.get(slug) || slug)
    .sort();
  return {
    archiveFiles: files.length,
    uniqueLogoIdentities: identities.length,
    matchedV2Brands: identities.filter((slug) => knownSlugs.has(slug)).length,
    identityReviewRequired: identities.filter((slug) => !knownSlugs.has(slug)),
  };
}

async function main() {
  const [workspace, assetReport] = await Promise.all([
    loadWorkspace(),
    readJson(path.join(WORKSPACE_ROOT, "reports/brand-logo-assets.json")),
  ]);
  const [parserMakes, rawLogoArchive] = await Promise.all([parserInventory(workspace), rawLogoInventory(workspace)]);
  const stagedLogoCandidates = assetReport.assets
    .filter((asset) => !workspace.records.brand.some((brand) => brand.slug === asset.slug))
    .map((asset) => asset.slug);
  const candidateSlugs = [...new Set([...rawLogoArchive.identityReviewRequired, ...stagedLogoCandidates])].sort();
  const report = {
    schemaVersion: 1,
    productionConnected: false,
    denominatorState: "expanding",
    currentStagedBrands: workspace.records.brand.length,
    completionClaimAllowed: false,
    parserMakes,
    rawLogoArchive,
    normalizedLogoPairsWithoutV2Brand: stagedLogoCandidates,
    logoIdentityCandidates: {
      uniqueCandidates: candidateSlugs.length,
      slugs: candidateSlugs,
      rule: "A logo filename is discovery evidence only. It cannot create or merge a canonical brand until official identity research confirms it.",
    },
    nextGate: "Import a complete raw-make inventory from every active parser run, source-check unresolved identities, then obtain authentic 90x60 light/dark logo pairs for each accepted brand.",
  };
  await writeJson(OUTPUT, report);
  console.log(JSON.stringify({
    currentStagedBrands: report.currentStagedBrands,
    parserMakes: {
      totalObservations: parserMakes.totalObservations,
      uniqueRawMakes: parserMakes.uniqueRawMakes,
      resolved: parserMakes.resolved,
      identityReviewRequired: parserMakes.identityReviewRequired,
      probableParserNoise: parserMakes.probableParserNoise,
    },
    rawLogoArchive,
    logoIdentityCandidates: report.logoIdentityCandidates.uniqueCandidates,
  }, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await main();
