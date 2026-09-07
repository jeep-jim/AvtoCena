import fs from 'node:fs/promises';
import { GoodCarCarsListClient, GOOD_CAR_CARSLIST_PAGE_SIZE } from '../apps/web/lib/catalog/chngoodcar-carslist';
import {
  goodCarIdentityNamedElectrifiedKind,
  type GoodCarPaginatedExactRawOffer,
} from '../apps/web/lib/catalog/chngoodcar-paginated-exact-source';
import { ChnGoodCarReviewedPaginatedExactAdapter } from '../apps/web/lib/catalog/chngoodcar-reviewed-exact-source';
import { goodCarManualPriceReviewReason } from '../apps/web/lib/catalog/chngoodcar-price-review';
import { goodCarVerifiedReferenceConflict } from '../apps/web/lib/catalog/chngoodcar-reference-conflicts';
import { isGoodCarIceFuel, isGoodCarPassengerBodyType } from '../apps/web/lib/catalog/chngoodcar-exact-source';
import { isAllowedCatalogSourceId } from '../apps/web/lib/catalog/required-catalog-sources';
import { stratifiedGoodCarPages } from './catalog-source-chngoodcar-list-exhaustion-v1';

const OUTPUT_PATH = process.env.CATALOG_SOURCE_CHNGOODCAR_LIST_EXHAUSTION_V2_OUTPUT || 'catalog-source-chngoodcar-list-exhaustion-v2.json';
const SOURCE_ID = 'chngoodcar_china_candidate';
const MAX_LIST_PAGES = Math.max(1, Math.min(120, Number(process.env.CATALOG_CHNGOODCAR_LIST_EXHAUSTION_MAX_PAGES || 110)));
const SAMPLE_PAGE_COUNT = Math.max(3, Math.min(8, Number(process.env.CATALOG_CHNGOODCAR_LIST_EXHAUSTION_SAMPLE_PAGES || 6)));
const PAGE_DELAY_MS = Math.max(0, Math.min(1500, Number(process.env.CATALOG_CHNGOODCAR_LIST_EXHAUSTION_DELAY_MS || 150)));

function sleep(ms: number) { return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve(); }

async function classificationDecision() {
  const payload = JSON.parse(await fs.readFile('data/catalog/source-partial-classification-v1.json', 'utf8'));
  return payload.decisions?.find((row: any) => row.sourceId === SOURCE_ID) || null;
}

function rejectionReasons(row: GoodCarPaginatedExactRawOffer) {
  const reasons: string[] = [];
  const priceReview = goodCarManualPriceReviewReason(row);
  if (priceReview) reasons.push(`manual_price_review:${priceReview}`);
  if (row.listCurrencyVerified !== true || row.currencyLabelVerified !== true) reasons.push('currency_contract');
  if (row.listDetailTitleParity !== true) reasons.push('title_parity');
  if (row.listDetailPriceParity !== true) reasons.push('price_parity');
  if (row.listDetailProductionDateParity !== true) reasons.push('production_date_parity');
  if (row.listDetailMileageParity !== true) reasons.push('mileage_parity');
  if (goodCarIdentityNamedElectrifiedKind(row.sourceTitle)) reasons.push('identity_named_electrified');
  if (goodCarVerifiedReferenceConflict(row)) reasons.push('verified_reference_conflict');
  if (!isGoodCarIceFuel(row.fuel)) reasons.push('electrified_or_non_ice');
  if (!isGoodCarPassengerBodyType(row.bodyType)) reasons.push('non_passenger_or_missing_body');
  if (!(row.engineCc > 0)) reasons.push('engine_cc');
  if (!(row.powerKw > 0)) reasons.push('power_kw');
  if ((row.imageUrls?.length || 0) < 5) reasons.push('gallery');
  if (!reasons.length) reasons.push('identity_make_model_gate');
  return reasons;
}

