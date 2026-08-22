import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const SOURCE = String(process.env.KNOWLEDGE_SOURCE || "vehiclesdb").trim().toLowerCase();
const ROOT = path.resolve(process.env.KNOWLEDGE_OUTPUT_ROOT || "data/catalog/knowledge-source-snapshots/generated");
const SOURCE_ROOT = path.join(ROOT, SOURCE);
const FETCH_ATTEMPTS = Math.max(1, Math.min(5, Number(process.env.KNOWLEDGE_FETCH_ATTEMPTS || 3)));
const FETCH_TIMEOUT_MS = Math.max(5_000, Math.min(180_000, Number(process.env.KNOWLEDGE_FETCH_TIMEOUT_MS || 45_000)));
const MAX_TEXT_BYTES = Math.max(1_000_000, Math.min(50_000_000, Number(process.env.KNOWLEDGE_MAX_TEXT_BYTES || 10_000_000)));
const USER_AGENT = "AvtoCena-KnowledgeCORE/1.0 (+https://avtocena.com; source snapshot; respectful public-data client)";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const clean = (value) => String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();

async function ensureDir(dir) { await fs.mkdir(dir, { recursive: true }); }
async function writeText(relative, text) {
  const file = path.join(SOURCE_ROOT, relative);
  await ensureDir(path.dirname(file));
  await fs.writeFile(file, text);
  return { file: path.relative(ROOT, file).replaceAll(path.sep, "/"), bytes: Buffer.byteLength(text), sha256: sha256(text) };
}
async function writeJson(relative, value) {
  return writeText(relative, `${JSON.stringify(value, null, 2)}\n`);
}

async function fetchResponse(url, { accept = "*/*" } = {}) {
  const failures = [];
  for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        redirect: "follow",
        signal: controller.signal,
        headers: { accept, "user-agent": USER_AGENT },
      });
      if (!response.ok) throw new Error(`http_${response.status}`);
      return response;
    } catch (error) {
      failures.push({ attempt, error: String(error?.message || error) });
      if (attempt < FETCH_ATTEMPTS) await sleep(Math.min(5_000, 500 * attempt));
    } finally {
      clearTimeout(timer);
    }
  }
  const problem = new Error(`fetch_failed:${url}`);
  problem.failures = failures;
  throw problem;
}

