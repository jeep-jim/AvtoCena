import fs from 'node:fs/promises';
import {
  ChnGoodCarPaginatedExactAdapter,
  type GoodCarPaginatedExactRawOffer,
} from '../apps/web/lib/catalog/chngoodcar-paginated-exact-source';
import { GoodCarCarsListClient } from '../apps/web/lib/catalog/chngoodcar-carslist';
import { isGoodCarIceFuel, isGoodCarPassengerBodyType } from '../apps/web/lib/catalog/chngoodcar-exact-source';
import { isAllowedCatalogSourceId } from '../apps/web/lib/catalog/required-catalog-sources';

const OUTPUT_PATH = process.env.CATALOG_SOURCE_CHNGOODCAR_PAGINATED_SCALE_OUTPUT || 'catalog-source-chngoodcar-paginated-scale-v1.json';
const SOURCE_ID = 'chngoodcar_china_candidate';
const MAX_PAGES = Math.max(4, Math.min(8, Number(process.env.CATALOG_CHNGOODCAR_SCALE_MAX_PAGES || 5)));

async function classificationDecision() {
  const payload = JSON.parse(await fs.readFile('data/catalog/source-partial-classification-v1.json', 'utf8'));
  return payload.decisions?.find((row: any) => row.sourceId === SOURCE_ID) || null;
}

function rejectionReasons(row: GoodCarPaginatedExactRawOffer) {
  const reasons: string[] = [];
  if (row.listCurrencyVerified !== true || row.currencyLabelVerified !== true) reasons.push('currency_contract');
  if (row.listDetailTitleParity !== true) reasons.push('title_parity');
  if (row.listDetailPriceParity !== true) reasons.push('price_parity');
  if (row.listDetailProductionDateParity !== true) reasons.push('production_date_parity');
  if (row.listDetailMileageParity !== true) reasons.push('mileage_parity');
  if (!isGoodCarIceFuel(row.fuel)) reasons.push('electrified_or_non_ice');
  if (!isGoodCarPassengerBodyType(row.bodyType)) reasons.push('non_passenger_or_missing_body');
  if (!(row.engineCc > 0)) reasons.push('engine_cc');
  if (!(row.powerKw > 0)) reasons.push('power_kw');
  if ((row.imageUrls?.length || 0) < 5) reasons.push('gallery');
  if (!reasons.length) reasons.push('identity_make_model_gate');
  return reasons;
}

function safeAccepted(offer: any, images: any[], raw: GoodCarPaginatedExactRawOffer) {
  return {
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
    listFuelName: raw.listFuelName || null,
    listVehicleTypeName: raw.listVehicleTypeName || null,
    listDetailTitleParity: raw.listDetailTitleParity,
    listDetailPriceParity: raw.listDetailPriceParity,
    listDetailProductionDateParity: raw.listDetailProductionDateParity,
    listDetailMileageParity: raw.listDetailMileageParity,
  };
}

