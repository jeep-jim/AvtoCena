import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { catalogImportSources } from "../apps/web/lib/catalog/importer";
import { scaleMarketSources } from "../apps/web/lib/catalog/scale-market-sources";
import { japanTransitAuctionStatisticsSource } from "../apps/web/lib/catalog/japan-auction-statistics-source";
import {
  CATALOG_FUTURE_USA_ANCHORS,
  CATALOG_V2_SOURCE_SLOTS,
} from "../apps/web/lib/catalog/catalog-v2-source-registry";
import {
  CATALOG_DAILY_TARGET_PER_SOURCE,
  CATALOG_MAX_PUBLIC_OFFERS_PER_MARKET,
  CATALOG_RETENTION_MS,
  PUBLIC_CATALOG_MARKETS,
} from "../apps/web/lib/catalog/runtime-config";

const probeScript = fs.readFileSync(new URL("../scripts/catalog-probe-source-shard.mjs", import.meta.url), "utf8");
const rebuildScript = fs.readFileSync(new URL("../scripts/catalog-rebuild-source-shard.mjs", import.meta.url), "utf8");
const publishScript = fs.readFileSync(new URL("../scripts/catalog-publish-source-scale.mjs", import.meta.url), "utf8");
const validationScript = fs.readFileSync(new URL("../scripts/catalog-validate-source-scale.mjs", import.meta.url), "utf8");
const workflow = fs.readFileSync(new URL("../.github/workflows/catalog-v2-production.yml", import.meta.url), "utf8");
const reliableSources = fs.readFileSync(new URL("../apps/web/lib/catalog/reliable-bootstrap-sources.ts", import.meta.url), "utf8");
const regionalOverrides = fs.readFileSync(new URL("../apps/web/lib/catalog/regional-live-overrides.ts", import.meta.url), "utf8");
const livePricing = fs.readFileSync(new URL("../apps/web/lib/catalog/live-business-pricing.ts", import.meta.url), "utf8");
const imageQuality = fs.readFileSync(new URL("../apps/web/lib/catalog/image-quality.ts", import.meta.url), "utf8");
const brandRail = fs.readFileSync(new URL("../apps/web/components/catalog/BrandLogoRail.tsx", import.meta.url), "utf8");
const catalogCard = fs.readFileSync(new URL("../apps/web/components/catalog/CatalogCard.tsx", import.meta.url), "utf8");
const brandPage = fs.readFileSync(new URL("../apps/web/app/(public)/cars/brand/[slug]/page.tsx", import.meta.url), "utf8");
const modelPage = fs.readFileSync(new URL("../apps/web/app/(public)/cars/brand/[slug]/model/[model]/page.tsx", import.meta.url), "utf8");
const sitemap = fs.readFileSync(new URL("../apps/web/app/sitemap.xml/route.ts", import.meta.url), "utf8");
const offerQuality = fs.readFileSync(new URL("../apps/web/lib/catalog/offer-quality.ts", import.meta.url), "utf8");
const publicPriority = fs.readFileSync(new URL("../apps/web/lib/catalog/public-priority.ts", import.meta.url), "utf8");
const galleryWrapper = fs.readFileSync(new URL("../apps/web/lib/catalog/full-gallery-wrapper.ts", import.meta.url), "utf8");
const flatUi = fs.readFileSync(new URL("../apps/web/app/flat-ui.css", import.meta.url), "utf8");
const storage = fs.readFileSync(new URL("../apps/web/lib/catalog/storage.ts", import.meta.url), "utf8");
const carsPage = fs.readFileSync(new URL("../apps/web/app/(public)/cars/page.tsx", import.meta.url), "utf8");
const dealerDemo = fs.readFileSync(new URL("../apps/web/components/dealers/DealerDemoDashboard.tsx", import.meta.url), "utf8");
const japanOpenSources = fs.readFileSync(new URL("../apps/web/lib/catalog/japan-auction-open-sources.ts", import.meta.url), "utf8");

test("source-scale catalog supports 100000 verified offers per source and market", () => {
  assert.equal(CATALOG_DAILY_TARGET_PER_SOURCE, 100_000);
  assert.equal(CATALOG_MAX_PUBLIC_OFFERS_PER_MARKET, 100_000);
  assert.equal(CATALOG_RETENTION_MS, 3 * 24 * 60 * 60 * 1_000);
  assert.match(rebuildScript, /minimumMarketTarget/);
  assert.match(rebuildScript, /targetPerSource/);
  assert.match(publishScript, /targetPerMarket/);
  assert.match(publishScript, /marketsBelowTarget/);
  assert.match(validationScript, /marketTargetReached/);
  assert.doesNotMatch(publishScript, /selected\.length >= target\b/);
});

