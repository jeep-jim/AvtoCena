import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { catalogImportSources } from "../apps/web/lib/catalog/importer";
import { scaleMarketSources } from "../apps/web/lib/catalog/scale-market-sources";
import { japanTransitAuctionStatisticsSource } from "../apps/web/lib/catalog/japan-auction-statistics-source";
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
const workflow = fs.readFileSync(new URL("../.github/workflows/catalog-production-recovery-v15.yml", import.meta.url), "utf8");
const reliableSources = fs.readFileSync(new URL("../apps/web/lib/catalog/reliable-bootstrap-sources.ts", import.meta.url), "utf8");
const regionalOverrides = fs.readFileSync(new URL("../apps/web/lib/catalog/regional-live-overrides.ts", import.meta.url), "utf8");
const livePricing = fs.readFileSync(new URL("../apps/web/lib/catalog/live-business-pricing.ts", import.meta.url), "utf8");
const imageQuality = fs.readFileSync(new URL("../apps/web/lib/catalog/image-quality.ts", import.meta.url), "utf8");
const brandRail = fs.readFileSync(new URL("../apps/web/components/catalog/BrandLogoRail.tsx", import.meta.url), "utf8");
const catalogCard = fs.readFileSync(new URL("../apps/web/components/catalog/CatalogCard.tsx", import.meta.url), "utf8");
const brandPage = fs.readFileSync(new URL("../apps/web/app/(public)/cars/brand/[slug]/page.tsx", import.meta.url), "utf8");
const modelPage = fs.readFileSync(new URL("../apps/web/app/(public)/cars/brand/[slug]/model/[model]/page.tsx", import.meta.url), "utf8");
const sitemap = fs.readFileSync(new URL("../apps/web/app/sitemap.ts", import.meta.url), "utf8");
const offerQuality = fs.readFileSync(new URL("../apps/web/lib/catalog/offer-quality.ts", import.meta.url), "utf8");
const galleryWrapper = fs.readFileSync(new URL("../apps/web/lib/catalog/full-gallery-wrapper.ts", import.meta.url), "utf8");
const flatUi = fs.readFileSync(new URL("../apps/web/app/flat-ui.css", import.meta.url), "utf8");
const storage = fs.readFileSync(new URL("../apps/web/lib/catalog/storage.ts", import.meta.url), "utf8");
const carsPage = fs.readFileSync(new URL("../apps/web/app/(public)/cars/page.tsx", import.meta.url), "utf8");
const dealerDemo = fs.readFileSync(new URL("../apps/web/components/dealers/DealerDemoDashboard.tsx", import.meta.url), "utf8");

test("source-scale catalog keeps 1000-offer quota per source and supports large markets", () => {
  assert.equal(CATALOG_DAILY_TARGET_PER_SOURCE, 1_000);
  assert.equal(CATALOG_MAX_PUBLIC_OFFERS_PER_MARKET, 30_000);
  assert.equal(CATALOG_RETENTION_MS, 3 * 24 * 60 * 60 * 1_000);
  assert.match(rebuildScript, /minimumMarketTarget/);
  assert.match(rebuildScript, /targetPerSource/);
  assert.match(publishScript, /targetPerMarket/);
  assert.match(publishScript, /marketsBelowTarget/);
  assert.match(validationScript, /marketTargetReached/);
  assert.doesNotMatch(publishScript, /selected\.length >= target\b/);
});

test("daily workflow runs all 21 market shards in one wave", () => {
  assert.match(workflow, /group: catalog-source-scale-daily/);
  assert.match(workflow, /cancel-in-progress: true/);
  assert.match(workflow, /max-parallel: 21/);
  assert.match(workflow, /shard: \[0, 1, 2\]/);
  assert.match(workflow, /CATALOG_REBUILD_SHARD_COUNT: "3"/);
  assert.doesNotMatch(workflow, /^\s*pull_request:/m);
});