export async function runGoodCarPaginatedScale() {
  const decision = await classificationDecision();
  const listClient = new GoodCarCarsListClient();
  const adapter = new ChnGoodCarPaginatedExactAdapter();
  const listIds = new Set<string>();
  const joinedIds = new Set<string>();
  const totals: number[] = [];
  const pageReports: any[] = [];
  const accepted: any[] = [];
  const rejected: any[] = [];
  const blockedElectrified: string[] = [];
  const blockedNonPassenger: string[] = [];
  const listFuelDisagreements: any[] = [];

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const listPage = await listClient.fetchPage(page);
    totals.push(listPage.total);
    const pageListIds = listPage.items.map((row) => row.sourceOfferId);
    const duplicatesBefore = pageListIds.filter((id) => listIds.has(id));
    pageListIds.forEach((id) => listIds.add(id));

    const result = await adapter.fetchPage(String(page));
    const rawRows = result.items as GoodCarPaginatedExactRawOffer[];
    const pageJoinedIds = rawRows.map((row) => row.sourceOfferId);
    const joinedDuplicatesBefore = pageJoinedIds.filter((id) => joinedIds.has(id));
    pageJoinedIds.forEach((id) => joinedIds.add(id));

    for (const row of rawRows) {
      if (row.listFuelName && row.listFuelName !== row.fuel) {
        listFuelDisagreements.push({ sourceOfferId: row.sourceOfferId, listFuelName: row.listFuelName, detailFuel: row.fuel, sourceTitle: row.sourceTitle });
      }
      const offer = adapter.normalizeOffer(row);
      if (!isGoodCarIceFuel(row.fuel)) {
        if (offer) throw new Error(`electrified_offer_must_fail_closed:${row.sourceOfferId}:${row.fuel}`);
        blockedElectrified.push(row.sourceOfferId);
        continue;
      }
      if (!isGoodCarPassengerBodyType(row.bodyType)) {
        if (offer) throw new Error(`non_passenger_offer_must_fail_closed:${row.sourceOfferId}:${row.bodyType}`);
        blockedNonPassenger.push(row.sourceOfferId);
        continue;
      }
      if (!offer) {
        rejected.push({ sourceOfferId: row.sourceOfferId, sourceTitle: row.sourceTitle, reasons: rejectionReasons(row) });
        continue;
      }
      const images = await adapter.fetchImages(offer);
      if (images.length < 5) throw new Error(`accepted_gallery_underflow:${offer.sourceOfferId}:${images.length}`);
      accepted.push(safeAccepted(offer, images, row));
    }

    pageReports.push({
      page,
      sourceTotal: listPage.total,
      listRows: listPage.items.length,
      listIds: pageListIds,
      listDuplicateIdsFromPriorPages: duplicatesBefore,
      joinedDetailRows: rawRows.length,
      joinedIds: pageJoinedIds,
      joinedDuplicateIdsFromPriorPages: joinedDuplicatesBefore,
      health: result.health || null,
      nextCursor: result.nextCursor ?? null,
      finished: result.finished ?? false,
    });
  }

  const stableTotal = totals.length === MAX_PAGES && totals.every((value) => value === totals[0]);
  const allListPagesFull = pageReports.every((row) => row.listRows === 15);
  const noListDuplicates = pageReports.every((row) => row.listDuplicateIdsFromPriorPages.length === 0);
  const noJoinedDuplicates = pageReports.every((row) => row.joinedDuplicateIdsFromPriorPages.length === 0);
  const noDetailNetworkErrors = pageReports.every((row) => row.health?.ok === true);
  const allAcceptedParity = accepted.every((row) => row.listDetailTitleParity && row.listDetailPriceParity && row.listDetailProductionDateParity && row.listDetailMileageParity);
  const allAcceptedExact = accepted.every((row) => row.sourceCurrency === 'USD' && row.engineCc > 0 && row.powerKw > 0 && row.powerHp > 0 && isGoodCarIceFuel(row.fuel) && isGoodCarPassengerBodyType(row.bodyType) && row.imageCount >= 5);
  const makes = [...new Set(accepted.map((row) => row.make))];
  const checks = {
    classificationExactCatalog: decision?.class === 'exact_catalog',
    classificationPublishAllowedFalse: decision?.publishAllowed === false,
    productionAllowlistStillBlocksCandidate: isAllowedCatalogSourceId('china', SOURCE_ID) === false,
    stableSourceTotal: stableTotal,
    sourceTotalAtLeastOneThousand: Number(totals[0] || 0) >= 1000,
    scannedAtLeastFourPages: MAX_PAGES >= 4,
    allListPagesFull,
    noListDuplicatesAcrossPages: noListDuplicates,
    noJoinedDuplicatesAcrossPages: noJoinedDuplicates,
    noDetailNetworkErrors,
    acceptedAtLeastFive: accepted.length >= 5,
    acceptedAtLeastThreeMakes: makes.length >= 3,
    allAcceptedListDetailParity: allAcceptedParity,
    allAcceptedExactPassengerIce: allAcceptedExact,
    electrifiedRowsObservedAndBlocked: blockedElectrified.length > 0,
  };
  const failures = Object.entries(checks).filter(([, ok]) => ok !== true).map(([name]) => name);
  const payload = {
    version: 1,
    generatedAt: new Date().toISOString(),
    mode: 'chngoodcar_paginated_exact_bounded_scale_no_write',
    productionWrites: false,
    classificationMutations: false,
    publishAllowedMutations: false,
    objectStorageWrites: false,
    catalogGenerationWrites: false,
    productionAllowlisted: isAllowedCatalogSourceId('china', SOURCE_ID),
    sourceId: SOURCE_ID,
    sourceClass: decision?.class || null,
    sourcePublishAllowed: decision?.publishAllowed ?? null,
    requestedPages: MAX_PAGES,
    sourceTotals: totals,
    uniqueListIds: listIds.size,
    uniqueJoinedDetailIds: joinedIds.size,
    pageReports,
    coverage: {
      acceptedCount: accepted.length,
      rejectedPassengerIceCount: rejected.length,
      blockedElectrifiedCount: blockedElectrified.length,
      blockedNonPassengerCount: blockedNonPassenger.length,
      listFuelDisagreementCount: listFuelDisagreements.length,
      distinctAcceptedMakes: makes,
    },
    checks,
    failures,
    acceptedSamples: accepted.slice(0, 20),
    rejectedSamples: rejected.slice(0, 30),
    blockedElectrified: blockedElectrified.slice(0, 30),
    blockedNonPassenger: blockedNonPassenger.slice(0, 30),
    listFuelDisagreements: listFuelDisagreements.slice(0, 30),
    next: failures.length
      ? 'repair the paginated exact adapter from this no-write evidence before increasing scale'
      : 'manually spot-check accepted and disagreement samples, then increase read-only CarsList coverage without changing publishAllowed or production registry',
  };
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(payload, null, 2));
  console.log(JSON.stringify({
    output: OUTPUT_PATH,
    pages: MAX_PAGES,
    sourceTotal: totals[0] ?? null,
    uniqueListIds: listIds.size,
    joinedDetails: joinedIds.size,
    accepted: accepted.length,
    rejectedPassengerIce: rejected.length,
    blockedElectrified: blockedElectrified.length,
    blockedNonPassenger: blockedNonPassenger.length,
    listFuelDisagreements: listFuelDisagreements.length,
    makes,
    failures,
  }, null, 2));
  if (failures.length) throw new Error(`chngoodcar_paginated_scale_failed:${failures.join(',')}`);
  return payload;
}

if (import.meta.url === new URL(process.argv[1], 'file:').href) {
  runGoodCarPaginatedScale().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
