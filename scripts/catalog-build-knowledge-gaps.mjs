import fs from "node:fs/promises";
import path from "node:path";

const inputDir = process.env.CATALOG_REBUILD_INPUT_DIR || "catalog-v3-input";
const market = String(process.env.CATALOG_REBUILD_MARKETS || "unknown").trim();
const output = process.env.CATALOG_KNOWLEDGE_GAPS_OUTPUT || `catalog-v3-${market}-knowledge-gaps.json`;

function clean(value) { return String(value || "").replace(/\s+/g, " ").trim(); }
function keyPart(value) { return clean(value).toLocaleLowerCase("en-US"); }
function positive(value) { const n = Number(value); return Number.isFinite(n) && n > 0 ? n : 0; }
function electrified(offer) {
  const text = `${clean(offer?.powertrainKind)} ${clean(offer?.fuel)}`.toLowerCase();
  return /bev|phev|hev|hybrid|electric|erev|series_hybrid|электро|гибрид/.test(text);
}
function requiredMissing(offer) {
  const missing = [];
  if (!clean(offer?.make)) missing.push("make");
  if (!clean(offer?.model)) missing.push("model");
  if (!positive(offer?.year)) missing.push("year");
  if (!clean(offer?.bodyType)) missing.push("bodyType");
  if (!clean(offer?.fuel)) missing.push("fuel");
  if (!clean(offer?.powertrainKind) && !clean(offer?.fuel)) missing.push("powertrainKind");
  if (!electrified(offer) && !positive(offer?.engineCc)) missing.push("engineCc");
  if (!positive(offer?.powerHp) && !positive(offer?.powerKw)) missing.push("power");
  if (!clean(offer?.transmission) && !/bev|electric|электро/.test(`${clean(offer?.powertrainKind)} ${clean(offer?.fuel)}`.toLowerCase())) missing.push("transmission");
  if (!clean(offer?.drive)) missing.push("drive");
  return missing;
}

const names = (await fs.readdir(inputDir)).filter((name) => /^catalog-rebuild-.*-\d+\.json$/.test(name)).sort();
const groups = new Map();
let offers = 0;
let fullyResolved = 0;
let exactCoreVariant = 0;
let coreVariantMissing = 0;
let offersWithRequiredGaps = 0;

for (const name of names) {
  const payload = JSON.parse(await fs.readFile(path.join(inputDir, name), "utf8"));
  for (const offer of Array.isArray(payload?.offers) ? payload.offers : []) {
    offers++;
    const identity = offer?.operational?.encyclopediaIdentity || {};
    const core = offer?.operational?.knowledgeCore || {};
    if (identity.fullyResolved === true) fullyResolved++;
    if (core.variantId) exactCoreVariant++; else coreVariantMissing++;
    const missing = requiredMissing(offer);
    const identityMissing = [];
    if (!identity.canonicalBrandId) identityMissing.push("canonicalBrand");
    if (!identity.canonicalModelId) identityMissing.push("canonicalModel");
    const allMissing = [...new Set([...identityMissing, ...missing])];
    if (!allMissing.length && core.variantId) continue;
    if (allMissing.length) offersWithRequiredGaps++;
    const raw = offer?.operational?.raw || {};
    const sourceMake = clean(raw?.make || raw?.brand || raw?.manufacturer || offer?.make);
    const sourceModel = clean(raw?.model || raw?.modelName || raw?.vehicleModel || offer?.model);
    const sourceId = clean(offer?.sourceId || offer?.operational?.sourceId || raw?.sourceId || "unknown");
    const year = Number(offer?.year || 0) || null;
    const groupKey = [keyPart(sourceId), keyPart(sourceMake), keyPart(sourceModel), year || "unknown"].join("|");
    const current = groups.get(groupKey) || {
      market,
      sourceId,
      rawMake: sourceMake,
      rawModel: sourceModel,
      year,
      count: 0,
      missing: new Set(),
      canonicalMake: clean(offer?.make),
      canonicalModel: clean(offer?.model),
      examples: [],
    };
    current.count++;
    allMissing.forEach((field) => current.missing.add(field));
    if (current.examples.length < 5) current.examples.push(String(offer?.id || ""));
    groups.set(groupKey, current);
  }
}

const gaps = [...groups.values()].map((item) => ({ ...item, missing: [...item.missing].sort() }))
  .sort((left, right) => right.count - left.count || `${left.rawMake} ${left.rawModel}`.localeCompare(`${right.rawMake} ${right.rawModel}`, "en"));
const ratio = (value) => offers ? Number((value / offers).toFixed(4)) : 0;
const report = {
  version: 1,
  generatedAt: new Date().toISOString(),
  market,
  files: names.length,
  offers,
  coverage: {
    identityFullyResolved: fullyResolved,
    identityFullyResolvedRatio: ratio(fullyResolved),
    exactCoreVariant,
    exactCoreVariantRatio: ratio(exactCoreVariant),
    coreVariantMissing,
    offersWithRequiredGaps,
    requiredGapRatio: ratio(offersWithRequiredGaps),
  },
  gapGroups: gaps.length,
  gaps: gaps.slice(0, 5000),
};

await fs.writeFile(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, gaps: report.gaps.slice(0, 25) }, null, 2));
if (process.env.GITHUB_STEP_SUMMARY) {
  await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, `### Knowledge CORE gaps — ${market}\n\n\`\`\`json\n${JSON.stringify({ coverage: report.coverage, gapGroups: report.gapGroups, topGaps: report.gaps.slice(0, 20) }, null, 2)}\n\`\`\`\n`);
}