async function fetchText(url, options = {}) {
  const response = await fetchResponse(url, options);
  const length = Number(response.headers.get("content-length") || 0);
  if (length > MAX_TEXT_BYTES) throw new Error(`source_text_too_large:${length}:${url}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_TEXT_BYTES) throw new Error(`source_text_too_large:${buffer.length}:${url}`);
  return { text: buffer.toString("utf8"), contentType: response.headers.get("content-type") || "", url: response.url || url };
}

function decodeEntities(value) {
  return String(value || "")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}
function stripHtml(value) {
  return clean(decodeEntities(String(value || "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")));
}
function htmlLinks(html, baseUrl) {
  const out = [];
  for (const match of String(html || "").matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    try {
      const url = new URL(match[1], baseUrl).toString();
      out.push({ url, text: stripHtml(match[2]) });
    } catch {}
  }
  return out;
}
function htmlRows(html) {
  const rows = [];
  for (const rowMatch of String(html || "").matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...rowMatch[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((match) => stripHtml(match[1])).filter(Boolean);
    if (cells.length >= 2) rows.push(cells);
  }
  return rows;
}

function manifestBase(id, authority) {
  return {
    schemaVersion: 1,
    id,
    authority,
    fetchedAt: new Date().toISOString(),
    status: "complete",
    files: [],
    counts: {},
    errors: [],
    notes: [],
  };
}

async function snapshotVehiclesDb() {
  const manifest = manifestBase("vehiclesdb-open-catalog", "open_composite_official_registers");
  const sources = [
    ["manifest.json", "https://raw.githubusercontent.com/vehiclesdb/vehiclesdb/main/manifest.json"],
    ["car-makes.json", "https://raw.githubusercontent.com/vehiclesdb/vehiclesdb/main/catalog/car/makes.json"],
    ["car-models.json", "https://raw.githubusercontent.com/vehiclesdb/vehiclesdb/main/catalog/car/models.json"],
    ["ATTRIBUTION.md", "https://raw.githubusercontent.com/vehiclesdb/vehiclesdb/main/ATTRIBUTION.md"],
    ["SOURCES.md", "https://raw.githubusercontent.com/vehiclesdb/vehiclesdb/main/SOURCES.md"],
  ];
  for (const [fileName, url] of sources) {
    const { text } = await fetchText(url, { accept: "application/json,text/plain,text/markdown,*/*" });
    manifest.files.push({ ...(await writeText(fileName, text)), sourceUrl: url });
  }
  const makes = JSON.parse(await fs.readFile(path.join(SOURCE_ROOT, "car-makes.json"), "utf8"));
  const models = JSON.parse(await fs.readFile(path.join(SOURCE_ROOT, "car-models.json"), "utf8"));
  manifest.counts = {
    makes: Array.isArray(makes) ? makes.length : Number(makes?.records?.length || 0),
    models: Array.isArray(models) ? models.length : Number(models?.records?.length || 0),
  };
  manifest.notes.push("CC-BY 4.0 attribution files are snapshotted beside the data and must survive compilation.");
  await writeJson("snapshot-manifest.json", manifest);
  return manifest;
}

const EEA_CAR_DATASETS = {
  2020: { table: "co2cars_2020Fv22", status: "F" },
  2021: { table: "co2cars_2021Fv24", status: "F" },
  2022: { table: "co2cars_2022Fv26", status: "F" },
  2023: { table: "co2cars_2023Fv28", status: "F" },
  2024: { table: "co2cars_2024Pv29", status: "P" },
  2025: { table: "co2cars_2025Pv31", status: "P" },
};

function eeaDataset(year) {
  return EEA_CAR_DATASETS[year] || { table: "co2cars", status: year >= 2024 ? "P" : "F" };
}

function eeaQuery(year) {
  const dataset = eeaDataset(year);
  return `SELECT [Year] AS year,[Mk] AS make,[Cn] AS commercialName,[T] AS type,[Va] AS variant,[Ve] AS version,[Ft] AS fuel,[Ec (cm3)] AS engineCc,[Ep (KW)] AS powerKw,[W (mm)] AS wheelbaseMm,[M (kg)] AS massKg,COUNT(*) AS observations FROM [CO2Emission].[latest].[${dataset.table}] WHERE [Year]=${year} AND [Status]='${dataset.status}' AND [Mk] IS NOT NULL AND [Cn] IS NOT NULL GROUP BY [Year],[Mk],[Cn],[T],[Va],[Ve],[Ft],[Ec (cm3)],[Ep (KW)],[W (mm)],[M (kg)]`;
}

async function snapshotEea() {
  const manifest = manifestBase("eea-co2-passenger-cars", "government_regulatory_registration");
  const pageSize = Math.max(100, Math.min(10_000, Number(process.env.KNOWLEDGE_EEA_PAGE_SIZE || 5_000)));
  const maxPages = Math.max(1, Math.min(500, Number(process.env.KNOWLEDGE_EEA_MAX_PAGES_PER_YEAR || 250)));
  const startYear = 2020;
  const endYear = Math.min(2025, new Date().getFullYear());
  let total = 0;
  for (let year = startYear; year <= endYear; year++) {
    const dataset = eeaDataset(year);
    const query = eeaQuery(year);
    let yearCount = 0;
    let finished = false;
    for (let page = 1; page <= maxPages; page++) {
      const url = `https://discodata.eea.europa.eu/sql?query=${encodeURIComponent(query)}&p=${page}&nrOfHits=${pageSize}`;
      const { text } = await fetchText(url, { accept: "application/json" });
      const payload = JSON.parse(text);
      if (Array.isArray(payload?.errors) && payload.errors.length) throw new Error(`eea_sql_error:${JSON.stringify(payload.errors).slice(0, 500)}`);
      const rows = Array.isArray(payload?.results) ? payload.results : [];
      if (!rows.length) { finished = true; break; }
      const relative = `year-${year}/part-${String(page).padStart(4, "0")}.json`;
      manifest.files.push({ ...(await writeJson(relative, { source: `EEA CO2Emission.latest.${dataset.table}`, query, page, rows })), sourceUrl: url });
      yearCount += rows.length;
      total += rows.length;
      if (rows.length < pageSize) { finished = true; break; }
      await sleep(80);
    }
    manifest.counts[`year${year}`] = yearCount;
    if (!finished) {
      manifest.status = "partial";
      manifest.errors.push({ source: "eea", year, table: dataset.table, error: `page_cap_reached:${maxPages}` });
    }
    if (yearCount === 0) {
      manifest.status = "partial";
      manifest.errors.push({ source: "eea", year, table: dataset.table, error: "empty_year_dataset" });
    }
  }
  manifest.counts.technicalTuples = total;
  manifest.notes.push("Rows are DISTINCT-by-GROUP technical identity tuples with observation counts; duplicate registration microdata is intentionally not copied to GitHub.");
  manifest.notes.push("Year-specific EEA tables are pinned for 2020-2025 because the generic latest.co2cars view can omit historical years even when their official versioned datasets remain available.");
  await writeJson("snapshot-manifest.json", manifest);
  return manifest;
}