test("daily workflow targets three productive sources, progressive galleries and 3000 cars per market", () => {
  assert.match(workflow, /market: \[korea, china, japan, uae, europe, georgia, kyrgyzstan\]/);
  assert.match(workflow, /CATALOG_REBUILD_TARGET_PER_SOURCE: "1000"/);
  assert.match(workflow, /CATALOG_REBUILD_TARGET_PER_MARKET: "3000"/);
  assert.match(workflow, /CATALOG_PUBLISH_TARGET_PER_MARKET: "3000"/);
  assert.match(workflow, /CATALOG_PUBLISH_MIN_PRODUCTIVE_SOURCES: "3"/);
  assert.match(workflow, /CATALOG_OFFER_RETENTION_MS: "259200000"/);
  assert.match(workflow, /CATALOG_REBUILD_MIN_IMAGES_PER_OFFER: "1"/);
  assert.match(workflow, /CATALOG_REBUILD_PREFERRED_IMAGES_PER_OFFER: "8"/);
  assert.match(workflow, /CATALOG_MAX_IMAGES_PER_OFFER: "30"/);
  assert.match(workflow, /CATALOG_COLLECTION_IMAGE_LIMIT: "30"/);
  assert.match(workflow, /CATALOG_GALLERY_FAST_PATH: "false"/);
  assert.match(workflow, /CATALOG_REBUILD_DETAIL_LIMIT_PER_SOURCE: "100"/);
  assert.match(workflow, /CATALOG_IMAGE_FETCH_CONCURRENCY: "6"/);
  assert.match(workflow, /CATALOG_REBUILD_PREPARE_CONCURRENCY: "16"/);
  assert.match(workflow, /CATALOG_REBUILD_TIME_LIMIT_MS: "3000000"/);
  assert.match(workflow, /CATALOG_PRIORITY_MAX_TOTAL_RUB: "6000000"/);
  assert.match(workflow, /CATALOG_PRIORITY_MAX_POWER_HP: "160"/);
  assert.match(workflow, /CATALOG_PRIORITY_MAX_AGE_YEARS: "6"/);
  assert.match(workflow, /retention-days: 1/);
  assert.match(workflow, /compression-level: 9/);
  assert.match(workflow, /continue-on-error: true/);
  assert.match(workflow, /Catalog health summary/);
  assert.match(workflow, /cron: "17 20 \* \* \*"/);
  assert.doesNotMatch(workflow, /CATALOG_REBUILD_TARGET: "250"/);
  assert.doesNotMatch(workflow, /Require published 7 × 250 manifest/);
});

test("all seven markets have at least three independent registered adapters", () => {
  const byMarket = new Map(PUBLIC_CATALOG_MARKETS.map((market) => [market, new Set<string>()]));
  for (const source of catalogImportSources) {
    if (source.market === "multi") continue;
    byMarket.get(source.market)?.add(source.sourceId);
  }
  for (const market of PUBLIC_CATALOG_MARKETS) {
    assert.ok((byMarket.get(market)?.size || 0) >= 3, `${market} must have at least three registered sources`);
  }
  assert.ok((byMarket.get("japan")?.size || 0) >= 10, "Japan must use the expanded source registry");
  assert.ok((byMarket.get("china")?.size || 0) >= 8, "China must use the expanded source registry");
  assert.ok((byMarket.get("europe")?.size || 0) >= 8, "Europe must use the expanded source registry");
});

test("Japan Transit sold-auction statistics participates in the production registry", () => {
  const ids = new Set(catalogImportSources.map((source) => source.sourceId));
  assert.equal(japanTransitAuctionStatisticsSource.sourceId, "japantransit_japan_stat_open");
  assert.equal(japanTransitAuctionStatisticsSource.market, "japan");
  assert.equal(ids.has("japantransit_japan_stat_open"), true);
  assert.match(carsPage, /Аукционная статистика Японии/);
  assert.match(carsPage, /isJapanAuctionResult/);
});

test("probe limits network work to active sources while rebuild retains the complete registry", () => {
  assert.match(probeScript, /catalogImportSources\s*\.filter/);
  assert.match(probeScript, /registeredSourceCount/);
  assert.match(probeScript, /sourceIdsForRebuild = activeSourceIds\.join/);
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
  assert.match(rebuildScript, /offer = normalizeVehicleOfferSpecs\(await enrichOfferWithVehicleKnowledge\(offer\)\)/);
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
  assert.match(rebuildScript, /function rubValue/);
  assert.match(rebuildScript, /previous\?\.images/);
  assert.doesNotMatch(rebuildScript, /reject\("calculation"\); return null/);
});

