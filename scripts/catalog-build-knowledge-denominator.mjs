import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const SNAPSHOT_ROOT = path.resolve(process.env.KNOWLEDGE_SNAPSHOT_ROOT || "data/catalog/knowledge-source-snapshots/generated");
const V2_ROOT = path.resolve(process.env.KNOWLEDGE_V2_ROOT || "data/catalog/vehicle-encyclopedia-v2/chunks");
const OUT_ROOT = path.resolve(process.env.KNOWLEDGE_DENOMINATOR_ROOT || "data/catalog/knowledge-source-snapshots/denominator");
const CHUNK_SIZE = Math.max(50, Math.min(250, Number(process.env.KNOWLEDGE_DENOMINATOR_CHUNK_SIZE || 250)));
const CURRENT_YEAR = new Date().getFullYear();

function clean(value) { return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim(); }
function key(value) { return clean(value).toLocaleLowerCase("en-US").replace(/ё/g, "е").replace(/&/g, "and").replace(/\+/g, "plus").replace(/[^\p{L}\p{N}]+/gu, ""); }
function idPart(value) { return clean(value).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("en-US").replace(/&/g, " and ").replace(/[^a-z0-9\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "unknown"; }
function unique(values) { return [...new Set(values.map(clean).filter(Boolean))]; }
function split(value) { return unique(clean(value).split(/[|;,]/).map(clean)); }
function numberOrNull(value) { const n = Number(String(value ?? "").replace(/,/g, ".")); return Number.isFinite(n) ? n : null; }
function yearOrNull(value) { const n = Number(value || 0); return Number.isInteger(n) && n >= 1886 && n <= CURRENT_YEAR + 2 ? n : null; }
function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex"); }

async function exists(file) { try { await fs.access(file); return true; } catch { return false; } }
async function readJson(file, fallback = null) { try { return JSON.parse(await fs.readFile(file, "utf8")); } catch { return fallback; } }
async function listFiles(root, re) {
  const out = [];
  async function walk(dir) {
    let entries = [];
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (re.test(entry.name)) out.push(full);
    }
  }
  await walk(root);
  return out.sort();
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n") { row.push(field.replace(/\r$/, "")); if (row.some((x) => x !== "")) rows.push(row); row = []; field = ""; }
    else field += ch;
  }
  if (field || row.length) { row.push(field.replace(/\r$/, "")); rows.push(row); }
  const headers = (rows.shift() || []).map(clean);
  return rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}

async function readV2(entityType) {
  const files = await listFiles(V2_ROOT, new RegExp(`^${entityType}s-\\d+\\.json$`));
  const records = [];
  for (const file of files) {
    const payload = await readJson(file, {});
    if (payload?.entityType === entityType && Array.isArray(payload.records)) records.push(...payload.records);
  }
  return records;
}

const v2Brands = await readV2("brand");
const v2Models = await readV2("model");
const brandNameById = new Map(v2Brands.map((brand) => [brand.id, clean(brand.canonicalName)]));
const canonicalBrandByKey = new Map();
for (const brand of v2Brands) {
  const names = [brand.canonicalName, ...(brand.aliases || []).filter((a) => typeof a === "object" && a.safe === true).map((a) => a.value)];
  for (const name of names) {
    const k = key(name);
    if (!k) continue;
    const list = canonicalBrandByKey.get(k) || [];
    list.push(brand);
    canonicalBrandByKey.set(k, list);
  }
}
const canonicalModelsByBrandKey = new Map();
for (const model of v2Models) {
  const make = brandNameById.get(model.brandId);
  if (!make) continue;
  const makeKey = key(make);
  if (!canonicalModelsByBrandKey.has(makeKey)) canonicalModelsByBrandKey.set(makeKey, new Map());
  const map = canonicalModelsByBrandKey.get(makeKey);
  const names = [model.canonicalName, ...(model.aliases || []).filter((a) => typeof a === "object" && a.safe === true).map((a) => a.value), ...(model.sourceNames || []).filter((a) => typeof a === "object" && a.safe === true).map((a) => a.value)];
  for (const name of names) {
    const k = key(name);
    if (!k) continue;
    const list = map.get(k) || [];
    list.push(model);
    map.set(k, list);
  }
}

function uniqueCandidate(list) { return Array.isArray(list) && new Set(list.map((x) => x.id)).size === 1 ? list[0] : null; }
function canonicalResolution(make, model) {
  const brand = uniqueCandidate(canonicalBrandByKey.get(key(make)));
  if (!brand) return { brandId: null, modelId: null, canonicalMake: null, canonicalModel: null };
  const modelMatch = uniqueCandidate(canonicalModelsByBrandKey.get(key(brand.canonicalName))?.get(key(model)));
  return {
    brandId: brand.id,
    modelId: modelMatch?.id || null,
    canonicalMake: brand.canonicalName,
    canonicalModel: modelMatch?.canonicalName || null,
  };
}