test("Catalog V2 runs all 35 market shards in one wave", () => {
  assert.match(workflow, /group: catalog-v2-production/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /max-parallel: 20/);
  assert.match(workflow, /shard: \[0, 1, 2, 3, 4\]/);
  assert.match(workflow, /CATALOG_REBUILD_SHARD_COUNT: "5"/);
  assert.doesNotMatch(workflow, /^\s*pull_request:/m);
});

test("Catalog V2 uses canonical sources, 100000 capacity and progressive galleries", () => {
  assert.match(workflow, /market: \[korea, china, japan, uae, europe, georgia, kyrgyzstan\]/);
  assert.match(workflow, /CATALOG_REBUILD_TARGET_PER_SOURCE: "100000"/);
  assert.match(workflow, /CATALOG_REBUILD_TARGET_PER_MARKET: "100000"/);
  assert.match(workflow, /CATALOG_PUBLISH_TARGET_PER_MARKET: "100000"/);
  assert.match(workflow, /CATALOG_PUBLISH_MAX_PER_MARKET: "100000"/);
  assert.match(workflow, /CATALOG_V2_HARD_MAX_TOTAL_RUB: "100000000"/);
  assert.match(workflow, /CATALOG_PUBLISH_MIN_PRODUCTIVE_SOURCES: "1"/);
  assert.match(workflow, /CATALOG_OFFER_RETENTION_MS: "259200000"/);
  assert.match(workflow, /CATALOG_REBUILD_MIN_IMAGES_PER_OFFER: "1"/);
  assert.match(workflow, /CATALOG_REBUILD_PREFERRED_IMAGES_PER_OFFER: "30"/);
  assert.match(workflow, /CATALOG_MAX_IMAGES_PER_OFFER: "30"/);
  assert.match(workflow, /CATALOG_COLLECTION_IMAGE_LIMIT: "30"/);
  assert.match(workflow, /CATALOG_REBUILD_RESET_CURSOR: "0"/);
  assert.match(workflow, /CATALOG_REBUILD_MAX_PAGES_PER_SOURCE: "100000"/);
  assert.match(workflow, /CATALOG_REBUILD_MAX_TOTAL_PAGES: "1000000"/);
  assert.match(workflow, /CATALOG_REBUILD_MAX_EMPTY_PAGES: "1000"/);
  assert.match(workflow, /CATALOG_REBUILD_MAX_SOURCE_ERRORS: "8"/);
  assert.match(workflow, /CATALOG_REBUILD_DETAIL_LIMIT_PER_SOURCE: "100000"/);
  assert.match(workflow, /CATALOG_REBUILD_PREPARE_CONCURRENCY: "30"/);
  assert.match(workflow, /CATALOG_REBUILD_TIME_LIMIT_MS: "6300000"/);
  assert.match(workflow, /CATALOG_PRIORITY_MAX_TOTAL_RUB: "6000000"/);
  assert.match(workflow, /CATALOG_PRIORITY_MAX_POWER_HP: "160"/);
  assert.match(workflow, /CATALOG_PRIORITY_MAX_AGE_YEARS: "6"/);
  assert.match(workflow, /retention-days: 1/);
  assert.match(workflow, /compression-level: 9/);
  assert.match(workflow, /Catalog V2 health/);
  assert.match(workflow, /cron: "17 20 \* \* \*"/);
});

test("large collection persists candidate pools instead of discarding incomplete records", () => {
  assert.match(rebuildScript, /catalog\/source-candidates/);
  assert.match(rebuildScript, /readChunkedDataJson/);
  assert.match(rebuildScript, /replaceChunkedDataJson/);
  assert.match(rebuildScript, /candidateCount/);
  assert.match(rebuildScript, /publishEligibleCount/);
  assert.match(rebuildScript, /candidateRejectionReasons/);
  assert.match(rebuildScript, /candidatePoolsLoaded/);
  assert.match(rebuildScript, /candidatePoolsPersisted/);
  assert.doesNotMatch(rebuildScript, /filter\(\(offer\) => classifyCatalogV2Offer\(offer\)\.eligible\)/);
});

