import {assertDerivedPricingRuntime as assertPublisherPricingRuntime} from './lib/korea-derived-runtime-parity.mjs';
import {assertScopedProjectionReaderReady} from './lib/catalog-projection-reader-readiness.mjs';
import {createDerivedPublicationContributions,prepareDerivedInternalContribution,prepareDerivedPublicContribution,verifyDerivedContribution,assertDerivedRawRetention} from './lib/korea-derived-contributions.mjs';
import {createDerivedDatePublicationGuard} from './lib/korea-derived-publication-io.mjs';
import {imageKey,uniqueImages,mergeOfferVersions} from './lib/catalog-offer-merge.mjs';
import {isAllDubicarsOffer,isUnpricedDubicarsOffer} from '../apps/web/lib/catalog/dubicars-owner-policy.ts';
import {catalogInventoryLimit,catalogMarketInventoryLimit} from "./lib/catalog-inventory-limit.mjs";
import {startPublicationHeartbeat} from './lib/publication-heartbeat.mjs';
import {isCompletedChe168Delta,isCompletedDubicarsDelta} from './lib/auto-api-che168-client.mjs';
import {assertPaidKoreaPublicationSource} from './lib/paid-korea-publication-guard.mjs';
import {prepareStagedCatalogBudget} from './lib/catalog-staged-budget.mjs';
import {prepareRawPublication} from './lib/catalog-raw-publication.mjs';
import {prepareRawInternalPublication} from './lib/catalog-raw-internal-publication.mjs';
import {createPaidRepairPublicationGuard} from './lib/paid-encar-repair-io.mjs';
import {createPaidPublicationContributions,preparePaidInternalContribution,preparePaidPublicContribution,paidContributionWorkerSource} from './lib/catalog-paid-encar-contributions.mjs';
import {createChe168PublicationContributions,prepareChe168InternalContribution,prepareChe168PublicContribution,
  che168ContributionWorkerSource} from './lib/catalog-che168-contributions.mjs';
import {calculationVersion} from './catalog-calculation-version.mjs';
// Maintenance publication reads large source payloads; avoid a burst of twelve simultaneous S3 downloads.
process.env.CATALOG_READ_CONCURRENCY ||= "4";
import { unavailableOfferRecord } from "../apps/web/lib/catalog/offer-availability.ts";
const sellerInventory = process.env.CATALOG_SELLER_INVENTORY === "1";
const { prepareSellerInventory } = await import("../apps/web/lib/catalog/prepare-seller-inventory.ts");
const { sourceInventoryInScope } = await import('../apps/web/lib/catalog/source-inventory-scope.ts');
const { requiredCatalogSourceIds } = await import('../apps/web/lib/catalog/required-catalog-sources.ts');
const { allowedCatalogSourceIds } = await import('../apps/web/lib/catalog/required-catalog-sources.ts');
const { readCatalogProjectionBatches } = await import('../apps/web/lib/catalog-projection-parts.ts');
const { isSellerPricedOffer } = await import("../apps/web/lib/catalog/seller-price-contract.ts");
const { assertNoDeliveredPriceRegression } = await import("../apps/web/lib/catalog/publication-price-preservation.ts");
import fs from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import { catalogPublicCountGuard } from "./lib/catalog-public-count-guard.mjs";
import { hashRows, snapshotCatalogRows, assertCatalogRowsUnchanged } from "./lib/catalog-row-hash.mjs";
import { isCommercialInventoryOffer as isCommercial } from "./lib/catalog-vehicle-scope.mjs";

const { getJsonStorage, mutateDataJson } = await import("../apps/web/lib/data.ts");
const { calculateOfferWithRussiaCustoms } = await import("../apps/web/lib/catalog/customs-pricing.ts");
const { minimumPublicationImages, hasAllowedCatalogSourceProvenance, isCrediblePublicOffer, isCatalogYearAllowed } = await import("../apps/web/lib/catalog/offer-quality.ts");
const { compareCatalogPublicPriority, japanAuctionSoldIdentityVerified } = await import("../apps/web/lib/catalog/public-priority.ts");
const { classifyCatalogV2Offer, selectCatalogV2MarketOffers } = await import("../apps/web/lib/catalog/catalog-v2-policy.ts");
const { normalizeVehicleOfferSpecs } = await import("../apps/web/lib/catalog/spec-normalization.ts");
const { catalogDescriptionRejectionReason } = await import("../apps/web/lib/catalog/description-completeness.ts");
const { catalogRetentionDecision, catalogSourceRefreshStates, catalogConfirmedWithdrawalIndex, catalogOfferWithdrawnByReport } = await import("../apps/web/lib/catalog/source-retention.ts");
const { catalogOfferFreshness, catalogOfferWithinRetention, catalogOfferRetentionExpired, catalogMarketRetentionMs, preserveCatalogOfferObservation } = await import("../apps/web/lib/catalog/refresh-policy.ts");
const { CATALOG_PUBLICATION_TRANSACTION_VERSION, catalogGenerationId, compactPublicStorageOffer, persistCatalogOffers, previewCanonicalPublicCatalogOffers, readMarketMaintenanceOffers, readMarketOffers } = await import("../apps/web/lib/catalog/storage.ts");
const { PUBLIC_CATALOG_MARKETS } = await import("../apps/web/lib/catalog/runtime-config.ts");
if (CATALOG_PUBLICATION_TRANSACTION_VERSION !== 2) throw Error("catalog_publication_transaction_runtime_required");

