const { readChunkedDataJson } = await import("../apps/web/lib/data.ts");
const { replaceChunkedDataJson } = await import("../apps/web/lib/replace-chunked-data.ts");
const { resetVehicleKnowledgeCache } = await import("../apps/web/lib/catalog/vehicle-knowledge.ts");

const MODELS_PATH = "catalog/vehicle-knowledge/models.json";
const CHUNK_SIZE = Math.max(50, Math.min(250, Number(process.env.VEHICLE_KNOWLEDGE_CHUNK_SIZE || 250)));
const MIN_MODEL_YEAR = Math.max(1900, Number(process.env.VEHICLE_KNOWLEDGE_MIN_MODEL_YEAR || 1990));
const MIN_RETAINED_MODELS = Math.max(1, Number(process.env.CATALOG_VEHICLE_KNOWLEDGE_MIN_MODELS || 5_000));
const FETCH_ATTEMPTS = Math.max(1, Math.min(4, Number(process.env.VEHICLE_KNOWLEDGE_FETCH_ATTEMPTS || 2)));

function uniqueUrls(...values) {
  return [...new Set(values.flat().map((value) => String(value || "").trim()).filter(Boolean))];
}

const VEHICLES_CSV_URLS = uniqueUrls(
  process.env.VEHICLE_KNOWLEDGE_MODELS_URL,
  "https://cdn.jsdelivr.net/gh/vehiclesdb/vehiclesdb@latest/vehicles.csv",
  "https://huggingface.co/datasets/vehiclesdb/vehiclesdb/resolve/main/vehicles.csv",
);
const MANIFEST_URLS = uniqueUrls(
  process.env.VEHICLE_KNOWLEDGE_MANIFEST_URL,
  "https://cdn.jsdelivr.net/gh/vehiclesdb/vehiclesdb@latest/manifest.json",
  "https://huggingface.co/datasets/vehiclesdb/vehiclesdb/resolve/main/manifest.json",
);

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function split(value) {
  return [...new Set(clean(value).split(/[|;,]/).map(clean).filter(Boolean))];
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index++;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  const headers = rows.shift()?.map(clean) || [];
  return rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}

function validName(value, minimum = 1) {
  const name = clean(value);
  return name.length >= minimum
    && name.length <= 48
    && /[\p{L}\p{N}]/u.test(name)
    && !/^\[?object object\]?$/i.test(name);
}

function mergeUnique(...lists) {
  return [...new Set(lists.flat().map(clean).filter(Boolean))];
}

function optionalYear(...values) {
  for (const value of values) {
    const parsed = Number(value || 0);
    if (Number.isInteger(parsed) && parsed >= 1886 && parsed <= new Date().getFullYear() + 2) return parsed;
  }
  return undefined;
}