test("canonical anchor sites are fixed for all seven markets and USA remains future", () => {
  const urls = (market: keyof typeof CATALOG_V2_SOURCE_SLOTS) => new Set(CATALOG_V2_SOURCE_SLOTS[market].map((source) => source.canonicalUrl));
  assert.deepEqual([...urls("uae")].filter((url) => /dubizzle|dubicars/.test(url)), ["https://uae.dubizzle.com/", "https://www.dubicars.com/"]);
  assert.ok(urls("korea").has("https://www.encar.com/"));
  assert.ok(urls("korea").has("https://www.kcar.com/"));
  assert.ok(urls("europe").has("https://www.mobile.de/"));
  assert.ok(urls("europe").has("https://www.autoscout24.com/"));
  assert.ok(urls("georgia").has("https://www.myauto.ge/"));
  assert.ok(urls("georgia").has("https://autopapa.ge/"));
  assert.ok(urls("china").has("https://www.che168.com/"));
  assert.ok(urls("china").has("https://www.dongchedi.com/"));
  assert.ok(urls("china").has("https://www.guazi.com/"));
  assert.equal(CATALOG_V2_SOURCE_SLOTS.china.find((source) => source.canonicalUrl === "https://www.autohome.com.cn/")?.role, "primary");
  assert.ok(urls("japan").has("https://jpauc.com/auction/past"));
  assert.ok(urls("japan").has("https://carvector.com/stat"));
  assert.ok(urls("japan").has("https://prestigemotorsport.com.au/auctions/"));
  assert.ok(urls("japan").has("https://www.auctiondatasearch.jp/"));
  assert.equal(CATALOG_V2_SOURCE_SLOTS.japan.find((source) => source.sourceId === "jpcenter_japan_catalog_open")?.role, "primary");
  assert.ok(urls("kyrgyzstan").has("https://www.mashina.kg/"));
  assert.deepEqual(CATALOG_FUTURE_USA_ANCHORS.map((source) => source.canonicalUrl), ["https://stat.vin/", "https://bid.cars/", "https://auctionstat.com/"]);
});

test("all seven markets have at least three independent registered adapters", () => {
  const byMarket = new Map(PUBLIC_CATALOG_MARKETS.map((market) => [market, new Set<string>()]));
  for (const source of catalogImportSources) {
    if (source.market === "multi") continue;
    byMarket.get(source.market)?.add(source.sourceId);
  }
  for (const market of PUBLIC_CATALOG_MARKETS) {
    const minimum = market === "georgia" ? 2 : 3;
    assert.ok((byMarket.get(market)?.size || 0) >= minimum, `${market} must have at least ${minimum} registered sources`);
  }
  assert.ok((byMarket.get("japan")?.size || 0) >= 10, "Japan must use the expanded source registry");
  assert.ok((byMarket.get("china")?.size || 0) >= 8, "China must use the expanded source registry");
  assert.ok((byMarket.get("europe")?.size || 0) >= 8, "Europe must use the expanded source registry");
});