async function snapshotMiit() {
  const manifest = manifestBase("miit-road-vehicle-products", "government_type_approval");
  const first = Math.max(173, Number(process.env.KNOWLEDGE_MIIT_FIRST_BATCH || 328));
  const last = Math.max(first, Math.min(450, Number(process.env.KNOWLEDGE_MIIT_LAST_BATCH || 410)));
  let extractedRows = 0;
  let blockedBatches = 0;
  for (let batch = first; batch <= last; batch++) {
    const url = `https://service.miit-eidc.org.cn/miitxxgk/gonggao/xxgk/queryByPc?pc=${batch}&querylb=cp&qyinfolb=`;
    try {
      const { text } = await fetchText(url, { accept: "text/html,application/xhtml+xml" });
      const blocked = /访问行为验证|滑块|captcha|verify/i.test(text);
      const rows = blocked ? [] : htmlRows(text);
      const links = htmlLinks(text, url).filter((item) => /queryCpData|ggcp|\.pdf(?:$|\?)/i.test(item.url));
      if (blocked) blockedBatches++;
      extractedRows += rows.length;
      manifest.files.push({ ...(await writeText(`batches/batch-${batch}.html`, text)), sourceUrl: url });
      manifest.files.push({ ...(await writeJson(`batches/batch-${batch}.json`, { batch, sourceUrl: url, blocked, rows, links })), sourceUrl: url });
      if (blocked) manifest.errors.push({ batch, error: "access_verification_present_no_bypass_attempted" });
    } catch (error) {
      manifest.status = "partial";
      manifest.errors.push({ batch, error: String(error?.message || error) });
    }
    await sleep(150);
  }
  manifest.counts = { batchesRequested: last - first + 1, extractedHtmlRows: extractedRows, blockedBatches };
  if (blockedBatches) manifest.status = "partial";
  manifest.notes.push("No CAPTCHA/slider is bypassed. Accessible public batch HTML is preserved verbatim; extracted table rows remain raw Chinese source evidence until canonical compilation.");
  await writeJson("snapshot-manifest.json", manifest);
  return manifest;
}