function safeAccepted(offer: any, images: any[], raw: GoodCarPaginatedExactRawOffer, page: number) {
  return {
    page,
    sourceOfferId: offer.sourceOfferId,
    sourceTitle: offer.sourceTitle,
    make: offer.make,
    model: offer.model,
    year: offer.year,
    productionDate: offer.productionDate,
    mileageKm: offer.mileageKm,
    engineCc: offer.engineCc,
    fuel: offer.fuel,
    bodyType: offer.bodyType,
    transmission: offer.transmission,
    drive: offer.drive,
    powerKw: offer.powerKw,
    powerHp: offer.powerHp,
    sourcePrice: offer.sourcePrice,
    sourceCurrency: offer.sourceCurrency,
    imageCount: images.length,
    listDetailTitleParity: raw.listDetailTitleParity,
    listDetailPriceParity: raw.listDetailPriceParity,
    listDetailProductionDateParity: raw.listDetailProductionDateParity,
    listDetailMileageParity: raw.listDetailMileageParity,
  };
}

export async function runGoodCarListExhaustionV2() {
  const decision = await classificationDecision();
  const listClient = new GoodCarCarsListClient();
  const first = await listClient.fetchPage(1);
  const initialTotal = first.total;
  const expectedPageCount = Math.max(1, Math.ceil(initialTotal / GOOD_CAR_CARSLIST_PAGE_SIZE));
  const requestedPageCount = Math.min(expectedPageCount, MAX_LIST_PAGES);

  const rawIds = new Set<string>();
  const identityIds = new Set<string>();
  const duplicateRawIds: string[] = [];
  const duplicateIdentityIds: string[] = [];
  const rejectedIdentityReasons: Record<string, number> = {};
  const pageReports: any[] = [];
  const totals: number[] = [];

  for (let page = 1; page <= requestedPageCount; page += 1) {
    const listPage = page === 1 ? first : await listClient.fetchPage(page);
    totals.push(listPage.total);
    for (const id of listPage.rawNumericIds) {
      if (rawIds.has(id)) duplicateRawIds.push(id);
      rawIds.add(id);
    }
    for (const row of listPage.items) {
      if (identityIds.has(row.sourceOfferId)) duplicateIdentityIds.push(row.sourceOfferId);
      identityIds.add(row.sourceOfferId);
    }
    for (const [reason, count] of Object.entries(listPage.rejectedIdentityReasons)) {
      rejectedIdentityReasons[reason] = (rejectedIdentityReasons[reason] || 0) + Number(count || 0);
    }
    pageReports.push({
      page,
      total: listPage.total,
      rawRows: listPage.rawRowCount,
      identityRows: listPage.items.length,
      rejectedIdentityRows: listPage.rejectedIdentityRowCount,
      rejectedIdentityReasons: listPage.rejectedIdentityReasons,
      firstRawId: listPage.rawNumericIds[0] || null,
      lastRawId: listPage.rawNumericIds.at(-1) || null,
    });
    if (page < requestedPageCount) await sleep(PAGE_DELAY_MS);
  }

  const samplePages = stratifiedGoodCarPages(requestedPageCount, SAMPLE_PAGE_COUNT);
  const adapter = new ChnGoodCarReviewedPaginatedExactAdapter();
  const accepted: any[] = [];
  const rejected: any[] = [];
  const blockedManualPriceReview: any[] = [];
  const blockedIdentityElectrified: any[] = [];
  const blockedReferenceConflicts: any[] = [];
  const blockedElectrified: string[] = [];
  const blockedNonPassenger: string[] = [];
  const detailPageReports: any[] = [];

  for (const page of samplePages) {
    const result = await adapter.fetchPage(String(page));
    const rawRows = result.items as GoodCarPaginatedExactRawOffer[];
    for (const row of rawRows) {
      const priceReviewReason = goodCarManualPriceReviewReason(row);
      const namedElectrified = goodCarIdentityNamedElectrifiedKind(row.sourceTitle);
      const referenceConflict = goodCarVerifiedReferenceConflict(row);
      const offer = adapter.normalizeOffer(row);
      if (priceReviewReason) {
        if (offer) throw new Error(`manual_price_review_offer_must_fail_closed:${row.sourceOfferId}`);
        blockedManualPriceReview.push({ page, sourceOfferId: row.sourceOfferId, sourceTitle: row.sourceTitle, year: row.year, sourcePrice: row.sourcePrice, sourceCurrency: row.currency, reason: priceReviewReason });
        continue;
      }
      if (namedElectrified) {
        if (offer) throw new Error(`identity_electrified_offer_must_fail_closed:${row.sourceOfferId}`);
        blockedIdentityElectrified.push({ page, sourceOfferId: row.sourceOfferId, sourceTitle: row.sourceTitle, namedKind: namedElectrified, detailFuel: row.fuel });
        continue;
      }
      if (referenceConflict) {
        if (offer) throw new Error(`reference_conflict_offer_must_fail_closed:${row.sourceOfferId}`);
        blockedReferenceConflicts.push({ page, sourceOfferId: row.sourceOfferId, sourceTitle: row.sourceTitle, ...referenceConflict });
        continue;
      }
      if (!isGoodCarIceFuel(row.fuel)) {
        if (offer) throw new Error(`electrified_offer_must_fail_closed:${row.sourceOfferId}`);
        blockedElectrified.push(row.sourceOfferId);
        continue;
      }
      if (!isGoodCarPassengerBodyType(row.bodyType)) {
        if (offer) throw new Error(`non_passenger_offer_must_fail_closed:${row.sourceOfferId}`);
        blockedNonPassenger.push(row.sourceOfferId);
        continue;
      }
      if (!offer) {
        rejected.push({ page, sourceOfferId: row.sourceOfferId, sourceTitle: row.sourceTitle, reasons: rejectionReasons(row) });
        continue;
      }
      const images = await adapter.fetchImages(offer);
      if (images.length < 5) throw new Error(`accepted_gallery_underflow:${offer.sourceOfferId}:${images.length}`);
      accepted.push(safeAccepted(offer, images, row, page));
    }
    detailPageReports.push({ page, returnedRows: rawRows.length, health: result.health || null });
  }

  const minTotal = Math.min(...totals);
  const maxTotal = Math.max(...totals);
  const totalDrift = maxTotal - minTotal;
  const lastPage = pageReports.at(-1);
  const fullListRequested = requestedPageCount === expectedPageCount;
  const rawAccounting = pageReports.reduce((sum, row) => sum + row.rawRows, 0);
  const identityAccounting = pageReports.reduce((sum, row) => sum + row.identityRows + row.rejectedIdentityRows, 0);
  const acceptedMakes = [...new Set(accepted.map((row) => row.make))];
  const acceptedPages = [...new Set(accepted.map((row) => row.page))];
  const suspiciousAccepted = accepted.filter((row) => goodCarManualPriceReviewReason(row));

  const checks = {
    classificationExactCatalog: decision?.class === 'exact_catalog',
    classificationPublishAllowedFalse: decision?.publishAllowed === false,
    productionAllowlistStillBlocksCandidate: isAllowedCatalogSourceId('china', SOURCE_ID) === false,
    sourceTotalAtLeastOneThousand: initialTotal >= 1000,
    fullListExhaustionRequested: fullListRequested,
    scannedExpectedPageCount: pageReports.length === expectedPageCount,
    everyNonFinalPageFull: pageReports.slice(0, -1).every((row) => row.rawRows === GOOD_CAR_CARSLIST_PAGE_SIZE),
    finalPageNonEmptyAndBounded: Boolean(lastPage && lastPage.rawRows > 0 && lastPage.rawRows <= GOOD_CAR_CARSLIST_PAGE_SIZE),
    rawIdentityAccountingExact: rawAccounting === identityAccounting,
    noRawDuplicatesAcrossFullList: duplicateRawIds.length === 0,
    noIdentityDuplicatesAcrossFullList: duplicateIdentityIds.length === 0,
    totalDriftWithinOnePage: totalDrift <= GOOD_CAR_CARSLIST_PAGE_SIZE,
    rawCoverageMatchesStableTotal: totalDrift === 0 ? rawIds.size === initialTotal : rawIds.size >= minTotal - GOOD_CAR_CARSLIST_PAGE_SIZE,
    stratifiedPagesIncludeFirstAndLast: samplePages[0] === 1 && samplePages.at(-1) === expectedPageCount,
    stratifiedDetailPagesHealthy: detailPageReports.every((row) => row.health?.ok === true),
    acceptedAcrossMultiplePages: acceptedPages.length >= 2,
    acceptedAcrossMultipleMakes: acceptedMakes.length >= 3,
    allAcceptedExactPassengerIce: accepted.every((row) => row.sourceCurrency === 'USD' && row.engineCc > 0 && row.powerKw > 0 && row.powerHp > 0 && row.imageCount >= 5),
    manualPriceReviewObservedAndBlocked: blockedManualPriceReview.length > 0,
    noManualPriceReviewRowsAccepted: suspiciousAccepted.length === 0,
  };
  const failures = Object.entries(checks).filter(([, ok]) => ok !== true).map(([name]) => name);

  const payload = {
    version: 2,
    generatedAt: new Date().toISOString(),
    mode: 'chngoodcar_full_list_exhaustion_stratified_detail_manual_price_review_no_write',
    productionWrites: false,
    classificationMutations: false,
    publishAllowedMutations: false,
    objectStorageWrites: false,
    catalogGenerationWrites: false,
    productionAllowlisted: isAllowedCatalogSourceId('china', SOURCE_ID),
    sourceId: SOURCE_ID,
    sourceClass: decision?.class || null,
    sourcePublishAllowed: decision?.publishAllowed ?? null,
    initialTotal,
    expectedPageCount,
    requestedPageCount,
    pageSize: GOOD_CAR_CARSLIST_PAGE_SIZE,
    sourceTotals: { min: minTotal, max: maxTotal, drift: totalDrift },
    uniqueRawIds: rawIds.size,
    uniqueIdentityIds: identityIds.size,
    rejectedIdentityReasons,
    duplicateRawIds: [...new Set(duplicateRawIds)].slice(0, 50),
    duplicateIdentityIds: [...new Set(duplicateIdentityIds)].slice(0, 50),
    pageReports,
    stratifiedSamplePages: samplePages,
    detailPageReports,
    coverage: {
      acceptedCount: accepted.length,
      rejectedPassengerIceCount: rejected.length,
      blockedManualPriceReviewCount: blockedManualPriceReview.length,
      blockedIdentityElectrifiedCount: blockedIdentityElectrified.length,
      blockedReferenceConflictCount: blockedReferenceConflicts.length,
      blockedElectrifiedCount: blockedElectrified.length,
      blockedNonPassengerCount: blockedNonPassenger.length,
      acceptedMakes,
      acceptedPages,
    },
    acceptedSamples: accepted.slice(0, 40),
    rejectedSamples: rejected.slice(0, 40),
    blockedManualPriceReview: blockedManualPriceReview.slice(0, 30),
    blockedIdentityElectrified: blockedIdentityElectrified.slice(0, 30),
    blockedReferenceConflicts: blockedReferenceConflicts.slice(0, 30),
    checks,
    failures,
    next: failures.length
      ? 'repair the reviewed exact gate from this no-write evidence before source promotion'
      : 'full list pagination is exhausted and stratified reviewed exact sampling is green; keep publishAllowed=false until manual spot-check and a separate production-promotion decision',
  };
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(payload, null, 2));
  console.log(JSON.stringify({
    output: OUTPUT_PATH,
    initialTotal,
    expectedPageCount,
    requestedPageCount,
    uniqueRawIds: rawIds.size,
    uniqueIdentityIds: identityIds.size,
    totalDrift,
    samplePages,
    accepted: accepted.length,
    blockedManualPriceReview: blockedManualPriceReview.length,
    acceptedMakes,
    failures,
  }, null, 2));
  if (failures.length) throw new Error(`chngoodcar_list_exhaustion_v2_failed:${failures.join(',')}`);
  return payload;
}

if (import.meta.url === new URL(process.argv[1], 'file:').href) {
  runGoodCarListExhaustionV2().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
