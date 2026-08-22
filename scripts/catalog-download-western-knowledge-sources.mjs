import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const ROOT = path.resolve(process.env.KNOWLEDGE_OUTPUT_ROOT || "data/catalog/knowledge-source-snapshots/generated");
const MAX_BYTES = Math.max(5_000_000, Math.min(100_000_000, Number(process.env.KNOWLEDGE_WEST_MAX_BYTES || 60_000_000)));
const TIMEOUT_MS = Math.max(10_000, Math.min(180_000, Number(process.env.KNOWLEDGE_WEST_TIMEOUT_MS || 90_000)));
const NHTSA_DELAY_MS = Math.max(75, Math.min(1_000, Number(process.env.KNOWLEDGE_NHTSA_DELAY_MS || 125)));
const NHTSA_MAKE_CAP = Math.max(25, Math.min(300, Number(process.env.KNOWLEDGE_NHTSA_MAKE_CAP || 200)));
const USER_AGENT = "AvtoCena-KnowledgeCORE/1.0 (+https://avtocena.com; public government data snapshot)";
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const clean = (value) => String(value ?? "").replace(/^\uFEFF/, "").normalize("NFKC").replace(/\s+/g, " ").trim();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function ensureDir(dir) { await fs.mkdir(dir, { recursive: true }); }
async function fetchBuffer(url, accept = "*/*") {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { redirect: "follow", signal: controller.signal, headers: { accept, "user-agent": USER_AGENT } });
    if (!response.ok) throw new Error(`http_${response.status}:${url}`);
    const length = Number(response.headers.get("content-length") || 0);
    if (length > MAX_BYTES) throw new Error(`too_large:${length}:${url}`);
    const data = Buffer.from(await response.arrayBuffer());
    if (data.length > MAX_BYTES) throw new Error(`too_large:${data.length}:${url}`);
    return { data, contentType: response.headers.get("content-type") || "", finalUrl: response.url || url };
  } finally { clearTimeout(timer); }
}
async function write(root, relative, data) {
  const file = path.join(root, relative);
  await ensureDir(path.dirname(file));
  await fs.writeFile(file, data);
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(String(data));
  return { file: relative.replaceAll(path.sep, "/"), bytes: buffer.length, sha256: sha256(buffer) };
}
async function writeJson(root, relative, value) { return write(root, relative, `${JSON.stringify(value, null, 2)}\n`); }
function csvRowCount(text) { return Math.max(0, String(text).split(/\r?\n/).filter(Boolean).length - 1); }
function parseCsv(text) {
  const rows = []; let row = []; let field = ""; let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ""; }
    else if (ch === '\n') { row.push(field.replace(/\r$/, "")); if (row.some((v) => v !== "")) rows.push(row); row = []; field = ""; }
    else field += ch;
  }
  if (field || row.length) { row.push(field.replace(/\r$/, "")); rows.push(row); }
  const headers = (rows.shift() || []).map((h) => clean(h));
  return rows.map((values) => Object.fromEntries(headers.map((h, i) => [h, values[i] ?? ""])));
}
function currentUsMakes(csvText) {
  const makes = new Set();
  for (const row of parseCsv(csvText)) {
    const year = Number(row.year || row.Year || 0);
    const make = clean(row.make || row.Make);
    if (year >= 2020 && make) makes.add(make);
  }
  return [...makes].sort((a, b) => a.localeCompare(b, "en")).slice(0, NHTSA_MAKE_CAP);
}