async function snapshotMlit() {
  const manifest = manifestBase("mlit-japan-fuel-economy", "government_type_approval_efficiency");
  const seeds = [
    "https://www.mlit.go.jp/jidosha/jidosha_mn10_000002.html",
    "https://www.mlit.go.jp/jidosha/jidosha_fr10_000004.html",
    "https://www.mlit.go.jp/jidosha/jidosha_tk10_000050.html",
  ];
  const queue = [...seeds];
  const seen = new Set();
  const discovered = [];
  const maxPages = Math.max(10, Math.min(250, Number(process.env.KNOWLEDGE_MLIT_MAX_PAGES || 120)));
  let extractedRows = 0;
  while (queue.length && seen.size < maxPages) {
    const url = queue.shift();
    if (seen.has(url)) continue;
    seen.add(url);
    try {
      const { text } = await fetchText(url, { accept: "text/html,application/xhtml+xml" });
      const name = `pages/${String(seen.size).padStart(4, "0")}-${sha256(url).slice(0, 10)}.html`;
      manifest.files.push({ ...(await writeText(name, text)), sourceUrl: url });
      const rows = htmlRows(text);
      extractedRows += rows.length;
      const links = htmlLinks(text, url);
      for (const link of links) {
        if (!/^https:\/\/(?:www\.)?mlit\.go\.jp\//i.test(link.url)) continue;
        if (/\.(?:pdf)(?:$|\?)/i.test(link.url)) {
          discovered.push({ ...link, kind: "pdf_reference" });
          continue;
        }
        if (/\.(?:xls|xlsx|csv|zip)(?:$|\?)/i.test(link.url)) {
          discovered.push({ ...link, kind: "tabular_attachment" });
          continue;
        }
        if (/jidosha|nenpi/i.test(link.url) && /燃費|nenpi|jidosha_(?:fr|mn|tk)10/i.test(`${link.text} ${link.url}`) && !seen.has(link.url)) queue.push(link.url);
      }
      await writeJson(`rows/${sha256(url).slice(0, 16)}.json`, { sourceUrl: url, rows });
    } catch (error) {
      manifest.status = "partial";
      manifest.errors.push({ url, error: String(error?.message || error) });
    }
    await sleep(100);
  }
  manifest.files.push(await writeJson("discovered-attachments.json", [...new Map(discovered.map((item) => [item.url, item])).values()]));
  manifest.counts = { htmlPages: seen.size, extractedHtmlRows: extractedRows, attachmentReferences: discovered.length };
  if (queue.length) {
    manifest.status = "partial";
    manifest.errors.push({ error: `mlit_page_cap_reached:${maxPages}`, remainingQueue: queue.length });
  }
  manifest.notes.push("HTML/table rows are snapshotted first. Opaque PDF references are indexed rather than bulk-committed; later fact extraction must keep page/source provenance.");
  await writeJson("snapshot-manifest.json", manifest);
  return manifest;
}

async function snapshotKorea() {
  const manifest = manifestBase("korea-government-open-data", "government_registration");
  const urls = [
    ["jeju-file-page.html", "https://www.data.go.kr/data/15128417/fileData.do"],
    ["jeju-file-metadata.json", "https://www.data.go.kr/catalog/15128417/fileData.json"],
    ["kotsa-new-registration-metadata.json", "https://www.data.go.kr/catalog/15059401/openapi.json"],
    ["kotsa-manufacturer-metadata.json", "https://www.data.go.kr/catalog/15057664/openapi.json"],
  ];
  const downloadCandidates = [];
  for (const [fileName, url] of urls) {
    try {
      const { text, contentType } = await fetchText(url, { accept: "application/json,text/html,*/*" });
      manifest.files.push({ ...(await writeText(fileName, text)), sourceUrl: url, contentType });
      if (/\.html$/i.test(fileName)) {
        for (const link of htmlLinks(text, url)) {
          if (/csv|fileDownload|download/i.test(`${link.url} ${link.text}`)) downloadCandidates.push(link);
        }
      }
    } catch (error) {
      manifest.status = "partial";
      manifest.errors.push({ url, error: String(error?.message || error) });
    }
  }
  manifest.files.push(await writeJson("download-candidates.json", [...new Map(downloadCandidates.map((item) => [item.url, item])).values()]));
  manifest.counts = { publicDownloadCandidates: downloadCandidates.length };
  manifest.notes.push("The Jeju file dataset advertises 424,332 rows and no-login file download, but the portal's generated download action may not be exposed as a static href. Nationwide KOTSA APIs require a free service key; this snapshot never invents or bypasses one.");
  if (!downloadCandidates.length) manifest.status = "partial";
  await writeJson("snapshot-manifest.json", manifest);
  return manifest;
}

const handlers = {
  vehiclesdb: snapshotVehiclesDb,
  eea: snapshotEea,
  miit: snapshotMiit,
  mlit: snapshotMlit,
  korea: snapshotKorea,
};

if (!handlers[SOURCE]) throw new Error(`unknown_knowledge_source:${SOURCE}`);
await fs.rm(SOURCE_ROOT, { recursive: true, force: true });
await ensureDir(SOURCE_ROOT);
let finalManifest;
try {
  finalManifest = await handlers[SOURCE]();
} catch (error) {
  finalManifest = manifestBase(SOURCE, "unknown");
  finalManifest.status = "failed";
  finalManifest.errors.push({ error: String(error?.stack || error?.message || error) });
  await writeJson("snapshot-manifest.json", finalManifest);
}
console.log(JSON.stringify(finalManifest, null, 2));