const inputDir = process.env.CATALOG_REBUILD_INPUT_DIR || "catalog-v2-input";
const reportFile = process.env.CATALOG_REBUILD_PUBLISH_REPORT || "catalog-v2-market-publish-report.json";
const configuredMarkets = String(process.env.CATALOG_REBUILD_MARKETS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const market = configuredMarkets[0] || "";
const requiredAbsentOfferIds = String(process.env.CATALOG_REQUIRED_ABSENT_OFFER_IDS || '').split(',').filter(Boolean);
if (requiredAbsentOfferIds.some(id => !/^[a-f0-9]{24}$/.test(id)) || (requiredAbsentOfferIds.length && market !== 'china')) throw Error('catalog_required_absent_ids_invalid');
const targetPerSource = catalogInventoryLimit(process.env.CATALOG_REBUILD_TARGET_PER_SOURCE);
const targetPerMarket = catalogMarketInventoryLimit(market, Math.max(1, Number(process.env.CATALOG_PUBLISH_TARGET_PER_MARKET || 100_000)));
const maximumPerMarket = catalogMarketInventoryLimit(market, Math.max(targetPerMarket, catalogInventoryLimit(process.env.CATALOG_PUBLISH_MAX_PER_MARKET)));
const minimumImagesPerOffer = Math.max(1, Number(process.env.CATALOG_REBUILD_MIN_IMAGES_PER_OFFER || 1));
const defaultRetentionMs = catalogMarketRetentionMs("korea");
const japanRetentionMs = catalogMarketRetentionMs("japan");
const outageGraceMultiplier = 1;
const minimumPublicRetentionRatio = Number(process.env.CATALOG_MIN_PUBLIC_RETENTION_RATIO || 0.90);
const allowPublicCollapse = process.env.CATALOG_ALLOW_PUBLIC_COLLAPSE === "1";
const prepareConcurrency = Math.max(1, Math.min(32, Number(process.env.CATALOG_PUBLISH_PREPARE_CONCURRENCY || 16)));
const priorityMaxTotalRub = Math.max(100_000, Number(process.env.CATALOG_PRIORITY_MAX_TOTAL_RUB || 15_000_000));
const priorityMaxPowerHp = Math.max(1, Number(process.env.CATALOG_PRIORITY_MAX_POWER_HP || 160));
const priorityMaxAgeYears = Math.max(0, Number(process.env.CATALOG_PRIORITY_MAX_AGE_YEARS || 6));
const v2Policy = {
  priorityTarget: Math.max(0, Number(process.env.CATALOG_V2_PRIORITY_TARGET || 1_000)),
  maximumPerMarket,
  priorityMaxAgeYears,
  recentMaxAgeYears: Math.max(priorityMaxAgeYears, Number(process.env.CATALOG_V2_RECENT_MAX_AGE_YEARS || 10)),
  priorityMaxPowerHp,
  priorityMaxTotalRub,
  hardMaxTotalRub: Number.POSITIVE_INFINITY,
  lowPowerMinShare: Math.max(0, Math.min(1, Number(process.env.CATALOG_V2_LOW_POWER_MIN_SHARE || 0.8))),
};
const publishLockPath = "catalog/import-lock.json";
const publishOperationId = `catalog_v3_publish_${market}_${crypto.randomUUID()}`;
const publishLockWaitMs = Math.max(0, Number(process.env.CATALOG_PUBLISH_LOCK_WAIT_MS || 7_200_000));
const publishLockPollMs = Math.max(1_000, Number(process.env.CATALOG_PUBLISH_LOCK_POLL_MS || 15_000));
const publishLockTtlMs = Math.max(30 * 60_000, Number(process.env.CATALOG_PUBLISH_LOCK_TTL_MS || 90 * 60_000));
const publishLockHeartbeatMs = Math.max(
  30_000,
  Math.min(Math.floor(publishLockTtlMs / 3), Number(process.env.CATALOG_PUBLISH_LOCK_HEARTBEAT_MS || 5 * 60_000)),
);
let publishLockHeld = false;
let independentHeartbeat = null;
let publishLockHeartbeatTimer = null;
let publishLockHeartbeatPromise = Promise.resolve();

if (!PUBLIC_CATALOG_MARKETS.includes(market)) {
  throw new Error(`catalog_market_invalid:${market || "missing"}`);
}
if (configuredMarkets.length !== 1) {
  throw new Error(`catalog_market_scope_requires_one_market:${configuredMarkets.join(",")}`);
}

function retentionForMarket(marketId) {
  return catalogMarketRetentionMs(marketId);
}

const retentionMs = retentionForMarket(market);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function acquirePublishLock() {
  const deadline = Date.now() + publishLockWaitMs;
  let lastLock = "catalog_publish_locked";
  while (true) {
    try {
      await mutateDataJson(publishLockPath, { lockedUntil: "" }, (current) => {
        const lockedUntil = Date.parse(String(current?.lockedUntil || ""));
        if (Number.isFinite(lockedUntil) && lockedUntil > Date.now() && current?.operationId !== publishOperationId) {
          throw new Error(`catalog_publish_locked_until_${new Date(lockedUntil).toISOString()}`);
        }
        return {
          operationId: publishOperationId,
          operationType: `catalog_v3_publish_${market}`,
          lockedUntil: new Date(Date.now() + publishLockTtlMs).toISOString(),
          startedAt: new Date().toISOString(),
        };
      });
      publishLockHeld = true;
      independentHeartbeat = await startPublicationHeartbeat({key:publishLockPath,operationId:publishOperationId,ttlMs:publishLockTtlMs,intervalMs:publishLockHeartbeatMs});
      publishLockHeartbeatTimer = setInterval(() => {
        publishLockHeartbeatPromise = publishLockHeartbeatPromise.then(async () => {
          if (!publishLockHeld) return;
          await mutateDataJson(publishLockPath, { lockedUntil: "" }, (current) => {
            if (current?.operationId !== publishOperationId) {
              throw new Error(`catalog_publish_lock_lost:${String(current?.operationId || "missing")}`);
            }
            return {
              ...current,
              lockedUntil: new Date(Date.now() + publishLockTtlMs).toISOString(),
              heartbeatAt: new Date().toISOString(),
            };
          });
        }).catch((error) => {
          console.error(`[publish-lock] ${market} heartbeat failed: ${String(error?.message || error)}`);
        });
      }, publishLockHeartbeatMs);
      publishLockHeartbeatTimer.unref?.();
      return;
    } catch (error) {
      lastLock = String(error?.message || error);
      if (!/catalog_(?:publish|import|certified_power)_locked/i.test(lastLock) || Date.now() + publishLockPollMs > deadline) {
        throw new Error(`catalog_publish_lock_wait_failed:${lastLock}`);
      }
      console.log(`[publish-lock] ${market} waiting: ${lastLock}`);
      await sleep(publishLockPollMs);
    }
  }
}

async function releasePublishLock() {
  if (!publishLockHeld) return;
  if (publishLockHeartbeatTimer) {
    clearInterval(publishLockHeartbeatTimer);
    publishLockHeartbeatTimer = null;
  }
  await publishLockHeartbeatPromise;
  await independentHeartbeat?.stop();
  await mutateDataJson(publishLockPath, { lockedUntil: "" }, (current) => current?.operationId === publishOperationId
    ? { operationId: publishOperationId, operationType: `catalog_v3_publish_${market}`, lockedUntil: "", finishedAt: new Date().toISOString() }
    : current);
  publishLockHeld = false;
}

function freshness(offer) {
  return catalogOfferFreshness(offer);
}

function qualityOrder(left, right) {
  return compareCatalogPublicPriority(left, right)
    || freshness(right) - freshness(left)
    || String(left?.id || "").localeCompare(String(right?.id || ""));
}

function hasExactCalculation(offer) {
  const customs = offer?.calculationSnapshot?.customs;
  const breakdown = offer?.calculationSnapshot?.breakdown;
  if (customs?.status !== "ready" || !Number.isFinite(Number(customs?.totalCustomsRub))) return false;
  if (!Array.isArray(breakdown) || !breakdown.some((line) => line?.id === "car") || !breakdown.some((line) => line?.id === "customs")) return false;
  const kind = String(offer?.powertrainKind || "");
  if (!["electric", "series_hybrid", "other_hybrid"].includes(kind)) return true;
  if (Number(offer?.utilizationPowerKw || 0) > 0) return true;
  const motor30Min = Number(offer?.power30MinKw || 0)
    || (Array.isArray(offer?.power30MinKwByMotor)
      ? offer.power30MinKwByMotor.reduce((sum, value) => sum + Math.max(0, Number(value || 0)), 0)
      : 0);
  return kind === "other_hybrid" ? motor30Min > 0 && Number(offer?.icePowerKw || 0) > 0 : motor30Min > 0;
}

async function generationFilesForMarket() {
  let names = [];
  try { names = await fs.readdir(inputDir); } catch { return []; }
  return names
    .filter((name) => name === `catalog-rebuild-${market}.json` || (name.startsWith(`catalog-rebuild-${market}-`) && name.endsWith(".json")))
    .map((name) => path.join(inputDir, name))
    .sort();
}

async function readGenerationFiles() {
  const filenames = await generationFilesForMarket();
  const payloads = [];
  const offers = [];
  const errors = [];
  for (const filename of filenames) {
    try {
      const parsed = JSON.parse(await fs.readFile(filename, "utf8"));
      if (!Array.isArray(parsed?.offers)) throw new Error("generation_offers_missing");
      if (parsed.market && parsed.market !== market) throw new Error(`generation_market_mismatch_${parsed.market}`);
      const {offers: shardOffers, ...metadata} = parsed;
      payloads.push(metadata);
      offers.push(...parsed.offers);
    } catch (error) {
      errors.push({ filename, error: String(error?.message || error) });
    }
  }
  return { filenames, payloads, offers, errors };
}

async function runWithConcurrency(items, concurrency, worker) {
  if (!items.length) return [];
  const results = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index]);
    }
  }));
  return results;
}

