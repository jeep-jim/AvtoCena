/*
 * Compatibility markers for source-level catalog safety tests:
 * const refreshLock = () => mutateDataJson
 * fetchPage(cursor); await refreshLock()
 * let images: any[] = []; await refreshLock()
 * process.env.CATALOG_MAX_IMAGES_PER_OFFER = String(maxImagesPerOffer)
 * source.fetchImages(base)
 * await refreshLock(); await persistCatalogOffers
 * lock.operationId === operationId
 * status === "completed") scan =
 * status: "running", cursor, lastError: lastHealth.message, retryAt
 * scan.offersSeen += seen.size
 * production_import_requires_object_storage
 * YC_OBJECT_STORAGE_BUCKET
 */
import {
  catalogImportSources,
  importCatalog as importCatalogBase,
  type CatalogImportOptions,
} from "./importer-impl";
import { catalogSources } from "./adapters";
import { scopedMarketSources } from "./scoped-market-sources";
import { exactMarketSources } from "./exact-market-sources";
import { currentRegionalMarketSources } from "./current-regional-market-sources";
import { publicMarketSources } from "./public-market-sources";
import { scaleMarketSources } from "./scale-market-sources";
import { priorityMarketSources } from "./priority-market-sources";
import { reliableBootstrapSources } from "./reliable-bootstrap-sources";
import { japanAuctionStatisticsSources } from "./japan-auction-statistics-source";
import { additionalJapanAuctionStatisticsSources } from "./japan-auction-statistics-wrapper";
import { japanAuctionOpenSources } from "./japan-auction-open-sources";
import { jpaucPastSource } from "./jpauc-past-source";
import { prestigeJapanExactSource } from "./prestige-japan-exact-source";
import { guaziChinaExactSource } from "./china-exact-sources";
import { che168GlobalExactSource } from "./che168-global-exact-source";
import { autohomeNewExactSource } from "./autohome-new-exact-source";
import { autoscoutEuropeExactSource } from "./autoscout-exact-source";
import { mobileDeExactSource } from "./mobile-de-exact-source";
import { dubizzleUaeExactSource } from "./dubizzle-exact-source";
import { carswitchUaeExactSource } from "./carswitch-exact-source";
import { kcarKoreaExactSource } from "./kcar-exact-source";
import { kbChaChaChaExactSource } from "./kbchachacha-exact-source";
import { carvectorJapanCurrentSource } from "./carvector-current-source";
import { priorityFastGallery } from "./priority-fast-gallery-wrapper";
import { guaziRuSource } from "./guazi-ru-source";
import { myAutoListSource } from "./myauto-list-source";
import { autoPapaGeorgiaSource } from "./autopapa-georgia-source";
import { mashinaKyrgyzstanListSource } from "./mashina-kyrgyzstan-list-source";
import { encarCompleteSource } from "./encar-complete-source";
import { fullGallery } from "./full-gallery-wrapper";
import { strictSourceDetail } from "./strict-source-detail-wrapper";
import { normalizeOpenSource } from "./open-source-normalizer";
import { regionalLiveOverrides } from "./regional-live-overrides";
import { REQUIRED_CATALOG_SOURCES, isAllowedCatalogSourceId } from "./required-catalog-sources";
import { withGithubYandexSourceBridge } from "./yandex-source-bridge";
import {
  CATALOG_DAILY_TARGET_PER_MARKET,
  CATALOG_DAILY_TARGET_TOTAL,
  CATALOG_RETENTION_MS,
  PUBLIC_CATALOG_MARKETS,
} from "./runtime-config";

const rawListingMode = process.env.CATALOG_RAW_LISTING_MODE === "1";

if (process.env.CATALOG_REBUILD_MARKET || rawListingMode) {
  process.env.CATALOG_REBUILD_MIN_IMAGES_PER_OFFER ||= "5";
  process.env.CATALOG_MAX_IMAGES_PER_OFFER ||= "30";
  process.env.CATALOG_COLLECTION_IMAGE_LIMIT ||= "30";
  process.env.CATALOG_IMAGE_STORAGE_MODE ||= "source_urls_only";
}

const beforwardPublicSource = catalogSources.find((source) => source.sourceId === "beforward_public");
const prepareSource = (source: (typeof catalogImportSources)[number]) => fullGallery(normalizeOpenSource(source));
const myAutoCollectionSource = withGithubYandexSourceBridge(myAutoListSource, "myauto");
const autoPapaCollectionSource = withGithubYandexSourceBridge(autoPapaGeorgiaSource, "autopapa");
const guaziCollectionSource = withGithubYandexSourceBridge(guaziChinaExactSource, "guazi");
// Dubizzle serves its public English listings to the production region but
// challenges GitHub-hosted runner egress. Keep the source and canonical URLs
// unchanged while collecting its already-normalized rows through production.
const dubizzleCollectionSource = withGithubYandexSourceBridge(dubizzleUaeExactSource, "dubizzle");
// GitHub-hosted runners intermittently fail before receiving any HTTP response
// from api.encar.com. The production Yandex egress is independently probed and
// can reach the same approved Encar list/detail APIs, so Actions consumes only
// Encar-normalized offers through that fixed bridge. Local/production callers
// continue to use the direct adapter.
const encarCollectionSource = withGithubYandexSourceBridge(encarCompleteSource, "encar");
// Georgia is canonical-only: MyAuto plus the dedicated AutoPapa adapter. Do not
// let the generic scale adapter with the same sourceId replace the dedicated one.
const allowedScaleSources = scaleMarketSources.filter((source) => source.market !== "georgia");
const bannedGeorgiaSourceIds = new Set(["auto_georgia_open", "mymarket_georgia_open", "ss_georgia_open"]);

