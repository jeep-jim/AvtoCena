import fs from "node:fs/promises";

const { catalogImportSources } = await import("../apps/web/lib/catalog/importer.ts");

const market = String(process.env.CATALOG_REBUILD_MARKET || "").trim();
const shardIndex = Math.max(0, Number(process.env.CATALOG_REBUILD_SHARD_INDEX || 0));
const shardCount = Math.max(1, Number(process.env.CATALOG_REBUILD_SHARD_COUNT || 1));
const timeoutMs = Math.max(3_000, Number(process.env.CATALOG_PROBE_TIMEOUT_MS || 12_000));
const outputFile = process.env.CATALOG_PROBE_OUTPUT || `catalog-probe-${market}-${shardIndex}.json`;

const sourcePlan = {
  korea: ["encar_direct", "kcar_korea_open"],
  china: ["guazi_china_open", "che168_china_exact", "guazi_china_export", "dongchedi_china_open", "autohome_used_china_open", "autohome_new_china_open"],
  japan: ["carused_japan_open", "tcv_japan_open", "goonet_japan_exact", "goonet_japan", "beforward_japan", "jpcenter_japan_catalog_open"],
  uae: ["dubicars_uae_exact", "dubizzle_uae_open", "dubicars_clean", "beforward_uae"],
  europe: ["mobile_de_open", "autoscout_europe_open", "otomoto_europe_exact", "otomoto_pl_open", "autouncle_europe"],
  georgia: ["myauto_georgia_exact", "autopapa_georgia_open"],
  kyrgyzstan: ["mashina_kyrgyzstan_exact"],
};

if (!Object.prototype.hasOwnProperty.call(sourcePlan, market)) {
  throw new Error(`unsupported_probe_market_${market || "missing"}`);
}

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

async function probe(sourceId, adapters) {
  const source = adapters.get(sourceId);
  const startedAt = Date.now();
  if (!source) {
    return { sourceId, active: false, reason: "source_not_found", durationMs: Date.now() - startedAt, fetched: 0, usable: 0 };
  }

  try {
    const result = await withTimeout(source.fetchPage(null), sourceId);
    const rows = Array.isArray(result?.items) ? result.items : [];
    let usable = 0;
    for (const row of rows.slice(0, 50)) {
      try {
        if (isUsableOffer(source.normalizeOffer(row), sourceId)) usable++;
      } catch {
        // Одна сломанная карточка не делает весь источник мёртвым.
      }
    }
    return {
      sourceId,
      active: usable > 0,
      reason: usable > 0 ? "live" : rows.length ? "no_usable_offers" : "empty_page",
      durationMs: Date.now() - startedAt,
      fetched: rows.length,
      usable,
      nextCursor: result?.nextCursor || null,
      health: result?.health || null,
    };
  } catch (error) {
    return {
      sourceId,
      active: false,
      reason: "probe_failed",
      durationMs: Date.now() - startedAt,
      fetched: 0,
      usable: 0,
      error: String(error?.message || error),
    };
  }
}

const adapters = new Map(catalogImportSources.map((source) => [source.sourceId, source]));
const configured = String(process.env.CATALOG_PROBE_SOURCE_IDS || "").split(",").map((value) => value.trim()).filter(Boolean);
const planned = configured.length ? configured : sourcePlan[market];
const sourceIds = [...new Set(planned)].filter((sourceId) => stableShard(sourceId) === shardIndex);
const results = await Promise.all(sourceIds.map((sourceId) => probe(sourceId, adapters)));
const activeSourceIds = results.filter((row) => row.active).map((row) => row.sourceId);
const sourceIdsForRebuild = activeSourceIds.length ? activeSourceIds.join(",") : "__no_live_sources__";
const payload = {
  version: 20,
  market,
  shardIndex,
  shardCount,
  checkedAt: new Date().toISOString(),
  timeoutMs,
  plannedSourceIds: sourceIds,
  activeSourceIds,
  sourceIdsForRebuild,
  results,
};

await fs.writeFile(outputFile, JSON.stringify(payload, null, 2));
if (process.env.GITHUB_OUTPUT) {
  await fs.appendFile(process.env.GITHUB_OUTPUT, `source_ids=${sourceIdsForRebuild}\n`);
  await fs.appendFile(process.env.GITHUB_OUTPUT, `active_count=${activeSourceIds.length}\n`);
}
console.log(JSON.stringify(payload, null, 2));