let retainedPublishedIds = new Set();
let paidContributions = null, che168Contributions = null, derivedContributions = null, derivedInternalContribution = null, derivedPublicContribution = null;
async function auditCandidate(sourceOffer) {
  try {
    if (!sourceInventoryInScope(sourceOffer)) return {offer:null,reason:'source_inventory_scope'};
    if (!sourceOffer?.id || sourceOffer?.market !== market || isCommercial(sourceOffer)) return { offer: null, reason: "commercial_or_identity" };
    if (market !== "japan" && sourceOffer.status !== "active") return { offer: null, reason: "source_not_active" };
    if (!catalogOfferWithinRetention(sourceOffer)) return { offer: null, reason: "retention_expired" };
    let offer = normalizeVehicleOfferSpecs({ ...preserveCatalogOfferObservation(sourceOffer), status: market === "japan" ? "active" : sourceOffer.status, images: uniqueImages(sourceOffer.images) });
    if (!offer.make || !offer.model || !Number.isFinite(Number(offer.year))) return { offer: null, reason: "specs" };
    if (!offer.operational?.sourceUrl || (!isUnpricedDubicarsOffer(offer)&&(!Number.isFinite(Number(offer.sourcePrice)) || Number(offer.sourcePrice) <= 0))) return { offer: null, reason: "source" };
    if (offer.images.length < minimumPublicationImages(offer, minimumImagesPerOffer, retainedPublishedIds.has(offer.id))) return { offer: null, reason: "images" };
    if (sellerInventory) {
      const prepared = await prepareSellerInventory(sourceOffer,
        {preservePublishedPrice:retainedPublishedIds.has(sourceOffer.id)});
      if (!prepared) return {offer:null,reason:"source_inventory_unqualified"};
      const priority = classifyCatalogV2Offer(prepared,v2Policy);
      if (!priority.eligible) return {offer:null,reason:`v2_${priority.reason}`};
      // The normalized specification tables remain on the offer, but the raw
      // marketplace response is not used by canonical selection or public
      // persistence. Releasing it here prevents a large market from retaining
      // one deep-cloned source payload for every audited candidate.
      const compact = compactPublicStorageOffer(prepared);
      paidContributions?.recordAudited(sourceOffer, compact);
      derivedContributions?.recordAudited(sourceOffer, compact);
      che168Contributions?.recordAudited(sourceOffer, compact);
      return {offer:compact,reason:"ok"};
    }
    const descriptionReason = catalogDescriptionRejectionReason(offer);
    if (descriptionReason) return { offer: null, reason: descriptionReason };
    offer = normalizeVehicleOfferSpecs(await calculateOfferWithRussiaCustoms(offer));
    const calculationStatus = String(offer.calculationStatus || "");
    const calculationPending = calculationStatus === "needs_data"
      || calculationStatus.startsWith("needs_")
      || calculationStatus === "preliminary_power_pending"
      || calculationStatus === "estimated";
    if (!hasExactCalculation(offer) && !calculationPending) return { offer: null, reason: "calculation" };
    if (!isCrediblePublicOffer(offer)) return { offer: null, reason: "quality" };
    if (!japanAuctionSoldIdentityVerified(offer)) return { offer: null, reason: "japan_auction_sold_identity_unverified" };
    const priority = classifyCatalogV2Offer(offer, v2Policy);
    if (!priority.eligible) return { offer: null, reason: `v2_${priority.reason}` };
    offer.operational = {
      ...(offer.operational || {}),
      raw: {
        ...(typeof offer.operational?.raw === "object" && offer.operational.raw ? offer.operational.raw : {}),
        publicPriority: priority,
      },
    };
    const compact = compactPublicStorageOffer(offer);
    derivedContributions?.recordAudited(sourceOffer, compact);
    return { offer: compact, reason: "ok" };
  } catch (error) {
    return { offer: null, reason: `exception:${String(error?.message || error)}` };
  }
}