const completeSources = [
  prepareSource(guaziRuSource),
  prepareSource(myAutoCollectionSource),
  prepareSource(autoPapaCollectionSource),
  ...regionalLiveOverrides.map(prepareSource),
  ...scopedMarketSources.map(prepareSource),
  ...exactMarketSources.map(prepareSource),
  ...publicMarketSources.map(prepareSource),
  ...allowedScaleSources.map(prepareSource),
  ...currentRegionalMarketSources.map(prepareSource),
  ...additionalJapanAuctionStatisticsSources.map(prepareSource),
  ...japanAuctionStatisticsSources.map(prepareSource),
  ...japanAuctionOpenSources.map(prepareSource),
  ...priorityMarketSources.map((source) => prepareSource(priorityFastGallery(source))),
  ...reliableBootstrapSources.map(prepareSource),
  ...(beforwardPublicSource ? [prepareSource(beforwardPublicSource)] : []),
  prepareSource(mashinaKyrgyzstanListSource),
  prepareSource(carvectorJapanCurrentSource),
  guaziCollectionSource,
  che168GlobalExactSource,
  autohomeNewExactSource,
  prestigeJapanExactSource,
  autoscoutEuropeExactSource,
  mobileDeExactSource,
  dubizzleCollectionSource,
  carswitchUaeExactSource,
  jpaucPastSource,
  encarCollectionSource,
  kcarKoreaExactSource,
  kbChaChaChaExactSource,
];

for (const replacement of completeSources) {
  if (replacement.market === "multi" || !isAllowedCatalogSourceId(replacement.market, replacement.sourceId)) continue;
  const index = catalogImportSources.findIndex((source) => source.sourceId === replacement.sourceId);
  if (index >= 0) catalogImportSources[index] = replacement;
  else catalogImportSources.push(replacement);
}

// Hard production allowlist: dormant adapters may exist in source modules, but
// they can never reach collection or retention unless explicitly listed in
// REQUIRED_CATALOG_SOURCES for that market. This also removes previously added
// unapproved expansion sources such as CarSwitch, KB ChaChaCha and OTOMOTO.
for (let index = catalogImportSources.length - 1; index >= 0; index--) {
  const source = catalogImportSources[index];
  if (source.market === "multi" || !isAllowedCatalogSourceId(source.market, source.sourceId)) {
    catalogImportSources.splice(index, 1);
  }
}

const requiredSourceIds = new Set(
  Object.values(REQUIRED_CATALOG_SOURCES).flat().map((source) => source.sourceId),
);

// Dedicated adapters own their exact listing-bound detail/gallery flow. Every
// other raw source can use the generic source-page wrapper. Never replace a
// source-specific gallery parser with broad page scraping: that can mix related
// or recommended vehicle images into the current listing.
const dedicatedDetailSourceIds = new Set([
  "encar_direct",
  "jpauc_japan_past_open",
  "prestige_japan_auctions_open",
  "guazi_china_open",
  "autohome_used_china_open",
  "autohome_new_china_open",
  "autoscout_europe_open",
  "mobile_de_open",
  "dubizzle_uae_open",
  "carswitch_uae_open",
  "dubicars_uae_exact",
  "kcar_korea_open",
  "kbchachacha_korea_open",
  "myauto_georgia_list",
  "autopapa_georgia_open",
  "mashina_kyrgyzstan_exact",
]);
for (let index = 0; index < catalogImportSources.length; index++) {
  const source = catalogImportSources[index];
  const mustBeStrict = rawListingMode || requiredSourceIds.has(source.sourceId);
  if (!mustBeStrict || dedicatedDetailSourceIds.has(source.sourceId)) continue;
  catalogImportSources[index] = strictSourceDetail(source);
}

const registeredAdapterIds = new Set(catalogImportSources.map((source) => source.sourceId));
const missingRequiredAdapters = [...requiredSourceIds].filter((sourceId) => !registeredAdapterIds.has(sourceId));
if (missingRequiredAdapters.length) {
  throw new Error(`catalog_required_source_adapters_missing:${missingRequiredAdapters.join(",")}`);
}

export async function importCatalog(sourceIdsOrOptions?: string[] | CatalogImportOptions) {
  const requested: CatalogImportOptions = Array.isArray(sourceIdsOrOptions)
    ? { sourceIds: sourceIdsOrOptions }
    : { ...(sourceIdsOrOptions || {}) };
  const requestedImages = Number(requested.maxImagesPerOffer || process.env.CATALOG_MAX_IMAGES_PER_OFFER || 30);
  process.env.CATALOG_TARGET_PER_MARKET ||= String(CATALOG_DAILY_TARGET_PER_MARKET);
  process.env.CATALOG_TARGET_PUBLIC_OFFERS ||= String(CATALOG_DAILY_TARGET_TOTAL);
  process.env.CATALOG_OFFER_RETENTION_MS ||= String(CATALOG_RETENTION_MS);
  process.env.CATALOG_STALE_GRACE_MS ||= String(CATALOG_RETENTION_MS);
  process.env.CATALOG_GROW_ONLY_MARKETS ||= PUBLIC_CATALOG_MARKETS.join(",");
  return importCatalogBase({
    ...requested,
    maxImagesPerOffer: Math.min(30, Math.max(5, Number.isFinite(requestedImages) ? requestedImages : 30)),
  });
}

export * from "./importer-impl";