test("Japan auction sources use real listing and detail routes", () => {
  const ids = new Set(catalogImportSources.map((source) => source.sourceId));
  for (const sourceId of ["jpauc_japan_current_open", "jpauc_japan_past_open", "carvector_japan_stat_open", "prestige_japan_auctions_open", "auctiondatasearch_japan_open", "japantransit_japan_stat_open"]) {
    assert.equal(ids.has(sourceId), true, `${sourceId} must be registered`);
  }
  assert.match(japanOpenSources, /https:\/\/jpauc\.com\/auction\/listing/);
  assert.match(japanOpenSources, /\\\/auction\\\/detail\\\/\\d\+/);
  assert.match(japanOpenSources, /https:\/\/www\.auctiondatasearch\.jp\//);
});

test("Japan Transit sold-auction statistics participates in the production registry", () => {
  const ids = new Set(catalogImportSources.map((source) => source.sourceId));
  assert.equal(japanTransitAuctionStatisticsSource.sourceId, "japantransit_japan_stat_open");
  assert.equal(japanTransitAuctionStatisticsSource.market, "japan");
  assert.equal(ids.has("japantransit_japan_stat_open"), true);
  assert.match(carsPage, /Аукционная статистика/);
  assert.doesNotMatch(carsPage, /Аукционная статистика Японии/);
  assert.match(carsPage, /isJapanAuctionResult/);
});

test("probe keeps mandatory sources in network work while optional sources still require a live probe", () => {
  assert.match(probeScript, /catalogImportSources\s*\.filter/);
  assert.match(probeScript, /registeredSourceCount/);
  assert.match(probeScript, /requiredSourceIdsForShard/);
  assert.match(probeScript, /sourceIdsForRebuildList = \[\.\.\.new Set\(\[\.\.\.requiredSourceIdsForShard, \.\.\.activeSourceIds\]\)\]/);
  assert.match(probeScript, /sourceIdsForRebuild = sourceIdsForRebuildList\.join/);
  assert.match(rebuildScript, /catalogImportSources\s*\.filter/);
  assert.match(rebuildScript, /retentionSourceIds/);
  assert.match(rebuildScript, /liveSourceIds/);
  assert.match(rebuildScript, /probe_inactive/);
  assert.doesNotMatch(rebuildScript, /const allSources/);
});

test("rebuild calculates first and progressively opens detail without exhausting the run", () => {
  assert.match(rebuildScript, /retention_loaded/);
  assert.match(rebuildScript, /readMarketOffers/);
  assert.match(rebuildScript, /readAllOffersForMaintenance/);
  assert.match(rebuildScript, /catalog\/source-cursors/);
  assert.match(rebuildScript, /storage\.readJson/);
  assert.match(rebuildScript, /storage\.writeJson/);
  assert.match(rebuildScript, /offer = normalizeVehicleOfferSpecs\(await enrichOfferWithKnowledgeCore\(offer\)\)/);
  assert.match(rebuildScript, /calculateSafely\(offer, "calculation_before_detail"\)/);
  assert.match(rebuildScript, /detailLimitPerSource/);
  assert.match(rebuildScript, /reserveDetail/);
  assert.match(rebuildScript, /detailDeferredBySource/);
  assert.match(rebuildScript, /priorityGalleryMissing/);
  assert.match(rebuildScript, /source\.fetchImages\(offer\)/);
  assert.match(rebuildScript, /galleryEnrichmentStatus/);
  assert.match(rebuildScript, /imageStats/);
  assert.match(rebuildScript, /networkImageLimit/);
  assert.match(rebuildScript, /retention_plus_fresh_listing/);
  assert.match(rebuildScript, /galleriesAccumulated/);
  assert.match(rebuildScript, /compareCatalogPublicPriority/);
  assert.match(rebuildScript, /previous\?\.images/);
  assert.doesNotMatch(rebuildScript, /reject\("calculation"\); return null/);
});

test("real listings stay public while exact customs calculation is pending", () => {
  assert.match(offerQuality, /return offer\.status === "active" && credibleCoreContent\(offer, false\)/);
  assert.doesNotMatch(offerQuality, /Boolean\(offer\.totalRub\)/);
  assert.doesNotMatch(storage, /hasCredibleOfferContent\(o\) && Boolean\(o\.totalRub\)/);
  assert.doesNotMatch(carsPage, /Boolean\(offer\.totalRub\) && isCrediblePublicOffer/);
  assert.match(publishScript, /calculationPending/);
  assert.match(rebuildScript, /calculationStatus: "needs_data"/);
});

test("cards convert source prices to rubles while customs calculation is pending", () => {
  assert.match(livePricing, /convertToRub/);
  assert.match(livePricing, /attachCurrentCurrencyRate/);
  assert.match(livePricing, /sourcePriceRub: rate\.sourcePriceRub/);
  assert.match(catalogCard, /catalogOfferVisibleRub/);
  assert.match(catalogCard, /const visibleRub = catalogOfferVisibleRub\(normalizedOffer\)/);
  assert.match(catalogCard, /totalRub: visibleRub \|\| null/);
  assert.match(catalogCard, /<CatalogPrice offer=\{displayOffer\} label=\{priceLabel\}/);
  assert.doesNotMatch(catalogCard, /function sourceMoney/);
  assert.doesNotMatch(catalogCard, /Цена в объявлении/);
  assert.doesNotMatch(catalogCard, /Цена торгов/);
});

test("public cards use the stable same-origin image proxy", () => {
  assert.match(imageQuality, /\/api\/catalog\/images\//);
  assert.match(imageQuality, /encodeURIComponent\(id\)/);
  assert.match(imageQuality, /stablePublicImageUrl/);
});

test("dealer CRM renders SVG market flags rather than emoji letter codes", () => {
  assert.match(dealerDemo, /function MarketFlag/);
  assert.match(dealerDemo, /Флаг Кыргызстана/);
  assert.doesNotMatch(dealerDemo, /<span className="text-2xl">\{market\.flag\}<\/span>/);
});

test("requested high-volume public sources are registered", () => {
  const ids = new Set(scaleMarketSources.map((source) => source.sourceId));
  for (const sourceId of [
    "autowini_korea_open",
    "kbchachacha_korea_open",
    "bobaedream_korea_open",
    "kcar_korea_open",
    "dubizzle_uae_open",
    "yallamotor_uae_open",
    "carswitch_uae_open",
    "autopapa_georgia_open",
    "lalafo_kyrgyzstan_open",
    "bazar_kyrgyzstan_open",
    "turbo_kyrgyzstan_open",
    "omarket_kyrgyzstan_open",
    "jpauc_japan_past_open",
    "carvector_japan_stat_open",
    "jpcenter_japan_catalog_open",
    "prestige_japan_auctions_open",
  ]) {
    assert.equal(ids.has(sourceId), true, `${sourceId} must be registered`);
  }
  for (const sourceId of ["auto_georgia_open", "ss_georgia_open", "mymarket_georgia_open"]) {
    assert.equal(ids.has(sourceId), false, `${sourceId} must remain banned`);
  }
});

test("bootstrap replacements follow current regional public routes", () => {
  assert.match(reliableSources, /https:\/\/en\.guazi\.com\/\$\{path\}/);
  assert.match(reliableSources, /https:\/\/ru\.guazi\.com\/\$\{path\}/);
  assert.doesNotMatch(regionalOverrides, /auto_georgia_open|www\.auto\.ge/);
  assert.match(regionalOverrides, /https:\/\/www\.mashina\.kg\/search\/all\//);
  assert.match(regionalOverrides, /sourceId: "mashina_kyrgyzstan_exact"/);
  assert.match(regionalOverrides, /sourceId: "turbo_kyrgyzstan_open"/);
  assert.match(regionalOverrides, /\\\/cars\\\/[A-Za-z0-9_\-\[\]\+]+/);
});

test("brand rail opens existing brand and model SEO pages", () => {
  assert.match(brandRail, /const hrefForBrand = \(brand: string\) => homeBrandDirectory/);
  assert.match(brandRail, /`\/cars\/brand\/\$\{catalogBrandSlug\(brand\)\}`/);
  assert.match(brandRail, /`\/cars\?make=\$\{encodeURIComponent\(brand\)\}`/);
  assert.match(brandPage, /BrandModelDirectory/);
  assert.match(brandPage, /readBrandModelDirectory/);
  assert.match(modelPage, /generateMetadata/);
  assert.match(sitemap, /readCatalogBrandDirectory/);
  assert.match(sitemap, /brands\.map/);
  assert.match(sitemap, /\/cars\/brand\/\$\{brand\.slug\}/);
  assert.match(sitemap, /content-type.*application\/xml/si);
});

test("generic open sources only attach images bound to the listing card", () => {
  assert.match(galleryWrapper, /sourceGalleryUrls\(offer\)/);
  assert.match(galleryWrapper, /original\(offer\)/);
  assert.match(galleryWrapper, /uniqueExternalImages/);
  assert.match(galleryWrapper, /gallerySafetyMode: "source_urls_only"/);
  assert.match(galleryWrapper, /return verified \? result : \[\]/);
});

test("publisher prioritizes affordable recent cars up to 160 hp", () => {
  assert.match(rebuildScript, /compareCatalogPublicPriority/);
  assert.match(rebuildScript, /priorityMaxTotalRub/);
  assert.match(rebuildScript, /priorityMaxPowerHp/);
  assert.match(rebuildScript, /priorityMinYear/);
  assert.match(publishScript, /compareCatalogPublicPriority/);
  assert.match(publishScript, /calculatedShare/);
  assert.match(publishScript, /priorityCount/);
});

test("catalog rejects prices above the absolute public limit and bounds parsed power", () => {
  assert.match(publicPriority, /absoluteMaximumRub/);
  assert.match(publicPriority, /above_public_price_limit/);
  assert.match(publicPriority, /function offerPowerHp/);
  assert.match(publicPriority, /offer\?\.powerHp/);
  assert.match(publicPriority, /2_500/);
});

test("dealer verification badge keeps absolute placement and company rows align at the top", () => {
  assert.doesNotMatch(flatUi, /\.dealer-verified-icon\{position:relative!important/);
  assert.match(flatUi, /align-items:flex-start!important/);
});
