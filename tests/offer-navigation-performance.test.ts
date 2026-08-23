import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const page = fs.readFileSync("apps/web/app/(public)/cars/offer/[id]/page.tsx", "utf8");
const layout = fs.readFileSync("apps/web/app/(public)/cars/offer/[id]/layout.tsx", "utf8");
const loading = fs.readFileSync("apps/web/app/(public)/cars/offer/[id]/loading.tsx", "utf8");
const data = fs.readFileSync("apps/web/lib/catalog/offer-page-data.ts", "utf8");
const storage = fs.readFileSync("apps/web/lib/catalog/storage.ts", "utf8");
const preloader = fs.readFileSync("apps/web/components/layout/RoutePreloader.tsx", "utf8");
const card = fs.readFileSync("apps/web/components/catalog/CatalogCard.tsx", "utf8");
const intentLink = fs.readFileSync("apps/web/components/catalog/IntentPrefetchLink.tsx", "utf8");
const deploy = fs.readFileSync(".github/workflows/deploy-yandex.yml", "utf8");
const effectiveMarkets = fs.readFileSync("apps/web/lib/effective-market-settings.ts", "utf8");
const readModelsWorkflow = fs.readFileSync(".github/workflows/catalog-current-read-models.yml", "utf8");
const readModelsScript = fs.readFileSync("scripts/catalog-publish-current-read-models.mjs", "utf8");
const catalogPage = fs.readFileSync("apps/web/app/(public)/cars/page.tsx", "utf8");
const vehicleGallery = fs.readFileSync("apps/web/components/catalog/VehicleGallery.tsx", "utf8");

