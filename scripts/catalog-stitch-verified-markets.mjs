import crypto from "node:crypto";

const { getJsonStorage } = await import("../apps/web/lib/data.ts");
const { rebuildIndexes, offerPath, chunkName } = await import("../apps/web/lib/catalog/storage.ts");
const { CATALOG_CHUNK_SIZE, PUBLIC_CATALOG_MARKETS } = await import("../apps/web/lib/catalog/runtime-config.ts");

const sourceGeneration = String(process.env.CATALOG_STITCH_SOURCE_GENERATION || "").trim();
const markets = String(process.env.CATALOG_STITCH_MARKETS || "")
  .split(",").map((value) => value.trim()).filter(Boolean);
const expected = Object.fromEntries(String(process.env.CATALOG_STITCH_EXPECTED_COUNTS || "")
  .split(",").map((entry) => entry.trim()).filter(Boolean).map((entry) => {
    const [market, count] = entry.split("=");
    return [String(market || "").trim(), Number(count || 0)];
  }));

if (!sourceGeneration || !markets.length) throw new Error("catalog_stitch_inputs_missing");
if (markets.some((market) => !PUBLIC_CATALOG_MARKETS.includes(market))) throw new Error(`catalog_stitch_market_invalid:${markets.join(",")}`);

const storage = getJsonStorage();
const currentMeta = await storage.readJsonWithMeta("catalog/manifest.json", { version: 2, generationId: "", updatedAt: "", markets: {} });
if (!currentMeta.found || !currentMeta.etag || !currentMeta.value?.generationId) throw new Error("catalog_stitch_current_manifest_missing");
const current = currentMeta.value;

async function readMarket(generationId, market, chunks) {
  const result = [];
  for (const chunk of chunks) {
    const rows = await storage.readJson(offerPath(generationId, market, chunk), []);
    if (!Array.isArray(rows)) throw new Error(`catalog_stitch_chunk_invalid:${generationId}:${market}:${chunk}`);
    result.push(...rows);
  }
  return result;
}

async function readSourceMarket(market) {
  const count = Number(expected[market] || 0);
  if (!(count > 0)) throw new Error(`catalog_stitch_expected_count_missing:${market}`);
  const chunkCount = Math.ceil(count / CATALOG_CHUNK_SIZE);
  const chunks = Array.from({ length: chunkCount }, (_, index) => chunkName(index + 1));
  const rows = await readMarket(sourceGeneration, market, chunks);
  if (rows.length !== count) throw new Error(`catalog_stitch_source_count_mismatch:${market}:${rows.length}:${count}`);
  if (rows.some((offer) => String(offer?.market || "") !== market || !offer?.id || !offer?.make || !offer?.model || !Array.isArray(offer?.images) || !offer.images.length)) {
    throw new Error(`catalog_stitch_source_core_invalid:${market}`);
  }
  return rows;
}

const byMarket = new Map();
const beforeCounts = {};
for (const market of PUBLIC_CATALOG_MARKETS) {
  const manifestEntry = current.markets?.[market] || { count: 0, chunks: [] };
  const currentRows = await readMarket(current.generationId, market, manifestEntry.chunks || []);
  if (currentRows.length !== Number(manifestEntry.count || 0)) throw new Error(`catalog_stitch_current_count_mismatch:${market}:${currentRows.length}:${manifestEntry.count || 0}`);
  beforeCounts[market] = currentRows.length;
  byMarket.set(market, markets.includes(market) ? await readSourceMarket(market) : currentRows);
}

const generationId = `gen_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
const updatedAt = new Date().toISOString();
const manifestMarkets = {};
const byId = {};
const imagesById = {};
const allOffers = [];

for (const market of PUBLIC_CATALOG_MARKETS) {
  const rows = byMarket.get(market) || [];
  const chunks = [];
  for (let index = 0; index < rows.length; index += CATALOG_CHUNK_SIZE) {
    const name = chunkName(chunks.length + 1);
    chunks.push(name);
    const slice = rows.slice(index, index + CATALOG_CHUNK_SIZE);
    for (const offer of slice) {
      byId[offer.id] = { market, chunk: name };
      for (const image of offer.images || []) {
        if (!image?.id) continue;
        imagesById[image.id] = {
          objectKey: image.objectKey || "",
          mimeType: image.mimeType || "image/jpeg",
          checksum: image.checksum || "",
          size: Number(image.size || 0),
        };
      }
    }
    await storage.writeJson(offerPath(generationId, market, name), slice, { ifNoneMatch: "*" });
  }
  manifestMarkets[market] = { count: rows.length, chunks, updatedAt };
  allOffers.push(...rows);
}

await rebuildIndexes(generationId, allOffers, byId, imagesById);
const manifest = { version: 2, generationId, updatedAt, markets: manifestMarkets };
await storage.writeJson("catalog/manifest.json", manifest, { ifMatch: currentMeta.etag });

const afterCounts = Object.fromEntries(PUBLIC_CATALOG_MARKETS.map((market) => [market, Number(manifestMarkets[market]?.count || 0)]));
for (const market of markets) {
  if (afterCounts[market] !== Number(expected[market])) throw new Error(`catalog_stitch_final_count_mismatch:${market}:${afterCounts[market]}:${expected[market]}`);
}
for (const market of PUBLIC_CATALOG_MARKETS) {
  if (markets.includes(market)) continue;
  if (afterCounts[market] !== beforeCounts[market]) throw new Error(`catalog_stitch_preservation_mismatch:${market}:${afterCounts[market]}:${beforeCounts[market]}`);
}

console.log(JSON.stringify({
  mode: "verified_generation_market_stitch",
  published: true,
  sourceGeneration,
  replacedMarkets: markets,
  previousGeneration: current.generationId,
  generationId,
  beforeCounts,
  afterCounts,
}, null, 2));
