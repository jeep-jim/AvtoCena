import fs from "node:fs/promises";

const { catalogImportSources } = await import("../apps/web/lib/catalog/importer.ts");

const market = String(process.env.CATALOG_REBUILD_MARKET || "").trim();
const shardIndex = Math.max(0, Number(process.env.CATALOG_REBUILD_SHARD_INDEX || 0));
const shardCount = Math.max(1, Number(process.env.CATALOG_REBUILD_SHARD_COUNT || 1));
const timeoutMs = Math.max(3_000, Number(process.env.CATALOG_PROBE_TIMEOUT_MS || 12_000));
const attempts = Math.max(1, Math.min(3, Number(process.env.CATALOG_PROBE_ATTEMPTS || 2)));
const concurrency = Math.max(1, Math.min(12, Number(process.env.CATALOG_PROBE_CONCURRENCY || 4)));
const outputFile = process.env.CATALOG_PROBE_OUTPUT || `catalog-probe-${market}-${shardIndex}.json`;

const priorityPlan = {
  korea: ["encar_direct", "kcar_korea_open"],
  china: ["guazi_china_open", "che168_china_exact", "guazi_china_export", "autohome_used_china_open", "dongchedi_china_open", "autohome_new_china_open"],
  japan: ["carused_japan_open", "tcv_japan_open", "goonet_japan_exact", "goonet_japan", "beforward_japan", "jpcenter_japan_catalog_open", "jpauc_japan_past_open", "carvector_japan_stat_open"],
  uae: ["dubicars_uae_exact", "dubizzle_uae_open", "dubicars_clean", "beforward_uae"],
  europe: ["mobile_de_open", "autoscout_europe_open", "otomoto_europe_exact", "otomoto_pl_open", "autouncle_europe"],
  georgia: ["myauto_georgia_list", "myauto_georgia_exact", "autopapa_georgia_open"],
  kyrgyzstan: ["mashina_kyrgyzstan_exact"],
};

if (!Object.prototype.hasOwnProperty.call(priorityPlan, market)) throw new Error(`unsupported_probe_market_${market || "missing"}`);

function stableShard(value) {
  let hash = 2166136261;
  for (const char of String(value)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0) % shardCount;
}

function withTimeout(promise, sourceId) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${sourceId}_probe_timeout_${timeoutMs}`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function isUsableOffer(offer, sourceId) {
  return Boolean(
    offer
    && offer.id
    && offer.sourceId === sourceId
    && offer.market === market
    && Number(offer.sourcePrice || 0) > 0
    && offer.sourceCurrency
    && offer.operational?.sourceUrl
  );
}

async function runWithConcurrency(items, limit, worker) {
  if (!items.length) return [];
  const results = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }));
  return results;
}

async function probe(sourceId, adapters) {
  const source = adapters.get(sourceId);
  const startedAt = Date.now();
  if (!source) return { sourceId, active: false, reason: "source_not_found", durationMs: 0, attempts: 0, fetched: 0, usable: 0 };

  let lastError = "";
  let totalFetched = 0;
  let totalUsable = 0;
  let nextCursor = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const result = await withTimeout(source.fetchPage(attempt === 1 ? null : nextCursor), sourceId);
      const rows = Array.isArray(result?.items) ? result.items : [];
      totalFetched += rows.length;
      for (const row of rows.slice(0, 100)) {
        try {
          if (isUsableOffer(source.normalizeOffer(row), sourceId)) totalUsable++;
        } catch {
          // Одна повреждённая карточка не выключает весь источник.
        }
      }
      nextCursor = result?.nextCursor || null;
      if (totalUsable > 0) {
        return {
          sourceId,
          active: true,
          reason: "live",
          durationMs: Date.now() - startedAt,
          attempts: attempt,
          fetched: totalFetched,
          usable: totalUsable,
          nextCursor,
          health: result?.health || null,
        };
      }
      if (!nextCursor) break;
    } catch (error) {
      lastError = String(error?.message || error);
    }
  }

  return {
    sourceId,
    active: false,
    reason: lastError ? "probe_failed" : totalFetched ? "no_usable_offers" : "empty_page",
    durationMs: Date.now() - startedAt,
    attempts,
    fetched: totalFetched,
    usable: totalUsable,
    nextCursor,
    error: lastError || undefined,
  };
}

const adapters = new Map(catalogImportSources.map((source) => [source.sourceId, source]));
const registered = catalogImportSources
  .filter((source) => source.market === market || source.market === "multi")
  .map((source) => source.sourceId);
const configured = String(process.env.CATALOG_PROBE_SOURCE_IDS || "").split(",").map((value) => value.trim()).filter(Boolean);
const plannedAll = configured.length
  ? [...new Set(configured)]
  : [...new Set([...priorityPlan[market], ...registered])];
const priorityRank = new Map(priorityPlan[market].map((sourceId, index) => [sourceId, index]));
const planned = plannedAll
  .filter((sourceId) => adapters.has(sourceId))
  .sort((left, right) => (priorityRank.get(left) ?? 10_000) - (priorityRank.get(right) ?? 10_000) || left.localeCompare(right));
const sourceIds = planned.filter((sourceId) => stableShard(sourceId) === shardIndex);
const results = await runWithConcurrency(sourceIds, concurrency, (sourceId) => probe(sourceId, adapters));
const activeSourceIds = results.filter((row) => row.active).map((row) => row.sourceId);
const inactiveSourceIds = results.filter((row) => !row.active).map((row) => row.sourceId);
// Probe — диагностика и приоритизация, а не фильтр. Каждый зарегистрированный источник
// всё равно получает короткую попытку сборки, чтобы временный блок первой страницы не
// лишал рынок тысяч объявлений.
const sourceIdsForRebuild = [...activeSourceIds, ...inactiveSourceIds].join(",") || "__no_registered_sources__";
const payload = {
  version: 23,
  market,
  shardIndex,
  shardCount,
  checkedAt: new Date().toISOString(),
  timeoutMs,
  attempts,
  concurrency,
  registeredSourceCount: registered.length,
  plannedSourceIds: sourceIds,
  activeSourceIds,
  inactiveSourceIds,
  sourceIdsForRebuild,
  results,
};

await fs.writeFile(outputFile, JSON.stringify(payload, null, 2));
if (process.env.GITHUB_OUTPUT) {
  await fs.appendFile(process.env.GITHUB_OUTPUT, `source_ids=${sourceIdsForRebuild}\n`);
  await fs.appendFile(process.env.GITHUB_OUTPUT, `active_count=${activeSourceIds.length}\n`);
  await fs.appendFile(process.env.GITHUB_OUTPUT, `planned_count=${sourceIds.length}\n`);
}
console.log(JSON.stringify(payload, null, 2));
