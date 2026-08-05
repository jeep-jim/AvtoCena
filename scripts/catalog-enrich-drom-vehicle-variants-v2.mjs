import crypto from "node:crypto";

const { readDataJson, writeDataJson } = await import("../apps/web/lib/data.ts");
const { replaceChunkedDataJson } = await import("../apps/web/lib/replace-chunked-data.ts");
const { readAllOffersForMaintenance } = await import("../apps/web/lib/catalog/storage.ts");
const { parseDromVehicleVariantsV2, looksLikeDromSpecsDocument } = await import("../apps/web/lib/catalog/drom-vehicle-knowledge-v2.ts");
const {
  findVehicleModel,
  readVehicleKnowledgeModels,
  readVehicleKnowledgeVariants,
  resetVehicleKnowledgeCache,
} = await import("../apps/web/lib/catalog/vehicle-knowledge.ts");

const PARSER_VERSION = 2;
const PROGRESS_PATH = "catalog/vehicle-knowledge/drom-progress.json";
const REPORT_PATH = "catalog/vehicle-knowledge/drom-enrichment-report.json";
const MODELS_PATH = "catalog/vehicle-knowledge/models.json";
const VARIANTS_PATH = "catalog/vehicle-knowledge/variants.json";
const LIMIT = Math.max(1, Math.min(1_000, Number(process.env.DROM_KNOWLEDGE_LIMIT || 300)));
const DELAY_MS = Math.max(200, Number(process.env.DROM_KNOWLEDGE_DELAY_MS || 900));
const TIMEOUT_MS = Math.max(5_000, Number(process.env.DROM_KNOWLEDGE_TIMEOUT_MS || 25_000));
const RETRY_DAYS = Math.max(1, Number(process.env.DROM_KNOWLEDGE_RETRY_DAYS || 7));
const ONLY_RECENT = String(process.env.DROM_KNOWLEDGE_ONLY_RECENT || "1") !== "0";
const RECENT_YEARS = Math.max(6, Math.min(15, Number(process.env.VEHICLE_KNOWLEDGE_RECENT_YEARS || 15)));
const RECENT_YEAR_FLOOR = new Date().getFullYear() - RECENT_YEARS + 1;

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function dromSpecsUrl(model) {
  const explicit = clean(model.sourceUrl);
  if (/^https:\/\/(?:www\.)?drom\.ru\/catalog\//i.test(explicit)) {
    const base = explicit.replace(/[?#].*$/, "").replace(/\/+$/, "");
    return /\/specs\/engine_capacity$/i.test(base) ? `${base}/` : `${base}/specs/engine_capacity/`;
  }
  const [makeSlug, modelSlug] = String(model.id || "").split("/");
  if (!makeSlug || !modelSlug) return "";
  return `https://www.drom.ru/catalog/${encodeURIComponent(makeSlug)}/${encodeURIComponent(modelSlug)}/specs/engine_capacity/`;
}

function modelIsRecent(model) {
  const newest = Math.max(Number(model.yearFrom || 0), Number(model.yearTo || 0));
  if (newest) return newest >= RECENT_YEAR_FLOOR;
  return Number(model.popularityDecile || 10) <= 5;
}

async function fetchText(url, accept = "text/html,application/xhtml+xml,text/plain,*/*") {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: {
        accept,
        "accept-language": "ru-RU,ru;q=0.9,en;q=0.7",
        "cache-control": "no-cache",
        "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131 Safari/537.36 AvtoCena/2.0",
      },
      signal: controller.signal,
      redirect: "follow",
    });
    const text = await response.text();
    return { status: response.status, ok: response.ok, text, finalUrl: response.url };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchDromDocument(url) {
  const direct = await fetchText(url);
  if (direct.ok && looksLikeDromSpecsDocument(direct.text)) {
    return { ...direct, transport: "direct" };
  }
  if ([403, 429].includes(direct.status)) {
    return { ...direct, transport: "direct", blocked: true };
  }
  const proxyUrl = `https://r.jina.ai/http://${url.replace(/^https?:\/\//, "")}`;
  const proxy = await fetchText(proxyUrl, "text/plain,text/markdown,*/*");
  if (proxy.ok && looksLikeDromSpecsDocument(proxy.text)) {
    return { ...proxy, transport: "jina", sourceUrl: url };
  }
  return {
    ...direct,
    transport: "none",
    invalidDocument: true,
    diagnostics: {
      directStatus: direct.status,
      directBytes: direct.text.length,
      proxyStatus: proxy.status,
      proxyBytes: proxy.text.length,
      directSample: clean(direct.text).slice(0, 280),
      proxySample: clean(proxy.text).slice(0, 280),
    },
  };
}

function variantId(variant) {
  const signature = [variant.modelId, variant.generation || "", variant.productionFrom || "", variant.productionTo || "", variant.engineCc || "", variant.powerHp || "", variant.fuel || "", variant.transmission || "", variant.drive || "", variant.engineCode || ""].join("|");
  return `drom_${crypto.createHash("sha256").update(signature).digest("hex").slice(0, 24)}`;
}

function median(values) {
  const sorted = values.map(Number).filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  if (!sorted.length) return undefined;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round(((sorted[middle - 1] + sorted[middle]) / 2) * 10) / 10;
}

const startedAt = new Date().toISOString();
const [models, existingVariants, offers, progress] = await Promise.all([
  readVehicleKnowledgeModels(),
  readVehicleKnowledgeVariants(),
  readAllOffersForMaintenance(),
  readDataJson(PROGRESS_PATH, { version: PARSER_VERSION, models: {} }),
]);
progress.models = progress.models || {};

const activeModelIds = new Set();
for (const offer of offers) {
  const match = await findVehicleModel(offer);
  if (match) activeModelIds.add(match.model.id);
}

const now = Date.now();
const eligibleModels = models
  .filter((model) => model.active !== false && dromSpecsUrl(model))
  .filter((model) => activeModelIds.has(model.id) || !ONLY_RECENT || modelIsRecent(model));
const candidates = eligibleModels
  .filter((model) => {
    const row = progress.models?.[model.id];
    if (!row || Number(row.parserVersion || 0) !== PARSER_VERSION) return true;
    const retryAt = Date.parse(String(row.retryAt || ""));
    return Number.isFinite(retryAt) && retryAt <= now;
  })
  .sort((left, right) => {
    const activeDelta = Number(activeModelIds.has(right.id)) - Number(activeModelIds.has(left.id));
    if (activeDelta) return activeDelta;
    const recentDelta = Number(modelIsRecent(right)) - Number(modelIsRecent(left));
    if (recentDelta) return recentDelta;
    const popularityDelta = Number(left.popularityDecile || 10) - Number(right.popularityDecile || 10);
    if (popularityDelta) return popularityDelta;
    return `${left.make} ${left.model}`.localeCompare(`${right.make} ${right.model}`, "ru");
  })
  .slice(0, LIMIT);

const nextVariants = new Map(existingVariants.map((variant) => [variant.id, variant]));
const results = [];
let blocked = false;
let processedModels = 0;

for (let index = 0; index < candidates.length; index++) {
  const model = candidates[index];
  const url = dromSpecsUrl(model);
  const checkedAt = new Date().toISOString();
  try {
    const response = await fetchDromDocument(url);
    if (response.blocked) {
      blocked = true;
      progress.models[model.id] = { status: "blocked", parserVersion: PARSER_VERSION, checkedAt, retryAt: new Date(Date.now() + 6 * 3_600_000).toISOString(), httpStatus: response.status, url };
      results.push({ modelId: model.id, url, status: "blocked", httpStatus: response.status });
      break;
    }
    if (response.status === 404) {
      progress.models[model.id] = { status: "not_found", parserVersion: PARSER_VERSION, checkedAt, retryAt: new Date(Date.now() + RETRY_DAYS * 86_400_000).toISOString(), url };
      results.push({ modelId: model.id, url, status: "not_found" });
      continue;
    }
    if (response.invalidDocument) {
      progress.models[model.id] = { status: "invalid_document", parserVersion: PARSER_VERSION, checkedAt, retryAt: new Date(Date.now() + 6 * 3_600_000).toISOString(), url, diagnostics: response.diagnostics };
      results.push({ modelId: model.id, url, status: "invalid_document", diagnostics: response.diagnostics });
      continue;
    }
    if (!response.ok) throw new Error(`drom_http_${response.status}`);

    const parsed = parseDromVehicleVariantsV2(response.text, model, url, checkedAt);
    processedModels++;
    if (!parsed.length) {
      progress.models[model.id] = { status: "parse_empty", parserVersion: PARSER_VERSION, checkedAt, retryAt: new Date(Date.now() + 6 * 3_600_000).toISOString(), url, transport: response.transport, sample: clean(response.text).slice(0, 320) };
      results.push({ modelId: model.id, url, status: "parse_empty", transport: response.transport });
      continue;
    }

    for (const [id, variant] of nextVariants) {
      if (variant.modelId === model.id && variant.sourceType === "drom_catalog") nextVariants.delete(id);
    }
    for (const variant of parsed) {
      const id = variantId(variant);
      nextVariants.set(id, { ...variant, id });
    }
    progress.models[model.id] = { status: "ready", parserVersion: PARSER_VERSION, checkedAt, retryAt: new Date(Date.now() + 180 * 86_400_000).toISOString(), variants: parsed.length, url, transport: response.transport };
    results.push({ modelId: model.id, url, status: "ready", variants: parsed.length, transport: response.transport });
  } catch (error) {
    progress.models[model.id] = { status: "error", parserVersion: PARSER_VERSION, checkedAt, retryAt: new Date(Date.now() + 86_400_000).toISOString(), error: String(error?.message || error), url };
    results.push({ modelId: model.id, url, status: "error", error: String(error?.message || error) });
  }
  if (index + 1 < candidates.length) await sleep(DELAY_MS);
}

const variants = [...nextVariants.values()].sort((left, right) => left.make.localeCompare(right.make, "ru") || left.model.localeCompare(right.model, "ru") || Number(left.yearFrom || 0) - Number(right.yearFrom || 0) || Number(left.powerHp || 0) - Number(right.powerHp || 0));
const variantsByModel = new Map();
for (const variant of variants) {
  const list = variantsByModel.get(variant.modelId) || [];
  list.push(variant);
  variantsByModel.set(variant.modelId, list);
}
const nextModels = models.map((model) => {
  const rows = variantsByModel.get(model.id) || [];
  if (!rows.length) return model;
  const starts = rows.map((row) => Number(row.yearFrom || 0)).filter(Boolean);
  const ends = rows.map((row) => Number(row.yearTo || 0)).filter(Boolean);
  return {
    ...model,
    yearFrom: starts.length ? Math.min(...starts) : model.yearFrom,
    yearTo: ends.length && ends.length === rows.length ? Math.max(...ends) : model.yearTo,
    representativePowerHp: median(rows.map((row) => row.powerHp)) || model.representativePowerHp,
    updatedAt: startedAt,
  };
});

progress.version = PARSER_VERSION;
progress.updatedAt = new Date().toISOString();
progress.lastBatch = {
  parserVersion: PARSER_VERSION,
  startedAt,
  finishedAt: progress.updatedAt,
  limit: LIMIT,
  delayMs: DELAY_MS,
  onlyRecent: ONLY_RECENT,
  recentYears: RECENT_YEARS,
  recentYearFloor: RECENT_YEAR_FLOOR,
  eligibleModels: eligibleModels.length,
  selected: candidates.length,
  processed: results.length,
  ready: results.filter((row) => row.status === "ready").length,
  variants: results.reduce((sum, row) => sum + Number(row.variants || 0), 0),
  invalidDocuments: results.filter((row) => row.status === "invalid_document").length,
  parseEmpty: results.filter((row) => row.status === "parse_empty").length,
  blocked,
};

await replaceChunkedDataJson(VARIANTS_PATH, variants, 250);
await replaceChunkedDataJson(MODELS_PATH, nextModels, 250);
await writeDataJson(PROGRESS_PATH, progress);
await writeDataJson(REPORT_PATH, { ...progress.lastBatch, results: results.slice(0, 1_000) });
resetVehicleKnowledgeCache();

console.log(JSON.stringify({ ...progress.lastBatch, activeCatalogModels: activeModelIds.size, totalModels: models.length, totalVariants: variants.length, updatedModels: processedModels }, null, 2));
if (blocked) process.exitCode = 2;