test("offer navigation swaps the catalog for an immediate route skeleton", () => {
  assert.match(loading, /main className="ac-offer-page/);
  assert.match(loading, /aria-busy="true"/);
  assert.match(loading, /Загружаем карточку автомобиля/);
});

test("similar offers stream after the primary offer instead of blocking it", () => {
  const offerPage = page.slice(page.indexOf("export default async function OfferPage"));
  const beforeReturn = offerPage.slice(0, offerPage.indexOf("return <main"));
  assert.doesNotMatch(beforeReturn, /await searchOffers/);
  assert.match(page, /<Suspense fallback=\{<SimilarOffersFallback \/>\}>/);
  assert.match(page, /async function SimilarOffers/);
  assert.match(page, /make: current\.make, model: current\.model/);
  assert.match(page, /Ещё \{modelTitle\}/);
  assert.doesNotMatch(page, /const fillers = diverseSimilarOffers/);
  assert.match(page, /<CatalogMarketFlag market=\{String\(current\.market/);
  assert.match(page, /· \{marketTotal\}/);
  assert.match(page, /new URLSearchParams\(\{ market: String\(current\.market \|\| ""\), make: String\(current\.make \|\| ""\), model: String\(current\.model \|\| ""\) \}\)/);
});

test("metadata and page share one memoized offer lookup per request", () => {
  assert.match(data, /unstable_cache\(/);
  assert.match(data, /catalog-offer-page-v1/);
  assert.match(data, /revalidate: 60/);
  assert.match(data, /async function resilientOfferLookup/);
  assert.match(data, /return getOffer\(id\)/);
  assert.match(data, /cache\(\(id: string\) => resilientOfferLookup\(id\)\)/);
  assert.match(page, /getOfferForPage\(id\)/);
  assert.match(layout, /getOfferForPage\(id\)/);
});

test("offer navigation stays visibly pending and warms only the intended offer", () => {
  assert.match(preloader, /MAX_VISIBLE_MS = 15000/);
  assert.match(card, /<IntentPrefetchLink href=\{href\}/);
  assert.match(intentLink, /prefetch=\{false\}/);
  assert.match(intentLink, /router\.prefetch\(href\)/);
  assert.match(intentLink, /onPointerEnter=\{prefetch\}/);
  assert.match(intentLink, /onTouchStart=\{prefetch\}/);
  assert.match(intentLink, /EAGER_PREFETCH_DELAY_MS = 120/);
  assert.match(intentLink, /window\.setTimeout\(prefetch, EAGER_PREFETCH_DELAY_MS\)/);
  assert.match(catalogPage, /eagerPrefetch=\{marketIndex === 0 && index < 4\}/);
  assert.match(storage, /offerLocationIndexCache/);
  assert.match(storage, /offerChunkCache/);
  assert.match(storage, /currentOfferShardCache/);
  assert.match(storage, /catalog\/public\/offers/);
  assert.match(storage, /offerLookupCacheGeneration !== manifest\.generationId/);
  assert.match(storage, /CATALOG_MANIFEST_CACHE_MS \|\| 60_000/);
});

test("production keeps one warm container and serves navigation bursts in-process", () => {
  assert.match(deploy, /revision-memory: 2Gb/);
  assert.match(deploy, /revision-concurrency: 4/);
  assert.match(deploy, /revision-provisioned: 1/);
  assert.match(deploy, /Warm public catalog and verify AI discovery/);
  assert.match(deploy, /cars\/offer\/\$offer_id/);
});

test("market run markers do not rebuild and redeploy the web container", () => {
  assert.match(deploy, /paths-ignore:[\s\S]*\.github\/market-runs\/\*\*/);
});

test("catalog pricing shares one short-lived market-settings read", () => {
  assert.match(effectiveMarkets, /EFFECTIVE_MARKETS_CACHE_MS/);
  assert.match(effectiveMarkets, /getCachedMarketsSettings\(\)/);
  assert.match(effectiveMarkets, /selectActiveMarketVersion\(market\)/);
  assert.doesNotMatch(effectiveMarkets, /Promise\.all\(MARKET_IDS\.map/);
});

test("catalog reads a current one-hop projection before generation indexes", () => {
  assert.match(storage, /catalog\/public\/projection/);
  assert.match(storage, /CURRENT_ALL_MARKETS_PROJECTION = "all"/);
  assert.match(storage, /CURRENT_FACETS_PATH/);
  assert.match(storage, /readCurrentSearchProjection\(currentProjectionScope\)/);
  assert.match(storage, /currentProjectionPath\(CURRENT_ALL_MARKETS_PROJECTION\)/);
  assert.match(storage, /current\.generationId === manifest\.generationId/);
  assert.match(storage, /writeJsonAtomic\(currentProjectionPath\(market\), \{ generationId, items: projectionsByMarket\.get\(market\) \|\| \[\] \}, false\)/);
  assert.match(storage, /export async function publishCurrentCatalogReadModels/);
  assert.match(readModelsScript, /publishCurrentCatalogReadModels/);
  assert.match(readModelsWorkflow, /Catalog live recovery · UAE \+ Kyrgyzstan/);
  assert.match(readModelsWorkflow, /Catalog live · daily working markets/);
  assert.match(readModelsWorkflow, /Catalog Japan · publish verified Prestige aggregate/);
  assert.match(readModelsWorkflow, /Catalog · apply certified 30-minute power/);
  assert.match(readModelsWorkflow, /group: catalog-live-daily-working-markets/);
});

test("catalog generation becomes public only after canonical identity and deduplication", () => {
  assert.match(storage, /const canonicalPublic = await canonicalizePublicCatalogOffers\(publicOffers, exactPreserveMarkets, protectedPublicIds\)/);
  assert.match(storage, /enforceCatalogModelYearQuota\(deduplicated\.rows, \{ protectedIds: protectedPublicIds \}\)/);
  assert.match(storage, /await rebuildIndexes\(generationId, publishedOffers, byId, imagesById\)/);
  const manifestSwitch = storage.indexOf('await storage.writeJson("catalog/manifest.json", manifest');
  const currentReadModelRefresh = storage.indexOf("await writeCurrentCatalogReadModels(generationId, publishedOffers, true)");
  assert.ok(manifestSwitch > 0);
  assert.ok(currentReadModelRefresh > 0);
  assert.ok(currentReadModelRefresh < manifestSwitch);
  assert.match(storage, /assertCurrentCatalogReadModelsReady\(generationId, publishedOffers\)/);
  assert.match(storage, /offersByCurrentShard/);
  assert.match(storage, /const actualIds = new Set\(\(shard\.items \|\| \[\]\)\.map\(\(item\) => item\.id\)\)/);
  assert.match(storage, /expectedOffers\.find\(\(offer\) => !actualIds\.has\(offer\.id\)\)/);
  assert.match(storage, /current\.generationId === manifest\.generationId/);
});

test("offer detail trusts already-published compact records and falls back when a current shard misses an id", () => {
  assert.match(storage, /const currentOffer = \(current\.items \|\| \[\]\)\.find\(\(item\) => item\.id === id\)/);
  assert.match(storage, /if \(currentOffer\) return currentOffer/);
  assert.match(storage, /return chunk\.find\(\(offer\) => offer\.id === id\) \|\| null/);
  assert.doesNotMatch(storage, /find\(\(item\) => item\.id === id && isPublicOffer\(item\)\)/);
  assert.doesNotMatch(storage, /find\(\(offer\) => offer\.id === id && isPublicOffer\(offer\)\)/);
});

test("offer page does not re-run source-only publication gates on compact public records", () => {
  assert.match(page, /if \(!offer\) notFound\(\)/);
  assert.doesNotMatch(page, /!offer \|\| !isCrediblePublicOffer\(offer\)/);
  assert.doesNotMatch(page, /!catalogPublicPriority\(raw\)\.eligible/);
});

test("catalog overview does not rescan every stored Japan offer", () => {
  assert.doesNotMatch(catalogPage, /readMarketOffers/);
  assert.match(catalogPage, /offer\?\.auctionDate \|\| offer\?\.auctionGrade/);
  assert.match(catalogPage, /searchOffers\(\{ market: market\.id/);
});

test("desktop offer galleries support mouse-wheel navigation", () => {
  assert.match(vehicleGallery, /const desktopThumbnailRail = useRef<HTMLDivElement \| null>\(null\)/);
  assert.match(vehicleGallery, /node\.scrollLeft \+= delta/);
  assert.match(vehicleGallery, /ref=\{desktopThumbnailRail\}/);
  assert.match(vehicleGallery, /const fullscreenRoot = useRef<HTMLDivElement \| null>\(null\)/);
  assert.match(vehicleGallery, /ref=\{fullscreenRoot\}/);
  assert.match(vehicleGallery, /lastFullscreenWheelAt/);
  assert.match(vehicleGallery, /window\.matchMedia\("\(pointer: fine\)"\)\.matches/);
  assert.match(vehicleGallery, /node\.addEventListener\("wheel", handleWheel, \{ passive: false \}\)/);
});