async function fetchText(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.VEHICLE_KNOWLEDGE_FETCH_TIMEOUT_MS || 120_000));
  try {
    const response = await fetch(url, {
      headers: {
        accept: "text/csv,application/json,text/plain,*/*",
        "user-agent": "AvtoCena vehicle knowledge sync/1.0",
      },
      redirect: "follow",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`vehicle_knowledge_fetch_${response.status}_${url}`);
    const body = await response.text();
    if (!body.trim()) throw new Error(`vehicle_knowledge_empty_${url}`);
    return body;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchFirstAvailable(urls, label) {
  const failures = [];
  for (const url of urls) {
    for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt++) {
      try {
        return { url, text: await fetchText(url) };
      } catch (error) {
        failures.push({ url, attempt, error: String(error?.message || error) });
        if (attempt < FETCH_ATTEMPTS) await new Promise((resolve) => setTimeout(resolve, attempt * 1_000));
      }
    }
  }
  const problem = new Error(`vehicle_knowledge_${label}_unavailable`);
  problem.failures = failures;
  throw problem;
}

const current = await readChunkedDataJson(MODELS_PATH, []);
const activeCurrent = current.filter((row) => row?.active !== false && row?.id && row?.make && row?.model);

let manifestResult;
let csvResult;
try {
  [manifestResult, csvResult] = await Promise.all([
    fetchFirstAvailable(MANIFEST_URLS, "manifest"),
    fetchFirstAvailable(VEHICLES_CSV_URLS, "csv"),
  ]);
} catch (error) {
  if (activeCurrent.length >= MIN_RETAINED_MODELS) {
    console.warn(String(error?.message || error));
    console.log(JSON.stringify({
      status: "retained_knowledge_used",
      reason: "upstream_unavailable",
      retainedModels: activeCurrent.length,
      minimumRequired: MIN_RETAINED_MODELS,
      modelsPath: MODELS_PATH,
      failures: Array.isArray(error?.failures) ? error.failures : [],
      checkedAt: new Date().toISOString(),
    }, null, 2));
    process.exit(0);
  }
  throw error;
}

const manifest = JSON.parse(manifestResult.text);
const rows = parseCsv(csvResult.text);
if (!rows.length) {
  if (activeCurrent.length >= MIN_RETAINED_MODELS) {
    console.log(JSON.stringify({
      status: "retained_knowledge_used",
      reason: "upstream_csv_empty",
      retainedModels: activeCurrent.length,
      minimumRequired: MIN_RETAINED_MODELS,
      csvUrl: csvResult.url,
      checkedAt: new Date().toISOString(),
    }, null, 2));
    process.exit(0);
  }
  throw new Error("vehicle_knowledge_csv_parsed_zero");
}

const manual = new Map(current.filter((row) => row?.source !== "vehiclesdb").map((row) => [row.id, row]));
const upstream = new Map();
const updatedAt = new Date().toISOString();
let skippedHistoric = 0;

for (const row of rows) {
  if (clean(row.kind).toLowerCase() !== "car") continue;
  const make = clean(row.make_name);
  const model = clean(row.model_name);
  const makeSlug = clean(row.make_slug).toLowerCase();
  const modelSlug = clean(row.model_slug).toLowerCase();
  const yearFrom = optionalYear(row.year_start, row.year_from, row.first_year);
  const yearTo = optionalYear(row.year_end, row.year_to, row.last_year);
  if (yearTo && yearTo < MIN_MODEL_YEAR) {
    skippedHistoric++;
    continue;
  }
  if (!validName(make, 2) || !validName(model, 1) || !makeSlug || !modelSlug) continue;
  const id = `${makeSlug}/${modelSlug}`;
  const popularity = Number(row.global_popularity_decile || 0);
  upstream.set(id, {
    id,
    make,
    model,
    aliases: split(row.aliases),
    bodyTypes: split(row.body_types),
    countries: split(row.countries),
    regions: split(row.regions),
    ...(yearFrom ? { yearFrom } : {}),
    ...(yearTo ? { yearTo } : {}),
    ...(Number.isFinite(popularity) && popularity >= 1 && popularity <= 10 ? { popularityDecile: popularity } : {}),
    source: "vehiclesdb",
    sourceVersion: clean(manifest.version),
    sourceUrl: "https://github.com/vehiclesdb/vehiclesdb",
    updatedAt,
    active: true,
  });
}

for (const [id, override] of manual) {
  const base = upstream.get(id);
  upstream.set(id, base ? {
    ...base,
    ...override,
    aliases: mergeUnique(base.aliases || [], override.aliases || []),
    makeAliases: mergeUnique(base.makeAliases || [], override.makeAliases || []),
    bodyTypes: mergeUnique(base.bodyTypes || [], override.bodyTypes || []),
    countries: mergeUnique(base.countries || [], override.countries || []),
    regions: mergeUnique(base.regions || [], override.regions || []),
    updatedAt,
  } : { ...override, updatedAt });
}

const recentKnowledgeYear = new Date().getFullYear() - 9;
function recentKnowledgeRank(model) {
  const yearTo = Number(model.yearTo || 0);
  const yearFrom = Number(model.yearFrom || 0);
  if (yearTo >= recentKnowledgeYear || yearFrom >= recentKnowledgeYear) return 0;
  if (!yearTo && !yearFrom) return 1;
  return 2;
}
const models = [...upstream.values()].sort((left, right) =>
  recentKnowledgeRank(left) - recentKnowledgeRank(right)
  || Number(left.popularityDecile || 10) - Number(right.popularityDecile || 10)
  || Number(right.yearTo || right.yearFrom || 0) - Number(left.yearTo || left.yearFrom || 0)
  || left.make.localeCompare(right.make, "en")
  || left.model.localeCompare(right.model, "en"));
const recentModels = models.filter((model) => recentKnowledgeRank(model) === 0).length;
const undatedModels = models.filter((model) => recentKnowledgeRank(model) === 1).length;

if (models.length < MIN_RETAINED_MODELS && activeCurrent.length >= MIN_RETAINED_MODELS) {
  console.log(JSON.stringify({
    status: "retained_knowledge_used",
    reason: "upstream_model_count_below_minimum",
    upstreamModels: models.length,
    retainedModels: activeCurrent.length,
    minimumRequired: MIN_RETAINED_MODELS,
    checkedAt: new Date().toISOString(),
  }, null, 2));
  process.exit(0);
}

await replaceChunkedDataJson(MODELS_PATH, models, CHUNK_SIZE);
resetVehicleKnowledgeCache();

console.log(JSON.stringify({
  status: "updated",
  source: "VehiclesDB",
  sourceVersion: manifest.version,
  manifestUrl: manifestResult.url,
  csvUrl: csvResult.url,
  fetchedRows: rows.length,
  carModels: models.length,
  recentKnowledgeYear,
  recentModels,
  undatedModels,
  olderModels: models.length - recentModels - undatedModels,
  preservedManualRecords: manual.size,
  skippedHistoric,
  minimumModelYear: MIN_MODEL_YEAR,
  chunkSize: CHUNK_SIZE,
  updatedAt,
}, null, 2));