const brandMap = new Map();
const modelMap = new Map();
function addBrand({ make, sourceId, aliases = [], markets = [], countries = [] }) {
  make = clean(make);
  if (!make) return;
  const k = key(make);
  if (!k) return;
  const current = brandMap.get(k) || { key: k, observedNames: [], aliases: [], markets: [], countries: [], sources: [], canonical: null };
  current.observedNames = unique([...current.observedNames, make]);
  current.aliases = unique([...current.aliases, ...aliases]);
  current.markets = unique([...current.markets, ...markets]);
  current.countries = unique([...current.countries, ...countries]);
  current.sources = unique([...current.sources, sourceId]);
  const resolution = canonicalResolution(make, "");
  if (resolution.brandId) current.canonical = { brandId: resolution.brandId, canonicalMake: resolution.canonicalMake };
  brandMap.set(k, current);
}
function addModel({ make, model, sourceId, aliases = [], bodyTypes = [], markets = [], countries = [], regions = [], yearFrom = null, yearTo = null }) {
  make = clean(make); model = clean(model);
  if (!make || !model) return;
  addBrand({ make, sourceId, markets, countries });
  const k = `${key(make)}:${key(model)}`;
  if (!key(make) || !key(model)) return;
  const current = modelMap.get(k) || {
    key: k,
    make,
    model,
    aliases: [],
    bodyTypes: [],
    markets: [],
    countries: [],
    regions: [],
    yearFrom: null,
    yearTo: null,
    sources: [],
    canonical: null,
  };
  current.aliases = unique([...current.aliases, ...aliases]);
  current.bodyTypes = unique([...current.bodyTypes, ...bodyTypes]);
  current.markets = unique([...current.markets, ...markets]);
  current.countries = unique([...current.countries, ...countries]);
  current.regions = unique([...current.regions, ...regions]);
  if (yearFrom) current.yearFrom = current.yearFrom ? Math.min(current.yearFrom, yearFrom) : yearFrom;
  if (yearTo) current.yearTo = current.yearTo ? Math.max(current.yearTo, yearTo) : yearTo;
  current.sources = unique([...current.sources, sourceId]);
  const resolution = canonicalResolution(make, model);
  if (resolution.brandId || resolution.modelId) current.canonical = resolution;
  modelMap.set(k, current);
}

// Existing V2 is one input, not a claim of completeness.
for (const brand of v2Brands) {
  addBrand({
    make: brand.canonicalName,
    sourceId: "avtocena-v2",
    aliases: (brand.aliases || []).map((a) => typeof a === "string" ? a : a?.value),
    countries: brand.countries || [],
  });
}
for (const model of v2Models) {
  const make = brandNameById.get(model.brandId);
  if (!make) continue;
  addModel({
    make,
    model: model.canonicalName,
    sourceId: "avtocena-v2",
    aliases: [...(model.aliases || []), ...(model.sourceNames || [])].map((a) => typeof a === "string" ? a : a?.value),
    bodyTypes: model.bodyTypes || [],
    yearFrom: yearOrNull(model.productionFrom),
    yearTo: yearOrNull(model.productionTo),
  });
}

// VehiclesDB open bulk catalog is the broad denominator spine.
const vehiclesCsv = path.join(SNAPSHOT_ROOT, "vehiclesdb", "vehicles.csv");
let vehiclesDbRows = 0;
let vehiclesDbIncluded = 0;
if (await exists(vehiclesCsv)) {
  const rows = parseCsv(await fs.readFile(vehiclesCsv, "utf8"));
  vehiclesDbRows = rows.length;
  for (const row of rows) {
    if (clean(row.kind).toLowerCase() !== "car") continue;
    const yearFrom = yearOrNull(row.year_start || row.year_from || row.first_year);
    const yearTo = yearOrNull(row.year_end || row.year_to || row.last_year);
    // Japan is our broadest window, so source-denominator storage keeps anything
    // that can intersect 2010-present. Market compilers later apply 2020+ outside Japan.
    if (yearTo && yearTo < 2010) continue;
    const make = clean(row.make_name || row.make);
    const model = clean(row.model_name || row.model);
    if (!make || !model) continue;
    addModel({
      make,
      model,
      sourceId: "vehiclesdb-open-catalog",
      aliases: split(row.aliases),
      bodyTypes: split(row.body_types),
      countries: split(row.countries),
      regions: split(row.regions),
      markets: ["global"],
      yearFrom,
      yearTo,
    });
    vehiclesDbIncluded++;
  }
}

// EEA gives market-specific technical tuple evidence. Keep it separate from
// model identity because commercialName is often trim-rich, not a clean model.
const variantEvidence = [];
const eeaFiles = await listFiles(path.join(SNAPSHOT_ROOT, "eea"), /^part-\d+\.json$/);
for (const file of eeaFiles) {
  const payload = await readJson(file, {});
  for (const row of payload?.rows || []) {
    const year = yearOrNull(row.year);
    if (!year || year < 2020) continue;
    const make = clean(row.make);
    const commercialName = clean(row.commercialName);
    if (!make || !commercialName) continue;
    addBrand({ make, sourceId: "eea-co2-passenger-cars", markets: ["europe"] });
    variantEvidence.push({
      evidenceId: `eea:${sha256(JSON.stringify(row)).slice(0, 20)}`,
      sourceId: "eea-co2-passenger-cars",
      market: "europe",
      year,
      make,
      commercialName,
      type: clean(row.type) || null,
      variant: clean(row.variant) || null,
      version: clean(row.version) || null,
      fuel: clean(row.fuel) || null,
      engineCc: numberOrNull(row.engineCc),
      powerKw: numberOrNull(row.powerKw),
      wheelbaseMm: numberOrNull(row.wheelbaseMm),
      massKg: numberOrNull(row.massKg),
      observations: numberOrNull(row.observations),
      canonical: canonicalResolution(make, commercialName),
    });
  }
}

