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
const deploy = fs.readFileSync(".github/workflows/regcloud-deploy.yml", "utf8");
const deployRuntime = fs.readFileSync("scripts/regcloud-deploy-production.sh", "utf8");
const effectiveMarkets = fs.readFileSync("apps/web/lib/effective-market-settings.ts", "utf8");
const readModelsWorkflow = fs.readFileSync(".github/workflows/catalog-current-read-models.yml", "utf8");
const readModelsScript = fs.readFileSync("scripts/catalog-publish-current-read-models.mjs", "utf8");
const marketPage = fs.readFileSync("apps/web/lib/catalog/market-page.ts", "utf8");
const catalogPage = fs.readFileSync("apps/web/components/catalog/CatalogContent.tsx", "utf8");
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
  assert.match(page, /const familyModel/);
  assert.match(page, /new URLSearchParams/);
  assert.match(page, /Ещё \{modelTitle\}/);
  assert.doesNotMatch(page, /const fillers = diverseSimilarOffers/);
  assert.match(page, /<CatalogMarketFlag market=\{String\(current\.market/);
  assert.match(page, /marketTotal===null\?"—":marketTotal\.toLocaleString\("ru-RU"\)/);
  assert.match(page, /model: familyModel/);
});

test("metadata and page share one memoized offer lookup per request", () => {
  assert.match(data, /unstable_cache\(/);
  assert.match(data, /catalog-offer-page-publication-20261013/);
  assert.match(data, /revalidate: 60/);
  assert.match(data, /async function resilientOfferLookup/);
  assert.match(data, /return getOfferWithoutEditorial\(id\)/);
  assert.match(data, /cache\(async \(id: string\) => \{[\s\S]*resilientOfferLookup\(id\),readCatalogEditorial\(\)/);
  assert.match(data, /getOfferForPage\(id\)/);
  assert.match(layout, /readOfferDetailForPage\(id\)/);
});

test("offer navigation stays visibly pending and warms only the intended offer", () => {
  assert.match(preloader, /MAX_VISIBLE_MS = 15000/);
  assert.match(preloader, /if\(!mounted\)return null/);
  assert.match(card, /<IntentPrefetchLink href=\{href\}/);
  assert.match(intentLink, /prefetch=\{false\}/);
  assert.match(intentLink, /router\.prefetch\(href\)/);
  assert.match(intentLink, /onPointerEnter=\{hover\}/);
  assert.match(intentLink, /onPointerLeave=\{cancel\}/);
  assert.match(intentLink, /data-intent-prefetch="true"/);
  assert.match(preloader, /anchor.dataset.intentPrefetch==="true"/);
  assert.match(intentLink, /onPointerDown=\{event => \{ if \(event\.pointerType === "mouse"\) prefetch\(\); \}\}/);
  assert.match(intentLink, /onFocus=\{prefetch\}/);
  assert.doesNotMatch(intentLink, /onTouchStart=/);
  assert.doesNotMatch(intentLink, /EAGER_PREFETCH_DELAY_MS/);
  assert.match(intentLink, /setTimeout\(prefetch, 180\)/);
  assert.match(catalogPage, /eagerPrefetch=\{marketIndex === 0 && index < 4\}/);
  assert.match(storage, /offerLocationIndexCache/);
  assert.match(storage, /offerChunkCache/);
  assert.match(storage, /currentOfferShardCache/);
  assert.match(storage, /catalog\/public\/offers/);
  assert.match(storage, /offerLookupCacheGeneration !== manifest\.generationId/);
  assert.match(storage, /CATALOG_MANIFEST_CACHE_MS \|\| 60_000/);
  assert.match(page, /export const dynamic = "force-dynamic"/);
  assert.match(page, /export const revalidate = 0/);
});

test("REG production retains bounded resources and warms the candidate before activation", () => {
  assert.match(deploy, /regcloud-deploy-production\.sh/);
  assert.match(deployRuntime, /--restart unless-stopped/);
  assert.match(deployRuntime, /--memory 8g --cpus 2 --pids-limit 512/);
  assert.match(deployRuntime, /docker update --cpus 6 --memory 10g/);
  assert.match(deployRuntime, /regcloud-performance-gate\.py/);
  assert.match(deployRuntime, /for path in \['\/api\/health','\/','\/cars','\/'\]/);
  assert.match(deployRuntime, /releaseSha/);
});

test("non-runtime maintenance and documentation do not rebuild the web container", () => {
  assert.match(deploy, /push:\s*branches: \[main\]\s*paths: \['\.github\/market-runs\/regcloud-deploy\.json'\]/);
  assert.doesNotMatch(deploy.slice(0,deploy.indexOf('permissions:')), /apps\/web|scripts\/|tests\/|docs\/|roadmap\.md/);
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
  assert.doesNotMatch(readModelsWorkflow, /Kyrgyzstan|Кыргызстан/);
  assert.match(readModelsWorkflow, /Catalog live · daily working markets/);
  assert.match(readModelsWorkflow, /Catalog Japan · publish verified Prestige aggregate/);
  assert.match(readModelsWorkflow, /Catalog · apply certified 30-minute power/);
  assert.match(readModelsWorkflow, /group: catalog-live-daily-working-markets/);
});

test("catalog generation becomes public only after canonical identity and deduplication", () => {
  assert.match(storage, /const canonicalPublic = await canonicalizePublicCatalogOffers\(publicOffers, exactPreserveMarkets, protectedPublicIds, options\.retainedPowerMixIds, options\.retainedPowerMixMinimumByMarket\)/);
  assert.match(storage, /enforceCatalogModelYearQuota\(deduplicated\.rows, \{ protectedIds: protectedPublicIds \}\)/);
  assert.match(storage, /await rebuildIndexes\(generationId, publishedOffers, byId, imagesById\)/);
  const manifestSwitch = storage.indexOf('await storage.writeJson("catalog/manifest.json", manifest');
  const currentReadModelRefresh = storage.indexOf("await writeCurrentCatalogReadModels(generationId, publishedOffers, true)");
  assert.ok(manifestSwitch > 0);
  assert.ok(currentReadModelRefresh > 0);
  assert.ok(currentReadModelRefresh < manifestSwitch);
  assert.match(storage, /assertCurrentCatalogReadModelsReady\(generationId, publishedOffers\)/);
  const verifier=fs.readFileSync(new URL('../apps/web/lib/catalog/verify-read-models.ts',import.meta.url),'utf8');
  assert.match(storage, /await verifyCatalogReadModels\(getJsonStorage\(\),generationId/);
  assert.match(verifier, /boundedDetailShards\(rows,500\)/);
  assert.match(verifier, /expected\.items\.some\(row=>!ids\.has\(row\.id\)\)/);
  assert.match(storage, /current\.generationId === manifest\.generationId/);
});

test("offer detail trusts records admitted into the active immutable generation", () => {
  assert.match(storage, /const currentOffer = \(current\.items \|\| \[\]\)\.find\(\(item\) => item\.id === id\)/);
  assert.match(storage, /currentOffer && isActivePublicCatalogMarket\(currentOffer\.market\)/);
  assert.match(storage, /candidate\.id === id && isActivePublicCatalogMarket\(candidate\.market\)/);
  assert.doesNotMatch(storage, /currentOffer && publishedOfferCanRenderUnderCurrentPolicy\(currentOffer\)/);
  assert.doesNotMatch(storage, /find\(\(item\) => item\.id === id && isPublicOffer\(item\)\)/);
  assert.doesNotMatch(storage, /find\(\(offer\) => offer\.id === id && isPublicOffer\(offer\)\)/);
});

test("offer detail falls back to its active admitted projection instead of 404", () => {
  assert.match(storage, /function offerDetailFromProjection/);
  assert.match(storage, /function offerProjectionScopeFromId/);
  assert.match(storage, /"jpauc_japan_past_open"/);
  assert.match(storage, /export async function getOfferFromCurrentProjection/);
  assert.match(storage, /export async function getOfferFromCurrentShard/);
  assert.match(storage, /const projectionScope = offerProjectionScopeFromId\(id\)/);
  assert.match(storage, /let projection = await readCurrentSearchProjection\(projectionScope\)/);
  assert.match(storage, /if \(projection\.generationId !== manifest\.generationId\)/);
  assert.match(storage, /currentProjectionPath\(projectionScope\)/);
  assert.match(storage, /projection\.generationId !== manifest\.generationId/);
  assert.match(storage, /return row && !isConfirmedSourceWithdrawn\(row\) && catalogInventoryAgeDecision\(row\)\.eligible && !catalogVehicleExcluded\(row\) \? offerDetailFromProjection\(row\) : null/);
  assert.match(storage, /export function isJapanCatalogOfferId/);
  assert.match(data, /isJapanCatalogOfferId\(id\)/);
  assert.match(page, /await readOfferDetailForPage\(id\)/);
  assert.match(data, /offer:await getOfferDetailRecord\(id\)/);
  assert.match(data, /getOfferFromCurrentShard\(id\)[\s\S]*getOfferForPage\(id\)[\s\S]*getOfferFromCurrentProjection\(id\)/);
  assert.match(data, /getOfferForPage\(id\)[\s\S]*getOfferFromCurrentShard\(id\)[\s\S]*getOfferFromCurrentProjection\(id\)/);
  assert.match(layout, /normalizeVehicleOfferSpecs\(storedOffer\)/);
  assert.match(fs.readFileSync("apps/web/lib/catalog/offer-display-data.ts", "utf8"), /normalizeVehicleOfferSpecs\(enrichedOffer\)[\s\S]*publicOffer\(normalizedEnrichedOffer\)/);
  assert.doesNotMatch(page, /normalizeVehicleOfferSpecs\(publicOffer\(enrichedOffer\)\)/);
  // Complete-index absence and incomplete-index recovery are exercised with
  // real storage fixtures in catalog-missing-offer-lookup.test.ts.
  assert.match(storage, /return offer \? \(isConfirmedSourceWithdrawn\(offer\) \|\| !catalogInventoryAgeDecision\(offer\)\.eligible \|\| catalogVehicleExcluded\(offer\) \? null : offer\) : readProjectionFallback\(\)/);
  assert.match(page, /<main[^>]*data-offer-id=\{o\.id\}/);
  assert.match(page, /decodeURIComponent\(routeId\)/);
  assert.match(data, /catalog-offer-page-publication-20261013/);
});

test("offer actions retain stable page slots when the mobile contact floats", () => {
  const actions = fs.readFileSync(new URL("../apps/web/components/catalog/OfferContactActions.tsx", import.meta.url), "utf8");
  const carsLayout = fs.readFileSync(new URL("../apps/web/app/(public)/cars/layout.tsx", import.meta.url), "utf8");
  assert.match(page, /<OfferDesktopActions position="below" offerId=/);
  assert.match(page, /<OfferMobileActions offerId=/);
  assert.match(page, /<OfferCreditCalculator \/>/);
  // Scroll positioning is covered in entrance-flow.mjs; the SSR slot must stay mounted.
  assert.match(actions, /ref=\{anchor\} className="ac-offer-contact-anchor"/);
  assert.match(actions, /\{!floating&&bar\}/);
  assert.match(actions, /floating&&createPortal/);
  assert.match(actions, /const rect=node\.getBoundingClientRect\(\)/);
  assert.doesNotMatch(actions, /document\.createElement/);
  assert.doesNotMatch(carsLayout, /OfferContactActions/);
});

test("offer page does not re-run source-only publication gates on compact public records", () => {
  assert.match(page, /if \(!storedOffer\) return <UnavailableOffer/);
  assert.match(page, /if \(!retro && !directScenario && !savedCalculation && !visibleRub && !selectionRequired && !sellerPricing && !isPriceOnRequestDubicarsOffer\(raw\)\) return <UnavailableOffer/);
  assert.doesNotMatch(page, /notFound\(\)/);
  assert.doesNotMatch(page, /!offer \|\| !isCrediblePublicOffer\(offer\)/);
  assert.doesNotMatch(page, /!catalogPublicPriority\(raw\)\.eligible/);
});

test("catalog overview and market diversity stay on bounded search projections", () => {
  assert.doesNotMatch(catalogPage, /readMarketOffers/);
  assert.match(marketPage, /MARKET_DIVERSITY_WINDOW_PAGES = 8/);
  assert.match(marketPage, /readDiverseDefaultMarketPage/);
  assert.match(marketPage, /pageSize: MARKET_PAGE_SIZE \* MARKET_DIVERSITY_WINDOW_PAGES/);
  assert.match(catalogPage, /readPublicCatalogOverview/);
  const overview=fs.readFileSync('apps/web/lib/catalog/editorial-overview.ts','utf8');
  assert.match(overview, /readCatalogOverview/);
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