const dryRun = process.env.CATALOG_PUBLICATION_DRY_RUN === "1";
if (!dryRun && process.env.CATALOG_CHUNKED_PROJECTIONS_WRITE === '1') await assertScopedProjectionReaderReady();
if (!dryRun && market !== 'japan' && getJsonStorage().driver === 'object'
    && (!process.env.CATALOG_BUDGET_RUNTIME_ROOT || !/^[a-f0-9]{40}$/.test(process.env.CATALOG_BUDGET_RUNTIME_RELEASE || ''))) {
  throw Error('staged_budget_runtime_required');
}
// Publisher normalization and the child calculator must use identical libraries.
if (!dryRun && market !== 'japan' && getJsonStorage().driver === 'object') {
  assertPublisherPricingRuntime({publisherRoot:process.cwd(),runtimeRoot:process.env.CATALOG_BUDGET_RUNTIME_ROOT,
    expectedRelease:process.env.CATALOG_BUDGET_RUNTIME_RELEASE});
}
async function assertRequestedRecoveryBaseline() {
  const generation = process.env.CATALOG_EXPECTED_BASE_GENERATION_ID, digest = process.env.CATALOG_EXPECTED_BASE_MANIFEST_SHA256;
  if (!generation && !digest) return;
  if (!generation || !/^[a-f0-9]{64}$/.test(digest || '')) throw Error('catalog_recovery_baseline_arguments');
  const current = await getJsonStorage().readJson('catalog/manifest.json', null);
  if (current?.generationId !== generation || crypto.createHash('sha256').update(JSON.stringify(current)).digest('hex') !== digest)
    throw Error('catalog_recovery_baseline_changed');
}
await assertRequestedRecoveryBaseline();
function logPublicationMemory(stage) {
  const { rss, heapUsed, external } = process.memoryUsage();
  console.log(JSON.stringify({ market, stage, memoryBytes: { rss, heapUsed, external } }));
}
try {
let expectedBaseGenerationId = await catalogGenerationId();
logPublicationMemory("before_intake");
const generation = await readGenerationFiles();
logPublicationMemory("intake_loaded");
// A failed/empty source collection is not a request to reinterpret all of the
// market's existing immutable records as newly collected seller inventory.
if (sellerInventory && !generation.offers.length && !generation.payloads.some(payload=>(isCompletedChe168Delta(payload.report)||isCompletedDubicarsDelta(payload.report))) && process.env.CATALOG_REBALANCE_EXISTING !== "1") {
  await fs.writeFile(reportFile, JSON.stringify({market, published:false, previousManifestPreserved:true,
    skipped:true, reason:"no_fresh_source_offers", generationErrors:generation.errors},null,2));
  throw new Error(`catalog_no_fresh_source_offers:${market}`);
}
const paidEncarReport = market === "korea"
  ? generation.payloads.find(payload => payload.report?.provider === "auto_api_encar")?.report
  : undefined;
if (paidEncarReport) {
  const source = paidEncarReport.sources?.[0];
  if (!paidEncarReport.completed || paidEncarReport.market !== "korea" || !paidEncarReport.snapshotRun ||
      paidEncarReport.sources?.length !== 1 || source?.stopReason !== "source_finished" ||
      source.sourceId !== "encar_direct" || !source.uniqueOffers ||
      generation.errors.length || source.uniqueOffers !== generation.offers.length ||
      generation.offers.some(row => row.market !== "korea" || row.sourceId !== "encar_direct" ||
        row.operational?.provider !== "auto_api_encar")) {
    throw Error("incomplete_paid_encar_publication_input");
  }
}
if(process.env.PAID_DATE_OVERLAY_EXPECTED_FILE && !paidEncarReport?.savedDateOverlay)throw Error('derived_lineage_missing');
const derivedDateGuard=paidEncarReport?.savedDateOverlay ? await createDerivedDatePublicationGuard({
 storage:getJsonStorage(),intakeDirectory:process.env.PAID_DATE_OVERLAY_INTAKE_DIR,
 incomingReport:paidEncarReport,incomingOffers:generation.offers,
 expectedFile:process.env.PAID_DATE_OVERLAY_EXPECTED_FILE,expectedFileSha256:process.env.PAID_DATE_OVERLAY_EXPECTED_SHA256,
 preparationFile:process.env.PAID_DATE_OVERLAY_PREPARATION_FILE,
 runtimeRoot:process.env.CATALOG_BUDGET_RUNTIME_ROOT,expectedRuntimeRelease:process.env.CATALOG_BUDGET_RUNTIME_RELEASE,
 onProgress:value=>console.log(JSON.stringify(value))}) : null;
const technicalRepairReceipt = paidEncarReport?.technicalRepair;
if (process.env.PAID_REPAIR_APPROVED_SHA256 && !technicalRepairReceipt) throw Error('paid_repair_receipt_missing');
const technicalRepairGuard = technicalRepairReceipt ? await createPaidRepairPublicationGuard({
  storage:getJsonStorage(), receipt:technicalRepairReceipt, expectedSha256:process.env.PAID_REPAIR_APPROVED_SHA256,
}) : null;
const che168ContributionReport=market==='china'
  ?generation.payloads.find(payload=>payload.report?.sourceInputWitness?.kind==='independent_che168_replica_v1')?.report:null;
che168Contributions=che168ContributionReport?createChe168PublicationContributions({
  intake:che168ContributionReport,freshOffers:generation.offers,sellerInventory,
  compactPublic:compactPublicStorageOffer,sourceSha:che168ContributionWorkerSource(),calculationVersion:calculationVersion(),
}):null;
if (technicalRepairGuard) {
  if (!sellerInventory || allowPublicCollapse || process.env.CATALOG_REBALANCE_EXISTING === '1') throw Error('paid_repair_publication_policy_invalid');
  technicalRepairGuard.assertInput(generation.offers);
}
paidContributions = paidEncarReport?.paidInputWitness ? createPaidPublicationContributions({
  intake: paidEncarReport, freshOffers: generation.offers, sellerInventory,
  compactPublic: compactPublicStorageOffer, sourceSha: paidContributionWorkerSource(),
  calculationVersion: calculationVersion(),
}) : null;
derivedContributions = derivedDateGuard ? await createDerivedPublicationContributions({guard:derivedDateGuard,operationId:publishOperationId,intake:paidEncarReport,compactPublic:compactPublicStorageOffer}) : null;
async function assertCurrentKoreaPublicationSource() {
  await assertPaidKoreaPublicationSource({
    market,
    paidEncarInput: !!paidEncarReport,
    readManifest: () => getJsonStorage().readJson("catalog/manifest.json", null),
    readControls: async () => {
      const { readCollectionControls } = await import("../apps/web/lib/catalog/collection-controls.ts");
      return readCollectionControls(getJsonStorage());
    },
  });
}
const sourceRefreshStates = catalogSourceRefreshStates(generation.payloads);
const completeChe168Inventory = generation.payloads.some(payload => {
  const report=payload.report,source=report?.sources?.find(row=>row.sourceId==='autohome_used_china_open');
  return market==='china' && report?.provider==='auto_api_che168' && report.completed===true && !report.failure
    && source?.completeInventory===true && source.rejectedIdentity===0 && source.observations>0
    && /^[a-f0-9]{64}$/.test(source.snapshotBinding) && source.replica?.binding===source.snapshotBinding
    && source.replica?.cursor===source.cursor && source.stopReason==='source_finished';
});
const confirmedWithdrawals = catalogConfirmedWithdrawalIndex(generation.payloads, market);
const freshOfferMetaById = new Map();
let freshOfferMissingIdObservations = 0;
for (const offer of generation.offers) {
  const id = String(offer?.id || "").trim();
  if (!id) {
    freshOfferMissingIdObservations += 1;
    continue;
  }
  const sourceId = String(offer?.sourceId || "unknown");
  const sourceOfferId = String(offer?.sourceOfferId || "");
  const current = freshOfferMetaById.get(id);
  if (current) {
    current.observations += 1;
    current.sourceIds.add(sourceId);
    if (sourceOfferId) current.sourceOfferIds.add(sourceOfferId);
  } else {
    freshOfferMetaById.set(id, {
      id,
      sourceIds: new Set([sourceId]),
      sourceOfferIds: new Set(sourceOfferId ? [sourceOfferId] : []),
      observations: 1,
    });
  }
}
const freshOfferRejectionReasonById = new Map();
function rejectFreshOffer(id, reason) {
  const key = String(id || "").trim();
  if (freshOfferMetaById.has(key)) freshOfferRejectionReasonById.set(key, String(reason || "unknown"));
}
let currentMarketRows = await readMarketOffers(market);
technicalRepairGuard?.assertCurrent(currentMarketRows);
const preparedTargetSnapshot = snapshotCatalogRows(currentMarketRows);
const reserveRows = sellerInventory ? await readMarketMaintenanceOffers(market, {excludeIds: new Set(currentMarketRows.map(row => row.id)), withinRetention:true}) : [];
logPublicationMemory("target_reserve_loaded");
const existingInventory = new Map(reserveRows.map(row => [row.id,row]));
for (const row of currentMarketRows) existingInventory.set(row.id,row);
const retentionDecisions = new Map();
let currentRetainedRows = [...existingInventory.values()].filter((row) => {
  // The verified local replica is a complete active set, including explicit
  // removals and quarantine. Do not resurrect an older retained revision.
  // The purchased Korea snapshot owns its prices and gallery even when an
  // older parser observed the same Encar ID. Never merge those revisions.
  if (paidEncarReport) return false;
  if (completeChe168Inventory && row.sourceId==='autohome_used_china_open' && !freshOfferMetaById.has(String(row.id))) return false;
  if (row?.status !== "active" || catalogOfferWithdrawnByReport(row, confirmedWithdrawals)) return false;
  const decision = catalogRetentionDecision({
    offer: row,
    retentionMs,
    outageGraceMultiplier,
    sourceStates: sourceRefreshStates,
  });
  retentionDecisions.set(String(row.id || ""), decision);
  return decision.retain;
});
// Public rows already replaced their internal duplicates in currentRetainedRows.
// Do not retain the superseded raw payloads until the end of publication.
reserveRows.length = 0;
existingInventory.clear();
const outageProtectedCount = [...retentionDecisions.values()].filter((decision) => decision.reason === "source_outage_grace").length;
const retainedPowerMixMinimumByMarket = { [market]: currentMarketRows.length };
const currentPublicIds = new Set(currentMarketRows.map((offer) => String(offer?.id || "")).filter(Boolean));
const retainedTargetPublicRows = process.env.CATALOG_APPEND_RETAINED_PUBLIC === "1"
  ? currentRetainedRows.filter((offer) => currentPublicIds.has(String(offer?.id || "")))
  : [];
const freshIds = new Set(generation.offers.map(offer => offer.id));
retainedPublishedIds = new Set(currentRetainedRows.filter(offer => !freshIds.has(offer.id)).map(offer => offer.id));
const authoritativeExpiredCount = [...retentionDecisions.values()].filter((decision) => decision.reason === "expired_after_authoritative_refresh").length;
const outageGraceExpiredCount = [...retentionDecisions.values()].filter((decision) => decision.reason === "unverified_retention_expired").length;

// A fresh observation already carries the source evidence required for its
// audit. Keeping the older raw response beside it made China retain several
// gigabytes of duplicate payloads before the first candidate was processed.
// Rows absent from the fresh intake keep their raw evidence unchanged.
currentRetainedRows = currentRetainedRows.map((offer) => freshIds.has(offer.id)
  ? compactPublicStorageOffer(offer)
  : offer);

const candidatesById = new Map();
for (const offer of currentRetainedRows.sort((left, right) => freshness(left) - freshness(right))) {
  const primary = preserveCatalogOfferObservation(offer), retained = candidatesById.get(offer.id);
  const merged = mergeOfferVersions(primary, retained);
  paidContributions?.observeMerge(primary, retained, merged);
      derivedContributions?.observeMerge(primary, retained, merged);
  che168Contributions?.observeMerge(primary, retained, merged, {phase:'retained'});
  candidatesById.set(offer.id, merged);
}
for (const offer of generation.offers.sort((left, right) => freshness(left) - freshness(right))) {
  if (!offer?.id) continue;
  if (catalogOfferWithdrawnByReport(offer, confirmedWithdrawals)) {
    rejectFreshOffer(offer.id, "source:withdrawn");
    continue;
  }
  const retained = candidatesById.get(offer.id), merged = mergeOfferVersions(offer, retained);
  paidContributions?.observeMerge(offer, retained, merged);
      derivedContributions?.observeMerge(offer, retained, merged);
  che168Contributions?.observeMerge(offer, retained, merged);
  candidatesById.set(offer.id, merged);
}

currentRetainedRows = currentRetainedRows.map(compactPublicStorageOffer);
const generatedCandidateCount = generation.offers.length;
const generatedSourceIds = [...new Set(generation.offers.map(offer => String(offer?.sourceId || "")).filter(Boolean))];
generation.offers.length = 0;
const orderedCandidates = [...candidatesById.values()];
candidatesById.clear();
orderedCandidates.sort(qualityOrder);
logPublicationMemory("candidates_merged");
const selected = [];
const selectedIds = new Set();
const imageOwners = new Map();
const sourceCounts = new Map();
const rejectionReasons = {};
const auditedRemovals = new Map();
const selectionCandidateLimit = Math.max(maximumPerMarket, Math.min(100_000, maximumPerMarket * 3));

for (let start = 0; start < orderedCandidates.length && selected.length < selectionCandidateLimit; start += prepareConcurrency) {
  const batch = orderedCandidates.slice(start, start + prepareConcurrency);
  const audited = await runWithConcurrency(batch, prepareConcurrency, auditCandidate);
  if (start === 0 || start % (prepareConcurrency * 32) === 0) {
    logPublicationMemory(`audit_${start}_of_${orderedCandidates.length}`);
    console.log(JSON.stringify({market, stage:"audit_progress", processed:start+batch.length, candidates:orderedCandidates.length, selected:selected.length, rejectionReasons}));
    // Yield so the publication lease heartbeat is not starved.
    await new Promise(resolve => setImmediate(resolve));
  }
  for (const [batchIndex, result] of audited.entries()) {
    if (!result?.offer) {
      const reason = result?.reason || "unknown";
      rejectFreshOffer(batch[batchIndex]?.id, `audit:${reason}`);
      if (reason !== "unknown" && !reason.startsWith("exception:")) auditedRemovals.set(batch[batchIndex].id, `audit:${reason}`);
      rejectionReasons[reason] = Number(rejectionReasons[reason] || 0) + 1;
      continue;
    }
    const offer = result.offer;
    if (selectedIds.has(offer.id)) continue;
    const sourceId = String(offer.sourceId || "unknown");
    if (Number(sourceCounts.get(sourceId) || 0) >= targetPerSource) {
      rejectFreshOffer(offer.id, "selection:source_quota");
      auditedRemovals.set(offer.id, "selection:source_quota");
      rejectionReasons.source_quota = Number(rejectionReasons.source_quota || 0) + 1;
      continue;
    }
    const ownedImages = offer.images.filter((image) => {
      const key = imageKey(image);
      const owner = imageOwners.get(key);
      return !owner || owner === offer.id;
    });
    if (ownedImages.length < minimumPublicationImages(offer, minimumImagesPerOffer, retainedPublishedIds.has(offer.id))) {
      rejectFreshOffer(offer.id, "selection:duplicate_images");
      auditedRemovals.set(offer.id, "selection:duplicate_images");
      rejectionReasons.duplicate_images = Number(rejectionReasons.duplicate_images || 0) + 1;
      continue;
    }
    offer.images = ownedImages;
    selected.push(offer);
    selectedIds.add(offer.id);
    sourceCounts.set(sourceId, Number(sourceCounts.get(sourceId) || 0) + 1);
    for (const image of ownedImages) imageOwners.set(imageKey(image), offer.id);
  }
  // Audited clones now live in selected; the consumed input is no longer needed.
  // Preserve array length for reporting and retain the separate regression baseline.
  for (let index = start; index < Math.min(start + prepareConcurrency, orderedCandidates.length); index++) orderedCandidates[index] = null;
}
for (const offer of orderedCandidates) {
  if (offer) rejectFreshOffer(offer.id, "selection:candidate_limit");
}

// Retained rows pass the same audit as fresh intake. V2 first orders eligible
// inventory; the canonical public stage below then enforces the non-Japan mix.
const v2Selection = selectCatalogV2MarketOffers(selected.sort(qualityOrder), v2Policy);
const selectedMarketOffersById = new Map();
for (const offer of v2Selection.selected.slice(0, maximumPerMarket)) {
  // Check after V2 normalization, which may clear a contradictory body value.
  const reason = sellerInventory ? "" : catalogDescriptionRejectionReason(offer);
  if (reason) {
    rejectFreshOffer(offer.id, `selection:description:${reason}`);
    rejectionReasons[reason] = Number(rejectionReasons[reason] || 0) + 1;
    continue;
  }
  selectedMarketOffersById.set(String(offer.id), offer);
}
const selectedMarketOffers = [...selectedMarketOffersById.values()].slice(0, maximumPerMarket);
paidContributions?.captureSelected(selectedMarketOffers);
      derivedContributions?.captureSelected(selectedMarketOffers);
che168Contributions?.captureSelected(selectedMarketOffers);
for (const offer of selected) if (!selectedMarketOffersById.has(String(offer.id))) {
  rejectFreshOffer(offer.id, "selection:v2_policy");
  auditedRemovals.set(offer.id, "selection:v2_policy");
}
const preservedByMarket = {};
const preservedPublicHashByMarket = {};
const expectedPublishedByMarket = {};
const expectedPublishedHashByMarket = {};
const preservedPublicRowsByMarket = {};
const purgedForbiddenPublicByMarket = {};

async function loadPreservedMarkets() {
  // A one-market refresh must never reconstruct the other markets from
  // retention or quality filters. For a live write this runs under the shared
  // lease, so a waiting publisher cannot overwrite a market published while it
  // was preparing its own candidates.
  for (const otherMarket of PUBLIC_CATALOG_MARKETS) {
    if (otherMarket === market) continue;
    let rows = [];
    try { rows = technicalRepairGuard ? await technicalRepairGuard.readPreservedMarket(otherMarket)
      : await readMarketOffers(otherMarket); } catch (error) {
      throw new Error(`catalog_preserved_public_read_failed:${otherMarket}:${String(error?.message || error)}`);
    }
    // Exact preservation applies only to owner-approved provenance. Rows from a
    // removed adapter/domain are stale public tails: quarantine them from the next
    // generation, while keeping every still-approved row byte-stable. Structural
    // corruption inside the approved set remains a hard stop.
    const forbidden = rows.filter((offer) => !hasAllowedCatalogSourceProvenance(offer));
    if (technicalRepairGuard && forbidden.length) throw Error('paid_repair_other_market_would_change');
    const preservedRows = rows.filter((offer) => hasAllowedCatalogSourceProvenance(offer));
    const invalid = preservedRows.filter((offer) => !offer?.id || !offer?.make || !offer?.model
      || String(offer?.market || "") !== otherMarket
      || !(otherMarket==='uae'&&offer?.sourceId==='dubicars_uae_exact')&&!isCatalogYearAllowed(offer?.year, otherMarket)
      || !Array.isArray(offer?.images) || (offer.images.length === 0&&!isAllDubicarsOffer(offer)));
    if (invalid.length) throw new Error(`catalog_preserved_public_gate_failed:${otherMarket}:${invalid.length}`);
    purgedForbiddenPublicByMarket[otherMarket] = forbidden.length;
    preservedByMarket[otherMarket] = preservedRows.length;
    preservedPublicHashByMarket[otherMarket] = hashRows(preservedRows);
    preservedPublicRowsByMarket[otherMarket] = preservedRows;
    expectedPublishedByMarket[otherMarket] = preservedRows.length;
    expectedPublishedHashByMarket[otherMarket] = preservedPublicHashByMarket[otherMarket];
  }
}

const canonicalTargetPreview = await previewCanonicalPublicCatalogOffers(selectedMarketOffers, retainedTargetPublicRows, currentPublicIds, retainedPowerMixMinimumByMarket);
const technicalRepairPreflight = technicalRepairGuard?.assertRows(canonicalTargetPreview.offers);
const nextIds = new Set(canonicalTargetPreview.offers.map(offer => offer.id));
for (const [field, reason] of [
  ["qualityRejected", "canonical:qualityRejected"],
  ["identityRejected", "canonical:identityRejected"],
  ["priceOutliers", "canonical:priceOutliers"],
]) {
  for (const offer of canonicalTargetPreview[field]) {
    rejectFreshOffer(offer.id, reason);
    auditedRemovals.set(offer.id, reason);
  }
}
for (const offer of canonicalTargetPreview.quota.removed) {
  rejectFreshOffer(offer.id, "canonical:model_year_quota");
  auditedRemovals.set(offer.id, "canonical:model_year_quota");
}
for (const pair of canonicalTargetPreview.deduplicated.removed) {
  rejectFreshOffer(pair.removedId, `canonical:duplicate:${pair.keptId}`);
  if (nextIds.has(pair.keptId)) auditedRemovals.set(pair.removedId, `canonical:duplicate:${pair.keptId}`);
}
for (const offer of canonicalTargetPreview.powerMix.removed) {
  rejectFreshOffer(offer.id, "canonical:power_mix_80_20");
  auditedRemovals.set(offer.id, "canonical:power_mix_80_20");
}
for (const offer of canonicalTargetPreview.sourceShare.removed) {
  rejectFreshOffer(offer.id, "canonical:autohome_2026_share_10_percent");
  auditedRemovals.set(offer.id, "canonical:autohome_2026_share_10_percent");
}
const freshOfferAuditEntries = [...freshOfferMetaById.values()]
  .sort((left, right) => left.id.localeCompare(right.id))
  .map((meta) => {
    const admitted = nextIds.has(meta.id);
    return {
      id: meta.id,
      sourceIds: [...meta.sourceIds].sort(),
      sourceOfferIds: [...meta.sourceOfferIds].sort(),
      observations: meta.observations,
      outcome: admitted ? "admitted" : "rejected",
      reason: admitted ? "canonical:admitted" : (freshOfferRejectionReasonById.get(meta.id) || "unexplained"),
    };
  });
const freshOfferAuditReasonCounts = freshOfferAuditEntries.reduce((out, row) => {
  out[row.reason] = Number(out[row.reason] || 0) + 1;
  return out;
}, {});
const freshOfferAuditUnexplained = Number(freshOfferAuditReasonCounts.unexplained || 0);
const freshOfferAudit = {
  scope: "canonical_preflight",
  summary: {
    uniqueFreshOfferIds: freshOfferAuditEntries.length,
    admitted: freshOfferAuditEntries.filter((row) => row.outcome === "admitted").length,
    rejected: freshOfferAuditEntries.filter((row) => row.outcome === "rejected").length,
    duplicateObservations: freshOfferAuditEntries.reduce((sum, row) => sum + Math.max(0, row.observations - 1), 0),
    missingIdObservations: freshOfferMissingIdObservations,
    complete: freshOfferAuditUnexplained === 0 && freshOfferMissingIdObservations === 0,
    unexplained: freshOfferAuditUnexplained,
    reasons: freshOfferAuditReasonCounts,
  },
  entries: freshOfferAuditEntries,
};
const publicationPolicy = { allowSellerTransition: true, auditedRemovals };

const preflight = { market, published:false, dryRun, previousManifestPreserved:true,
  ...(technicalRepairPreflight ? {technicalRepair:{receiptSha256:technicalRepairReceipt.sha256, verified:true,
    after:technicalRepairPreflight, examples:technicalRepairGuard.examples(canonicalTargetPreview.offers)}} : {}),
  sourceShare: canonicalTargetPreview.sourceShare.report,
  powerMix: canonicalTargetPreview.powerMix.report,
  auditedRemovals: currentRetainedRows.filter(offer=>!nextIds.has(offer.id)).map(offer=>({id:offer.id,reason:auditedRemovals.get(offer.id)||"unexplained"})),
  generated:generatedCandidateCount, retained:currentRetainedRows.length, candidates:orderedCandidates.length,
  selected:selected.length, canonical:canonicalTargetPreview.offers.length,
  calculated:canonicalTargetPreview.offers.filter(hasExactCalculation).length,
  sellerOnly:canonicalTargetPreview.offers.filter(isSellerPricedOffer).length,
  retainedTargetPublicCount:retainedTargetPublicRows.length,
  rejectionReasons,
  beforeCanonicalCalculated:selectedMarketOffers.filter(hasExactCalculation).length,
  identityRejected:canonicalTargetPreview.identityRejected.length,
  outlierRejected:canonicalTargetPreview.priceOutliers.length,
  duplicateRejected:canonicalTargetPreview.deduplicated.removed?.length,
  quotaRejected:canonicalTargetPreview.quota.removed.length,
  canonicalRejections:canonicalTargetPreview.qualityRejected.reduce((out,offer)=>{ const key=String(offer.calculationStatus);out[key]=(out[key]||0)+1;return out;},{}),
  lostRetained:currentRetainedRows.filter(offer=>!nextIds.has(offer.id)).slice(0,10).map(offer=>({id:offer.id,sourceId:offer.sourceId,status:offer.calculationStatus})),
  freshOfferAudit,
};
await fs.writeFile(reportFile, JSON.stringify(preflight,null,2));
console.log(JSON.stringify({
  ...preflight,
  auditedRemovals: preflight.auditedRemovals.slice(0, 5),
  freshOfferAudit: freshOfferAudit.summary,
}));
logPublicationMemory("preflight_complete");
if (!freshOfferAudit.summary.complete) {
  throw new Error(`catalog_fresh_offer_audit_incomplete:${market}:${freshOfferAudit.summary.unexplained}:${freshOfferAudit.summary.missingIdObservations}`);
}
if (dryRun) {
  await loadPreservedMarkets();
  await technicalRepairGuard?.verifyAuthority();
  process.exit(0);
}
if (sellerInventory) assertNoDeliveredPriceRegression(currentRetainedRows, canonicalTargetPreview.offers, publicationPolicy);
expectedPublishedByMarket[market] = canonicalTargetPreview.offers.length;
expectedPublishedHashByMarket[market] = hashRows(canonicalTargetPreview.offers);

// Keep counts for the report, then release consumed candidates before loading
// maintenance state. Technical tables are retained in selected offers in full.
const retainedCandidateCount = currentRetainedRows.length;
const previousPublicCount = currentMarketRows.length;
const previousSourceCounts = countSources(currentMarketRows);
const expiredPublicIds = new Set(currentMarketRows.filter(row => catalogOfferRetentionExpired(row) || !sourceInventoryInScope(row)).map(row=>row.id));
const withdrawnSourceCounts = countSources(currentMarketRows.filter(row => catalogOfferWithdrawnByReport(row, confirmedWithdrawals)
  // The same dated 14/30-day policy already removed these candidates above.
  // Keeping them in the safety baseline made legitimate expiry block all future publication.
  || expiredPublicIds.has(row.id) || !sourceInventoryInScope(row)));
const replaceInternalSourceIds = new Set([
  ...currentRetainedRows.map(offer => String(offer?.sourceId || "")),
  ...generatedSourceIds,
  ...Object.keys(sourceRefreshStates),
].filter(Boolean));
generation.offers.length = 0;
currentRetainedRows.length = 0;
const unavailableOffers = currentMarketRows.filter(row => !nextIds.has(row.id)).map(row => unavailableOfferRecord(row, confirmedWithdrawals));
currentMarketRows = [];
reserveRows.length = 0;
existingInventory.clear();
orderedCandidates.length = 0;
selected.length = 0;
v2Selection.selected.length = 0;
candidatesById.clear();
const purgedForbiddenInternalByMarket = Object.fromEntries(PUBLIC_CATALOG_MARKETS.map(id => [id, 0]));

const unique = new Map();
for (const offer of selectedMarketOffers) {
  if (offer?.id && !unique.has(offer.id)) unique.set(offer.id, offer);
}
for (const offer of retainedTargetPublicRows) {
  if (offer?.id) unique.set(offer.id, offer);
}
// Keep the internal maintenance state a superset of every exact public row,
// including rows restored from an older verified public generation.
for (const rows of Object.values(preservedPublicRowsByMarket)) {
  for (const offer of rows) if (offer?.id && !unique.has(offer.id)) unique.set(offer.id, offer);
}
const allOffers = [...unique.values()];
const previousRetainedCount = retainedCandidateCount;
const completedSourceIds = new Set(freshOfferAudit.summary.complete
  ? Object.values(sourceRefreshStates).filter(state => state?.observed && state?.authoritative
    && Number(state?.liveReports || 0) > 0 && Number(state?.freshSaved || 0) > 0
    && state?.stopReasons?.length && state.stopReasons.every(reason => reason === 'source_finished'))
    .map(state => state.sourceId)
  : []);
const publicCountGuard = catalogPublicCountGuard(previousSourceCounts,
  countSources(canonicalTargetPreview.offers), withdrawnSourceCounts, minimumPublicRetentionRatio,
  {completedSources:completedSourceIds, completedSourceCounts:countSources(selectedMarketOffers)});
const minimumSafePublicCount = allowPublicCollapse ? 1 : publicCountGuard.minimumTotal;
const catastrophicPublicCollapse = !publicCountGuard.ok;
const regressionBlocked = expectedPublishedByMarket[market] <= 0
  || (catastrophicPublicCollapse && !allowPublicCollapse);
let manifest = null;
let publicationError = "";
let rawPublication = null, rawPinRelease = null, rawInternalPublication = null;
let paidInternalContribution = null, paidPublicContribution = null;
let che168InternalContribution = null, che168PublicContribution = null;
let technicalRepairReadback = null;
let nextPublicCount = 0;
let publishedSourceCounts = {};

function countSources(rows) {
  return rows.reduce((counts, offer) => {
    const source = String(offer.sourceId || 'unknown');
    counts[source] = (counts[source] || 0) + 1;
    return counts;
  }, {});
}

if (regressionBlocked) {
  await loadPreservedMarkets();
  publicationError = `catalog_public_regression_guard:${market}:${expectedPublishedByMarket[market]}:${minimumSafePublicCount}`;
} else if (selectedMarketOffers.length > 0) {
  try {
    // Candidate preparation is read-only and may run in parallel across
    // markets. Serialize only the generation snapshot and writes. Recheck the
    // target market and storage after acquiring the lease; no stale snapshot is
    // allowed to reach persistence.
    await acquirePublishLock();
    await assertRequestedRecoveryBaseline();
    await technicalRepairGuard?.verifyAuthority({operationId:publishOperationId});
          await derivedDateGuard?.verifyAuthority({operationId:publishOperationId});
    await assertCurrentKoreaPublicationSource();
    if (process.env.JSON_STORAGE_DRIVER === "object") await import("./catalog-storage-preflight.mjs");
    expectedBaseGenerationId = await catalogGenerationId();
    const latestTargetRows = await readMarketOffers(market);
    assertCatalogRowsUnchanged(preparedTargetSnapshot, latestTargetRows, market);
    await loadPreservedMarkets();
    process.env.CATALOG_GROW_ONLY_MARKETS = "";
    logPublicationMemory("before_persist");
    manifest = await persistCatalogOffers(allOffers, {
      productionRefreshMarket: market,
      expectedBaseGenerationId,
      ...(market !== 'japan' && getJsonStorage().driver === 'object' ? {
        publicationTransactionVersion: 2,
        requirePreparedWorkingSet: Boolean(derivedDateGuard),
        beforePreparedReadiness: async candidate => {
          const verify = await prepareStagedCatalogBudget({storage:getJsonStorage(), manifest:candidate,
            expectedBaseGenerationId, operationId:publishOperationId, requireWorkingSet:Boolean(paidEncarReport?.savedRevisionSelection)});
          if (derivedDateGuard && verify.workingSetVerified !== true) throw Error('derived_working_set_gate_required');
          return {verify, workingSetVerified: verify.workingSetVerified === true};
        },
        rawCoordinationTicket: () => rawPublication?.binding?.ticket,
        beforePreparedInternalManifest: async ({manifest: internalManifest, baseManifest}) => {
          const storage = getJsonStorage();
          paidInternalContribution = await preparePaidInternalContribution({storage, manifest: internalManifest,
            contributions: paidContributions, reusableKoreaSourceIds: allowedCatalogSourceIds('korea')});
          if (derivedDateGuard) derivedInternalContribution = await prepareDerivedInternalContribution({storage,manifest:internalManifest,tracker:derivedContributions});
          che168InternalContribution = await prepareChe168InternalContribution({storage, manifest: internalManifest,
            contributions: che168Contributions,reusableSourceIds:allowedCatalogSourceIds('china')});
          rawInternalPublication = await prepareRawInternalPublication({storage, manifest: internalManifest, baseManifest,
            intake: generation.payloads.find(payload => payload.report?.market === market)?.report,
            operationId: publishOperationId,
            contributionCapabilities: [paidInternalContribution,che168InternalContribution].filter(Boolean)});
          if (derivedDateGuard) {
            const verifyRaw = rawInternalPublication.verifyBeforeCommit.bind(rawInternalPublication);
            rawInternalPublication.verifyBeforeCommit = async () => {
              await verifyDerivedContribution({capability:derivedInternalContribution,manifest:internalManifest,stage:'internal'});
              await verifyRaw();
              await assertDerivedRawRetention({storage,capability:derivedInternalContribution,manifest:internalManifest,stage:'internal'});
            };
          }
          return rawInternalPublication;
        },
        beforePreparedGeneration: async candidate => {
          paidPublicContribution = await preparePaidPublicContribution({storage: getJsonStorage(), manifest: candidate,
            contributions: paidContributions, internal: paidInternalContribution, readProjectionBatches: readCatalogProjectionBatches});
          if (derivedDateGuard) derivedPublicContribution = await prepareDerivedPublicContribution({storage:getJsonStorage(),manifest:candidate,tracker:derivedContributions,internal:derivedInternalContribution,readProjectionBatches:readCatalogProjectionBatches});
          che168PublicContribution = await prepareChe168PublicContribution({storage:getJsonStorage(),manifest:candidate,
            contributions:che168Contributions,internal:che168InternalContribution,readProjectionBatches:readCatalogProjectionBatches});
          rawPublication = await prepareRawPublication({storage:getJsonStorage(), manifest:candidate,
            expectedBaseGenerationId, market, operationId:publishOperationId,
            contributions: paidPublicContribution || che168PublicContribution,
            intake:generation.payloads.find(payload => payload.report?.market === market)?.report});
          if (derivedDateGuard) {
            const verifyRaw = rawPublication.verify.bind(rawPublication);
            rawPublication.verify = async () => {
              await verifyDerivedContribution({capability:derivedPublicContribution,manifest:candidate,stage:'public'});
              await verifyRaw();
              await assertDerivedRawRetention({storage:getJsonStorage(),capability:derivedPublicContribution,manifest:candidate,stage:'public'});
            };
          }
          await rawPublication.verify();
          await technicalRepairGuard?.verifyAuthority({operationId:publishOperationId});
          await derivedDateGuard?.verifyAuthority({operationId:publishOperationId});
          return async () => {
            await rawPublication.verify();
            await technicalRepairGuard?.verifyAuthority({operationId:publishOperationId});
          await derivedDateGuard?.verifyAuthority({operationId:publishOperationId});
          };
        },
      } : {}),
      async beforeManifestCommit() {
        await technicalRepairGuard?.verifyAuthority({operationId:publishOperationId});
        if (process.env.CATALOG_CHUNKED_PROJECTIONS_WRITE === '1') await assertScopedProjectionReaderReady();
          await derivedDateGuard?.verifyAuthority({operationId:publishOperationId});
        await assertCurrentKoreaPublicationSource();
        if (paidEncarReport) {
          const { assertCollectionEnabled } = await import("../apps/web/lib/catalog/collection-controls.ts");
          await assertCollectionEnabled("encar_feed");
        }
        independentHeartbeat?.assertHealthy();
        await publishLockHeartbeatPromise;
        await mutateDataJson(publishLockPath, { lockedUntil: "" }, (current) => {
          if (current?.operationId !== publishOperationId || Date.parse(current.lockedUntil) <= Date.now()) throw new Error("catalog_publish_lock_lost");
          return { ...current, lockedUntil: new Date(Date.now() + publishLockTtlMs).toISOString(), heartbeatAt: new Date().toISOString() };
        });
      },
      retainedPowerMixIds: currentPublicIds,
      retainedPowerMixMinimumByMarket,
      unavailableOffers,
      // Internal chunks are immutable and the manifest protects referenced
      // paths. Replace only this market's sources and reuse every untouched
      // source entry without a full read/rewrite cycle.
      replaceInternalSourceIds,
      ...(retainedTargetPublicRows.length ? { appendPublicOffersByMarket: { [market]: retainedTargetPublicRows } } : {}),
      preservePublicOffersByMarket: preservedPublicRowsByMarket,
      beforePersistValidate(publicOffers) {
        technicalRepairGuard?.assertRows(publicOffers.filter(offer => offer.market === market));
        if (sellerInventory) assertNoDeliveredPriceRegression(canonicalTargetPreview.offers, publicOffers.filter(offer => offer.market === market), {allowSellerTransition:true});
        const failures = [];
        for (const otherMarket of PUBLIC_CATALOG_MARKETS) {
          if (otherMarket === market) continue;
          const rows = publicOffers.filter((offer) => String(offer?.market || "") === otherMarket);
          const expectedCount = Number(preservedByMarket[otherMarket] || 0);
          const expectedHash = preservedPublicHashByMarket[otherMarket];
          if (rows.length !== expectedCount) failures.push(`${otherMarket}:count:${rows.length}:${expectedCount}`);
          if (hashRows(rows) !== expectedHash) failures.push(`${otherMarket}:hash`);
        }
        if (failures.length) throw new Error(`catalog_prewrite_preservation_gate_failed:${failures.join("|")}`);
        paidContributions?.captureNormalized(publicOffers.filter(offer => offer.market === market));
      derivedContributions?.captureNormalized(publicOffers.filter(offer => offer.market === market));
        che168Contributions?.captureNormalized(publicOffers.filter(offer => offer.market === market));
      },
      beforePublishValidate(publishedOffers) {
        if (publishedOffers.some(offer => requiredAbsentOfferIds.includes(offer.id))) throw Error('catalog_confirmed_withdrawal_still_published');
        technicalRepairGuard?.assertRows(publishedOffers.filter(offer => offer.market === market));
        if (sellerInventory) assertNoDeliveredPriceRegression(canonicalTargetPreview.offers, publishedOffers.filter(offer => offer.market === market), {allowSellerTransition:true});
        const failures = [];
        for (const currentMarket of PUBLIC_CATALOG_MARKETS) {
          const rows = publishedOffers.filter((offer) => String(offer?.market || "") === currentMarket);
          if (currentMarket === market) {
            if (!allowPublicCollapse) {
              const guard = catalogPublicCountGuard(previousSourceCounts, countSources(rows), withdrawnSourceCounts, minimumPublicRetentionRatio,
                {completedSources:completedSourceIds, completedSourceCounts:countSources(selectedMarketOffers)});
              if (!guard.ok) failures.push(`${currentMarket}:sources:${JSON.stringify(guard.failures)}`);
            }
            if (rows.length < minimumSafePublicCount) failures.push(`${currentMarket}:count:${rows.length}:${minimumSafePublicCount}`);
            expectedPublishedByMarket[currentMarket] = rows.length;
            expectedPublishedHashByMarket[currentMarket] = hashRows(rows);
            continue;
          }
          const expectedCount = Number(expectedPublishedByMarket[currentMarket] || 0);
          const expectedHash = expectedPublishedHashByMarket[currentMarket];
          if (rows.length !== expectedCount) failures.push(`${currentMarket}:count:${rows.length}:${expectedCount}`);
          if (hashRows(rows) !== expectedHash) failures.push(`${currentMarket}:hash`);
        }
        nextPublicCount = publishedOffers.filter((offer) => String(offer?.market || "") === market).length;
        publishedSourceCounts = countSources(publishedOffers.filter(offer => offer.market === market));
        if (failures.length) throw new Error(`catalog_public_regression_guard:${failures.join("|")}`);
        paidContributions?.captureFinal(publishedOffers.filter(offer => offer.market === market));
      derivedContributions?.captureFinal(publishedOffers.filter(offer => offer.market === market));
        che168Contributions?.captureFinal(publishedOffers.filter(offer => offer.market === market));
      },
    });
    if (technicalRepairGuard) technicalRepairReadback = await technicalRepairGuard.verifyPublished(manifest.generationId, publishOperationId);
    if (rawPublication) rawPinRelease = await rawPublication.afterCommit();
  } catch (error) {
    publicationError = String(error?.message || error);
    console.error(error?.stack || publicationError);
  }
} else {
  await loadPreservedMarkets();
  publicationError = `catalog_v2_empty_market:${market}`;
}

const byMarket = Object.fromEntries(PUBLIC_CATALOG_MARKETS.map((marketId) => [
  marketId,
  marketId === market ? (manifest ? nextPublicCount : previousPublicCount) : Number(preservedByMarket[marketId] || 0),
]));
const publishedMarketCount = Number(byMarket[market] || 0);
const calculatedCount = canonicalTargetPreview.offers.filter((offer) => hasExactCalculation(offer)).length;
const calculationPendingCount = canonicalTargetPreview.offers.length - calculatedCount;
const preliminaryRejectedCount = canonicalTargetPreview.qualityRejected
  .filter((offer) => String(offer?.calculationStatus || "") === "preliminary_power_pending"
    || offer?.calculationSnapshot?.pricingConfidence === "preliminary")
  .length;
const report = {
  version: 5,
  mode: "catalog_v2_independent_market",
  market,
  publishedAt: new Date().toISOString(),
  published: Boolean(manifest),
  publicationError,
  ...(technicalRepairReceipt ? {technicalRepair:technicalRepairReadback || {receiptSha256:technicalRepairReceipt.sha256, verified:false}} : {}),
  rawPinRelease,
  rawCoordination: rawPublication?.binding || null,
  generationId: manifest?.generationId || null,
  previousManifestPreserved: !manifest,
  retentionMs,
  defaultRetentionMs,
  japanRetentionMs,
  outageGraceMultiplier,
  outageGraceMs: retentionMs * outageGraceMultiplier,
  outageProtectedCount,
  authoritativeExpiredCount,
  outageGraceExpiredCount,
  sourceRefreshStates,
  confirmedWithdrawals: [...confirmedWithdrawals.values()],
  targetPerSource,
  targetPerMarket,
  maximumPerMarket,
  selectedMarketCount: selectedMarketOffers.length,
  freshOfferAudit,
  specificationCoverage: {
    auditedRemovals: preflight.auditedRemovals,
    recordsWithNamedGroups: canonicalTargetPreview.offers.filter(offer=>offer.operational?.sourceSpecifications?.groups?.length).length,
    namedFields: canonicalTargetPreview.offers.reduce((sum,offer)=>sum+(offer.operational?.sourceSpecifications?.groups || []).reduce((n,group)=>n+group.items.length,0),0),
    sellerPriceOnly: canonicalTargetPreview.offers.filter(isSellerPricedOffer).length,
    note:"Named groups may be listing fields; their presence is not proof of a complete manufacturer specification.",
  },
  publishedMarketCount,
  sourceShare: canonicalTargetPreview.sourceShare.report,
  powerMix: canonicalTargetPreview.powerMix.report,
  addedCount: publishedMarketCount - previousPublicCount,
  shortage: Math.max(0, targetPerMarket - publishedMarketCount),
  total: Object.values(byMarket).reduce((sum, count) => sum + Number(count || 0), 0),
  byMarket,
  byMarketAndSource: {
    [market]: manifest ? publishedSourceCounts : previousSourceCounts,
  },
  selectedCandidatesBySource: Object.fromEntries(sourceCounts),
  sourceCoverage: requiredCatalogSourceIds(market).map(sourceId=>({sourceId,
    observed:Boolean(sourceRefreshStates[sourceId]?.observed),
    collected:Number(sourceRefreshStates[sourceId]?.freshSaved || 0),
    published:Number((manifest ? publishedSourceCounts : previousSourceCounts)[sourceId] || 0),
    stopReasons:sourceRefreshStates[sourceId]?.stopReasons || ['not_observed']})),
  sourceCoverageComplete: requiredCatalogSourceIds(market).every(sourceId=>
    sourceRefreshStates[sourceId]?.observed && Number(publishedSourceCounts[sourceId] || 0)>0
    && sourceRefreshStates[sourceId]?.stopReasons?.every(reason=>reason==='source_finished')),
  calculationCoverageScope: "canonical_candidates",
  marketQuality: {
    [market]: {
      target: targetPerMarket,
      targetReached: publishedMarketCount >= targetPerMarket,
      shortage: Math.max(0, targetPerMarket - publishedMarketCount),
      generatedCandidates: generatedCandidateCount,
      retainedCandidates: retainedCandidateCount,
      previousRetainedCount,
      previousPublicCount,
      expiredPublicCount: expiredPublicIds.size,
      nextPublicCount,
      publicCountGuard,
      minimumPublicRetentionRatio,
      minimumSafePublicCount,
      catastrophicPublicCollapse,
      regressionBlocked,
      published: publishedMarketCount,
      calculatedCount,
      calculationPendingCount,
      calculatedShare: canonicalTargetPreview.offers.length ? Number((calculatedCount / canonicalTargetPreview.offers.length).toFixed(4)) : 0,
      preliminaryRejectedCount,
      priorityCount: v2Selection.priorityCount,
      lowPowerCount: v2Selection.lowPowerCount,
      lowPowerShare: selectedMarketOffers.length ? Number((v2Selection.lowPowerCount / selectedMarketOffers.length).toFixed(4)) : 0,
      auctionCount: v2Selection.auctionCount,
      recentCount: v2Selection.recentCount,
      extendedCount: v2Selection.extendedCount,
      fallbackUnlocked: v2Selection.fallbackUnlocked,
      shortageToUnlock: v2Selection.shortageToUnlock,
      outageProtectedCount,
      authoritativeExpiredCount,
      outageGraceExpiredCount,
      sourceRefreshStates,
      rejectionReasons,
      generationErrors: generation.errors,
      generationStopReasons: generation.payloads.map((payload) => payload.stopReason || payload.report?.stopReason || "unknown"),
    },
  },
  files: generation.filenames,
  purgedForbiddenPublicByMarket,
  purgedForbiddenInternalByMarket,
  preservedByMarket,
  preservedPublicHashByMarket,
  expectedPublishedByMarket,
  expectedPublishedHashByMarket,
};

await fs.writeFile(reportFile, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, (key, value) => {
  if (key === "auditedRemovals" && Array.isArray(value)) return { count: value.length, sample: value.slice(0, 5) };
  if (key === "freshOfferAudit" && value?.summary) return value.summary;
  return value;
}, 2));
if (!report.published || technicalRepairReceipt && !technicalRepairReadback?.verified) process.exitCode = 1;
} finally {
  await releasePublishLock();
}
