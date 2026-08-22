import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const ROOT = path.resolve(process.env.KNOWLEDGE_OUTPUT_ROOT || "data/catalog/knowledge-source-snapshots/generated");
const OUT = path.join(ROOT, "korea");
const PAGE = "https://min24.energy.or.kr/trans_hp/AHP/HP_03/HP_03_01_010.do";
const ENDPOINT = "https://min24.energy.or.kr/trans_hp/cmn/AHP_L.do";
const START_YEAR = 2020;
const END_YEAR = new Date().getUTCFullYear();
const USER_AGENT = "AvtoCena-KnowledgeCORE/1.0 (+https://avtocena.com; Korea public-data snapshot)";
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const clean = (value) => String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
const numberOrNull = (value) => value === null || value === undefined || value === "" || !Number.isFinite(Number(value)) ? null : Number(value);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchWithRetry(url, options = {}) {
  let lastError;
  for (let attempt = 1; attempt <= 5; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120_000);
    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        redirect: "follow",
        headers: { "user-agent": USER_AGENT, ...(options.headers || {}) },
      });
      if (!response.ok) throw new Error(`http_${response.status}`);
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < 5) await sleep(1_500 * attempt);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

function csrfFrom(html) {
  return html.match(/<meta\s+name=["']_csrf["']\s+content=["']([^"']+)["']/i)?.[1]
    || html.match(/<meta\s+content=["']([^"']+)["']\s+name=["']_csrf["']/i)?.[1]
    || null;
}

function sessionCookie(response) {
  const values = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie") || ""];
  const match = values.join("; ").match(/(?:^|[;,]\s*)(JSESSIONID=[^;,]+)/i);
  return match?.[1] || null;
}

function requestBody(csrf) {
  const body = new URLSearchParams({
    _csrf: csrf,
    P_PKG_AREA: "AHP",
    P_ENTE_CD: "",
    P_CAR_TYPE_CD: "",
    P_GRD: "",
    P_PKG_NM: "AHP_03_01_010_L",
    P_COMP_CD_LIST: "",
    P_FUEL_KIND_CD_LIST: "",
    P_CAR_GB_CD_LIST: "",
    P_GEAR_FORM_CD_LIST: "",
    P_CAR_TYPE_CD_LIST: "",
    P_GRD_LIST: "",
    P_MILEAGE_CNT: "",
    P_TOTAL_CHARGE_MILEAGE_CNT: "",
    P_BAEGI_AMT_CNT: "",
    P_S_OPEN_DT: String(START_YEAR),
    P_E_OPEN_DT: String(END_YEAR),
    P_MODL_NM: "",
  });
  for (let index = 1; index <= 6; index++) {
    body.set(`P_MILEAGE_${index}`, "");
    body.set(`P_TOTAL_CHARGE_MILEAGE_${index}`, "");
    body.set(`P_BAEGI_AMT_${index}`, "");
  }
  return body;
}

await fs.mkdir(OUT, { recursive: true });
const pageResponse = await fetchWithRetry(PAGE, { headers: { accept: "text/html,*/*" } });
const html = await pageResponse.text();
const csrf = csrfFrom(html);
const cookie = sessionCookie(pageResponse);
if (!csrf) throw new Error("korea_energy_csrf_missing");
if (!cookie) throw new Error("korea_energy_session_cookie_missing");

const dataResponse = await fetchWithRetry(ENDPOINT, {
  method: "POST",
  headers: {
    accept: "application/json,text/plain,*/*",
    "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
    cookie,
    referer: PAGE,
    "x-requested-with": "XMLHttpRequest",
    "x-csrf-token": csrf,
  },
  body: requestBody(csrf),
});
const raw = Buffer.from(await dataResponse.arrayBuffer());
if (raw.length > 30_000_000) throw new Error(`korea_energy_too_large:${raw.length}`);
let payload;
try {
  payload = JSON.parse(raw.toString("utf8"));
} catch {
  throw new Error(`korea_energy_json_invalid:${raw.subarray(0, 160).toString("utf8")}`);
}
if (!Array.isArray(payload.list)) throw new Error("korea_energy_list_missing");

const records = payload.list.map((row) => ({
  sourceRecordId: clean(row.RECP_NO) || null,
  modelName: clean(row.MODL_NM),
  manufacturer: clean(row.ENTE_NM || row.COMP_NM) || null,
  manufacturerLabel: clean(row.COMP_NM) || null,
  vehicleClass: clean(row.CAR_GB_NM) || null,
  type: clean(row.CAR_TYPE_NM || row.TYPE_GB_NM) || null,
  subtype: clean(row.TYPE_GB_NM) || null,
  fuel: clean(row.FUEL_KIND_NM) || null,
  transmission: clean(row.GEAR_FORM_NM) || null,
  combinedEfficiency: numberOrNull(row.TOTAL_MILEAGE ?? row.MIXMD_MILEAGE),
  cityEfficiency: numberOrNull(row.CITY_MILEAGE),
  highwayEfficiency: numberOrNull(row.HIGH_MILEAGE),
  rangeKm: numberOrNull(row.TOTAL_CHARGE_MILEAGE),
  cityRangeKm: numberOrNull(row.CITY_CHARGE_MILEAGE),
  highwayRangeKm: numberOrNull(row.HIGH_CHARGE_MILEAGE),
  co2GPerKm: numberOrNull(row.MIXMD_CO2),
  engineCc: numberOrNull(row.BAEGI_AMT),
  grade: clean(row.GRD_NM) || null,
  releaseYear: numberOrNull(row.OPEN_YY),
  releaseDate: clean(row.OPEN_DT) || null,
  testNumber: clean(row.TEST_NO) || null,
})).filter((row) => row.modelName && Number(row.releaseYear) >= START_YEAR);

const chunks = [];
for (let index = 0; index < records.length; index += 1000) {
  const chunk = Math.floor(index / 1000) + 1;
  const name = `energy-agency-models-${String(chunk).padStart(4, "0")}.json`;
  await fs.writeFile(path.join(OUT, name), JSON.stringify({
    schemaVersion: 1,
    sourceId: "korea-energy-agency-efficiency",
    chunk,
    records: records.slice(index, index + 1000),
  }, null, 2) + "\n");
  chunks.push(name);
}

const years = [...new Set(records.map((row) => row.releaseYear))].sort((a, b) => a - b);
const yearCounts = Object.fromEntries(years.map((year) => [String(year), records.filter((row) => row.releaseYear === year).length]));
const manifest = {
  schemaVersion: 1,
  id: "korea-energy-agency-efficiency",
  authority: "government_efficiency",
  fetchedAt: new Date().toISOString(),
  status: "complete",
  page: PAGE,
  contentUrl: ENDPOINT,
  collection: { method: "official_live_catalog_query", releaseYearFrom: START_YEAR, releaseYearTo: END_YEAR },
  raw: { bytes: raw.length, sha256: sha256(raw), encoding: "utf-8-json", storedInGit: false },
  counts: { models: records.length, responseRows: payload.list.length, byReleaseYear: yearCounts },
  files: chunks,
};
await fs.writeFile(path.join(OUT, "energy-agency-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(JSON.stringify(manifest, null, 2));
if (records.length < 1000) throw new Error(`korea_energy_model_collapse:${records.length}`);