// Snapshot status inventory, so an unavailable authority is visible rather than
// being mistaken for a completed market.
const sourceManifests = [];
for (const source of ["vehiclesdb", "eea", "miit", "mlit", "korea"]) {
  const manifest = await readJson(path.join(SNAPSHOT_ROOT, source, "snapshot-manifest.json"), null);
  sourceManifests.push(manifest ? { source, ...manifest } : { source, status: "missing", errors: [{ error: "snapshot_manifest_missing" }] });
}

await fs.rm(OUT_ROOT, { recursive: true, force: true });
await fs.mkdir(OUT_ROOT, { recursive: true });

async function writeChunked(prefix, entityType, records) {
  const files = [];
  for (let i = 0; i < records.length; i += CHUNK_SIZE) {
    const chunk = Math.floor(i / CHUNK_SIZE) + 1;
    const fileName = `${prefix}-${String(chunk).padStart(4, "0")}.json`;
    const payload = { schemaVersion: 1, entityType, chunk, maxRecords: CHUNK_SIZE, records: records.slice(i, i + CHUNK_SIZE) };
    await fs.writeFile(path.join(OUT_ROOT, fileName), `${JSON.stringify(payload, null, 2)}\n`);
    files.push(fileName);
  }
  return files;
}

const brands = [...brandMap.values()].sort((a, b) => (a.canonical?.canonicalMake || a.observedNames[0]).localeCompare(b.canonical?.canonicalMake || b.observedNames[0], "en"));
const models = [...modelMap.values()].sort((a, b) => `${a.make} ${a.model}`.localeCompare(`${b.make} ${b.model}`, "en"));
variantEvidence.sort((a, b) => `${a.make} ${a.commercialName} ${a.year}`.localeCompare(`${b.make} ${b.commercialName} ${b.year}`, "en"));
const brandFiles = await writeChunked("brands", "source_brand", brands);
const modelFiles = await writeChunked("models", "source_model", models);
const evidenceFiles = await writeChunked("variant-evidence", "source_variant_evidence", variantEvidence);

const modelCanonicalCount = models.filter((row) => row.canonical?.modelId).length;
const brandCanonicalCount = brands.filter((row) => row.canonical?.brandId).length;
const report = {
  schemaVersion: 1,
  builtAt: new Date().toISOString(),
  status: sourceManifests.some((item) => ["failed", "missing"].includes(item.status)) ? "partial" : sourceManifests.some((item) => item.status === "partial") ? "partial" : "complete_snapshot_set",
  contract: {
    japan: "2010-present",
    otherMarkets: "2020-present",
    note: "The denominator is source evidence. It is not equivalent to verified CORE variant coverage.",
  },
  counts: {
    sourceBrands: brands.length,
    sourceModels: models.length,
    sourceVariantEvidence: variantEvidence.length,
    canonicalBrandResolved: brandCanonicalCount,
    canonicalModelResolved: modelCanonicalCount,
    vehiclesDbCsvRows: vehiclesDbRows,
    vehiclesDbCarModelsIntersecting2010Plus: vehiclesDbIncluded,
    existingV2Brands: v2Brands.length,
    existingV2Models: v2Models.length,
  },
  coverage: {
    canonicalBrandRate: brands.length ? Number((brandCanonicalCount / brands.length).toFixed(4)) : 0,
    canonicalModelRate: models.length ? Number((modelCanonicalCount / models.length).toFixed(4)) : 0,
  },
  files: { brands: brandFiles, models: modelFiles, variantEvidence: evidenceFiles },
  sources: sourceManifests.map((item) => ({ source: item.source, status: item.status, fetchedAt: item.fetchedAt || null, counts: item.counts || {}, errors: item.errors || [] })),
};
await fs.writeFile(path.join(OUT_ROOT, "coverage-report.json"), `${JSON.stringify(report, null, 2)}\n`);
await fs.writeFile(path.join(OUT_ROOT, "README.md"), `# Knowledge source denominator\n\nGenerated evidence catalog for AvtoCena Knowledge CORE.\n\n- Japan storage window: 2010-present.\n- Other active markets: 2020-present.\n- Source records are never automatically promoted to verified calculation truth.\n- Ambiguous names remain unresolved.\n- RichSpec/UI is deliberately out of scope until CORE coverage is measured.\n\nSee \`coverage-report.json\` for machine-readable counts and source status.\n`);
console.log(JSON.stringify(report, null, 2));
