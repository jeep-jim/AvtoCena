import crypto from "node:crypto";

const { getJsonStorage, StorageConflictError } = await import("../apps/web/lib/data.ts");
const { PUBLIC_CATALOG_MARKETS } = await import("../apps/web/lib/catalog/runtime-config.ts");

if (process.env.CATALOG_RESET_CONFIRM !== "RESET_PUBLIC_CATALOG") {
  throw new Error("catalog_reset_confirmation_missing");
}

const storage = getJsonStorage();
let deletedObjects = 0;
if (storage.deletePrefix) {
  deletedObjects = await storage.deletePrefix("catalog");
} else {
  throw new Error("catalog_storage_delete_prefix_unavailable");
}

const now = new Date().toISOString();
const generationId = `empty_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
const generationRoot = `catalog/generations/${generationId}`;
const markets = Object.fromEntries(PUBLIC_CATALOG_MARKETS.map((market) => [
  market,
  { count: 0, chunks: [], updatedAt: now },
]));

await storage.writeJson(`${generationRoot}/indexes/facets.json`, {
  generationId,
  makes: [],
  models: [],
  markets: [...PUBLIC_CATALOG_MARKETS],
  bodyTypes: [],
  fuels: [],
  transmissions: [],
  drives: [],
});
await storage.writeJson(`${generationRoot}/indexes/order-updatedAt.json`, { generationId, ids: [] });
await storage.writeJson(`${generationRoot}/indexes/offers-by-id.json`, { generationId, byId: {} });
await storage.writeJson(`${generationRoot}/indexes/images-by-id.json`, { generationId, imagesById: {} });

const manifest = {
  version: 2,
  generationId,
  updatedAt: now,
  markets,
};

let published = false;
for (let attempt = 0; attempt < 8 && !published; attempt++) {
  const current = await storage.readJsonWithMeta("catalog/manifest.json", null);
  try {
    await storage.writeJson(
      "catalog/manifest.json",
      manifest,
      current.found && current.etag ? { ifMatch: current.etag } : { ifNoneMatch: "*" },
    );
    published = true;
  } catch (error) {
    if (!(error instanceof StorageConflictError) || attempt === 7) throw error;
    await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
  }
}

await storage.writeJson("catalog/internal/manifest.json", {
  generationId,
  updatedAt: now,
  sources: {},
});

console.log(JSON.stringify({
  reset: true,
  generationId,
  total: 0,
  deletedObjects,
  markets: Object.fromEntries(PUBLIC_CATALOG_MARKETS.map((market) => [market, 0])),
  oldCatalogAndStoredPhotosDeleted: true,
  imageStorageForNewRun: "json_source_urls_only",
}, null, 2));