async function snapshotUs() {
  const root = path.join(ROOT, "us");
  await fs.rm(root, { recursive: true, force: true }); await ensureDir(root);
  const manifest = { schemaVersion: 1, id: "us-government-vehicle-data", authority: "us_government_vehicle_specifications", fetchedAt: new Date().toISOString(), status: "complete", files: [], counts: {}, errors: [], notes: [] };

  let fuelCsv = "";
  const fuelUrl = "https://www.fueleconomy.gov/feg/epadata/vehicles.csv";
  try {
    const result = await fetchBuffer(fuelUrl, "text/csv,*/*");
    fuelCsv = result.data.toString("utf8");
    manifest.files.push({ ...(await write(root, "fueleconomy-vehicles.csv", result.data)), sourceUrl: fuelUrl, contentType: result.contentType });
    manifest.counts.fuelEconomyRows = csvRowCount(fuelCsv);
  } catch (error) {
    manifest.status = "partial";
    manifest.errors.push({ sourceUrl: fuelUrl, error: String(error?.message || error) });
  }

  const makesUrl = "https://vpic.nhtsa.dot.gov/api/vehicles/GetAllMakes?format=json";
  try {
    const result = await fetchBuffer(makesUrl, "application/json");
    manifest.files.push({ ...(await write(root, "nhtsa-all-makes.json", result.data)), sourceUrl: makesUrl, contentType: result.contentType });
    const payload = JSON.parse(result.data.toString("utf8"));
    manifest.counts.nhtsaMakes = Array.isArray(payload?.Results) ? payload.Results.length : 0;
  } catch (error) {
    manifest.status = "partial";
    manifest.errors.push({ sourceUrl: makesUrl, error: String(error?.message || error) });
  }

  const currentMakes = fuelCsv ? currentUsMakes(fuelCsv) : [];
  const makeResults = [];
  for (const make of currentMakes) {
    const url = `https://vpic.nhtsa.dot.gov/api/vehicles/GetModelsForMake/${encodeURIComponent(make)}?format=json`;
    try {
      const result = await fetchBuffer(url, "application/json");
      const payload = JSON.parse(result.data.toString("utf8"));
      const rows = Array.isArray(payload?.Results) ? payload.Results : [];
      makeResults.push({ queriedMake: make, sourceUrl: url, results: rows });
    } catch (error) {
      manifest.status = "partial";
      manifest.errors.push({ sourceUrl: url, make, error: String(error?.message || error) });
    }
    await sleep(NHTSA_DELAY_MS);
  }
  if (makeResults.length) {
    const merged = { schemaVersion: 1, fromYear: 2020, queriedMakes: currentMakes.length, makeResults };
    manifest.files.push({ ...(await writeJson(root, "nhtsa-models-current-makes.json", merged)), sourceUrl: "https://vpic.nhtsa.dot.gov/api/" });
  }
  manifest.counts.nhtsaCurrentMakesQueried = currentMakes.length;
  manifest.counts.nhtsaCurrentMakeResponses = makeResults.length;
  manifest.counts.nhtsaCurrentModels = makeResults.reduce((n, item) => n + item.results.length, 0);
  if (fuelCsv && currentMakes.length && makeResults.length === 0) manifest.status = "partial";

  manifest.notes.push("FuelEconomy.gov is the DOE/EPA passenger/light-truck specification spine; NHTSA vPIC adds manufacturer-reported US make/model identities. Compilation applies model-year >=2020.");
  manifest.notes.push("NHTSA is queried once per distinct 2020+ make observed in the EPA bulk CSV, with a bounded make cap and delay; there are no per-vehicle or per-VIN request loops.");
  await writeJson(root, "snapshot-manifest.json", manifest);
  return manifest;
}

async function snapshotCanada() {
  const root = path.join(ROOT, "canada");
  await fs.rm(root, { recursive: true, force: true }); await ensureDir(root);
  const manifest = { schemaVersion: 1, id: "nrcan-fuel-consumption-ratings", authority: "canada_government_vehicle_efficiency", fetchedAt: new Date().toISOString(), status: "complete", files: [], counts: {}, errors: [], notes: [] };
  const sources = [
    ["my2015-2024-fuel-consumption-ratings.csv", "https://open.canada.ca/data/dataset/98f1a129-f628-4ce4-b24d-6f16bf24dd64/resource/c98b9dc8-b23f-4cd8-8b19-e892da1e4688/download/my2015-2024-fuel-consumption-ratings.csv"],
    ["my2025-fuel-consumption-ratings.csv", "https://open.canada.ca/data/dataset/98f1a129-f628-4ce4-b24d-6f16bf24dd64/resource/d589f2bc-9a85-4f65-be2f-20f17debfcb1/download/my2025-fuel-consumption-ratings.csv"],
    ["my2026-fuel-consumption-ratings.csv", "https://open.canada.ca/data/dataset/98f1a129-f628-4ce4-b24d-6f16bf24dd64/resource/9df1b18d-d036-4783-a61c-99f1f75b3ac5/download/my2026-fuel-consumption-ratings.csv"],
    ["my2012-2026-battery-electric-vehicles.csv", "https://open.canada.ca/data/dataset/98f1a129-f628-4ce4-b24d-6f16bf24dd64/resource/026e45b4-eb63-451f-b34f-d9308ea3a3d9/download/my2012-2026-battery-electric-vehicles.csv"],
    ["my2012-2026-plug-in-hybrid-electric-vehicles.csv", "https://open.canada.ca/data/dataset/98f1a129-f628-4ce4-b24d-6f16bf24dd64/resource/8812228b-a6aa-4303-b3d0-66489225120d/download/my2012-2026-plug-in-hybrid-electric-vehicles.csv"],
  ];
  let rows = 0;
  for (const [name, url] of sources) {
    try {
      const result = await fetchBuffer(url, "text/csv,*/*");
      manifest.files.push({ ...(await write(root, name, result.data)), sourceUrl: url, contentType: result.contentType });
      rows += csvRowCount(result.data.toString("utf8"));
    } catch (error) {
      manifest.status = "partial";
      manifest.errors.push({ sourceUrl: url, error: String(error?.message || error) });
    }
  }
  manifest.counts.rows = rows;
  manifest.notes.push("Natural Resources Canada official CSVs cover ICE, BEV and PHEV passenger/light-duty vehicles; compilation applies model-year >=2020.");
  await writeJson(root, "snapshot-manifest.json", manifest);
  return manifest;
}

const results = [];
for (const fn of [snapshotUs, snapshotCanada]) {
  try { results.push(await fn()); }
  catch (error) { results.push({ status: "failed", error: String(error?.stack || error) }); }
}
console.log(JSON.stringify(results, null, 2));
if (results.some((item) => item.status === "failed")) process.exitCode = 1;