test("real listings stay public while exact customs calculation is pending", () => {
  assert.match(offerQuality, /hasPendingCalculation/);
  assert.match(offerQuality, /status\.startsWith\("needs_"\)/);
  assert.doesNotMatch(storage, /hasCredibleOfferContent\(o\) && Boolean\(o\.totalRub\)/);
  assert.doesNotMatch(carsPage, /Boolean\(offer\.totalRub\) && isCrediblePublicOffer/);
  assert.match(publishScript, /calculationPending/);
  assert.match(rebuildScript, /calculationStatus: "needs_data"/);
});

test("cards keep source-price conversion while pending copy stays compact", () => {
  assert.match(livePricing, /convertToRub/);
  assert.match(livePricing, /attachCurrentCurrencyRate/);
  assert.match(livePricing, /sourcePriceRub: rate\.sourcePriceRub/);
  assert.match(catalogCard, /sourcePriceRub/);
  assert.match(catalogCard, /\{yearLabel\} · цена автомобиля/);
  assert.match(catalogCard, /Расчёт под ключ уточняется/);
  assert.doesNotMatch(catalogCard, /цена автомобиля в рублях/);
  assert.doesNotMatch(catalogCard, /Расчёт таможни, утильсбора и цены под ключ уточняется/);
  assert.doesNotMatch(catalogCard, /Цена по запросу/);
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
    "auto_georgia_open",
    "autopapa_georgia_open",
    "ss_georgia_open",
    "mymarket_georgia_open",
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
});

test("bootstrap replacements follow current regional public routes", () => {
  assert.match(reliableSources, /https:\/\/en\.guazi\.com\/\$\{path\}/);
  assert.match(reliableSources, /https:\/\/ru\.guazi\.com\/\$\{path\}/);
  assert.match(regionalOverrides, /https:\/\/www\.auto\.ge\/en\/index\.html/);
  assert.match(regionalOverrides, /https:\/\/www\.mashina\.kg\/search\/all\//);
  assert.match(regionalOverrides, /sourceId: "mashina_kyrgyzstan_exact"/);
  assert.match(regionalOverrides, /sourceId: "turbo_kyrgyzstan_open"/);
  assert.match(regionalOverrides, /\\\/cars\\\/[A-Za-z0-9_\-\[\]\+]+/);
});

test("brand rail opens existing brand and model SEO pages", () => {
  assert.match(brandRail, /href=\{`\/cars\/brand\/\$\{catalogBrandSlug\(brand\)\}`\}/);
  assert.match(brandPage, /BrandModelDirectory/);
  assert.match(brandPage, /readBrandModelDirectory/);
  assert.match(modelPage, /generateMetadata/);
  assert.match(modelPage, /BreadcrumbList/);
  assert.match(sitemap, /readAllModelSeoLinks/);
  assert.match(sitemap, /\/cars\/brand\/\$\{model\.brandSlug\}\/model\/\$\{model\.modelSlug\}/);
});

test("generic open sources only attach images bound to the listing card", () => {
  assert.match(galleryWrapper, /source\.sourceId\.endsWith\("_open"\)/);
  assert.match(galleryWrapper, /gallerySafetyMode/);
  assert.match(galleryWrapper, /listing_bound/);
  assert.match(galleryWrapper, /sourceNativeUrls\.length >= result\.length/);
  assert.match(galleryWrapper, /listingImages/);
  assert.match(galleryWrapper, /fastPath/);
});

test("publisher prioritizes affordable recent cars up to 160 hp", () => {
  assert.match(rebuildScript, /businessPriority/);
  assert.match(rebuildScript, /priorityMaxTotalRub/);
  assert.match(rebuildScript, /priorityMaxPowerHp/);
  assert.match(rebuildScript, /priorityMinYear/);
  assert.match(publishScript, /businessPriority/);
  assert.match(publishScript, /calculatedShare/);
  assert.match(publishScript, /priorityCount/);
});

test("catalog rejects implausible ordinary-car prices and power", () => {
  assert.match(offerQuality, /totalRub > 50_000_000/);
  assert.match(offerQuality, /performance \|\| commercial \? 1_500 : 650/);
  assert.match(offerQuality, /powerHp \/ engineCc > 0\.21/);
  assert.match(offerQuality, /hasPlausibleSourcePrice/);
});

test("dealer verification badge keeps absolute placement and company rows align at the top", () => {
  assert.doesNotMatch(flatUi, /\.dealer-verified-icon\{position:relative!important/);
  assert.match(flatUi, /align-items:flex-start!important/);
});
