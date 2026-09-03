import fs from 'node:fs/promises';
import {
  ChnGoodCarExactAdapter,
  isGoodCarIceFuel,
  type GoodCarExactRawOffer,
} from '../apps/web/lib/catalog/chngoodcar-exact-source';
import { isAllowedCatalogSourceId } from '../apps/web/lib/catalog/required-catalog-sources';

const OUTPUT_PATH = process.env.CATALOG_SOURCE_CHNGOODCAR_EXACT_DRY_RUN_OUTPUT || 'catalog-source-chngoodcar-exact-dry-run-v1.json';
const SOURCE_ID = 'chngoodcar_china_candidate';

async function classificationDecision() {
  const payload = JSON.parse(await fs.readFile('data/catalog/source-partial-classification-v1.json', 'utf8'));
  return payload.decisions?.find((row: any) => row.sourceId === SOURCE_ID) || null;
}

function safeOfferSample(offer: any, images: any[]) {
  return {
    sourceOfferId: offer.sourceOfferId,
    sourceUrl: offer.operational?.sourceUrl,
    sourceTitle: offer.sourceTitle,
    make: offer.make,
    model: offer.model,
    year: offer.year,
    productionDate: offer.productionDate,
    mileageKm: offer.mileageKm,
    engineCc: offer.engineCc,
    fuel: offer.fuel,
    powertrainKind: offer.powertrainKind,
    powerKw: offer.powerKw,
    powerHp: offer.powerHp,
    powerDataConfidence: offer.powerDataConfidence,
    powerDataSource: offer.powerDataSource,
    bodyType: offer.bodyType,
    transmission: offer.transmission,
    drive: offer.drive,
    sourcePrice: offer.sourcePrice,
    sourceCurrency: offer.sourceCurrency,
    imageCount: images.length,
    imageSample: images.slice(0, 5).map((image) => image.url),
    listDetailPriceParity: offer.operational?.raw?.listDetailPriceParity,
    listDetailTitleParity: offer.operational?.raw?.listDetailTitleParity,
  };
}

export async function runGoodCarExactDryRun() {
  const decision = await classificationDecision();
  const adapter = new ChnGoodCarExactAdapter();
  const page = await adapter.fetchPage('1');
  const rawRows = page.items as GoodCarExactRawOffer[];
  const normalized = [] as Array<{ offer: any; images: any[] }>;
  const blockedElectrified: string[] = [];
  const rejectedIce: Array<{ sourceOfferId: string; sourceTitle: string; fuel: string; reasons: string[] }> = [];

  for (const row of rawRows) {
    const offer = adapter.normalizeOffer(row);
    if (!isGoodCarIceFuel(row.fuel)) {
      if (offer) throw new Error(`electrified_offer_must_fail_closed:${row.sourceOfferId}:${row.fuel}`);
      blockedElectrified.push(row.sourceOfferId);
      continue;
    }
    if (!offer) {
      const reasons = [] as string[];
      if (!row.currencyLabelVerified) reasons.push('currency_contract');
      if (!row.listDetailPriceParity) reasons.push('price_parity');
      if (!row.listDetailTitleParity) reasons.push('title_parity');
      if (!(row.engineCc > 0)) reasons.push('engine_cc');
      if (!(row.powerKw > 0)) reasons.push('power_kw');
      if ((row.imageUrls?.length || 0) < 5) reasons.push('gallery');
      if (!reasons.length) reasons.push('identity_make_model_gate');
      rejectedIce.push({ sourceOfferId: row.sourceOfferId, sourceTitle: row.sourceTitle, fuel: row.fuel, reasons });
      continue;
    }
    const images = await adapter.fetchImages(offer);
    if (images.length < 5) throw new Error(`normalized_offer_gallery_underflow:${offer.sourceOfferId}:${images.length}`);
    normalized.push({ offer, images });
  }

  const makes = [...new Set(normalized.map(({ offer }) => offer.make))];
  const fuels = [...new Set(normalized.map(({ offer }) => offer.fuel))];
  const powerPairs = normalized.map(({ offer }) => ({ sourceOfferId: offer.sourceOfferId, powerKw: offer.powerKw, powerHp: offer.powerHp }));
  const checks = {
    classificationExactCatalog: decision?.class === 'exact_catalog',
    classificationPublishAllowedFalse: decision?.publishAllowed === false,
    productionAllowlistStillBlocksCandidate: isAllowedCatalogSourceId('china', SOURCE_ID) === false,
    noProductionWrites: true,
    parsedAtLeastFourOffers: rawRows.length >= 4,
    normalizedAtLeastTwoIceOffers: normalized.length >= 2,
    atLeastTwoMakes: makes.length >= 2,
    allNormalizedUsd: normalized.every(({ offer }) => offer.sourceCurrency === 'USD'),
    allNormalizedCombustion: normalized.every(({ offer }) => offer.powertrainKind === 'combustion'),
    allNormalizedExactPower: normalized.every(({ offer }) => offer.powerDataConfidence === 'source_exact' && Number(offer.powerKw) > 0 && Number(offer.powerHp) > 0),
    allNormalizedHaveExactEngine: normalized.every(({ offer }) => Number(offer.engineCc) > 0),
    allNormalizedHaveGallery: normalized.every(({ images }) => images.length >= 5),
    allNormalizedHaveListDetailParity: normalized.every(({ offer }) => offer.operational?.raw?.listDetailPriceParity === true && offer.operational?.raw?.listDetailTitleParity === true),
    allElectrifiedFailClosed: rawRows.filter((row) => !isGoodCarIceFuel(row.fuel)).every((row) => adapter.normalizeOffer(row) === null),
  };
  const failures = Object.entries(checks).filter(([, ok]) => ok !== true).map(([name]) => name);
  const payload = {
    version: 1,
    generatedAt: new Date().toISOString(),
    mode: 'chngoodcar_exact_adapter_live_dry_run_no_write',
    productionWrites: false,
    classificationMutations: false,
    publishAllowedMutations: false,
    objectStorageWrites: false,
    catalogGenerationWrites: false,
    sourceId: SOURCE_ID,
    sourceClass: decision?.class || null,
    sourcePublishAllowed: decision?.publishAllowed ?? null,
    productionAllowlisted: isAllowedCatalogSourceId('china', SOURCE_ID),
    discovery: {
      reportedCount: page.count ?? null,
      parsedCount: rawRows.length,
      health: page.health || null,
      note: 'v1 canary discovers current public offer links from the Good Car homepage; CarsList is used as the explicit USD currency contract. Full CarsList pagination is not promoted by this dry-run.',
    },
    coverage: {
      normalizedIceCount: normalized.length,
      blockedElectrifiedCount: blockedElectrified.length,
      rejectedIceCount: rejectedIce.length,
      distinctMakes: makes,
      distinctFuels: fuels,
    },
    checks,
    failures,
    powerPairs,
    normalizedSamples: normalized.slice(0, 10).map(({ offer, images }) => safeOfferSample(offer, images)),
    blockedElectrified,
    rejectedIce: rejectedIce.slice(0, 20),
    next: failures.length
      ? 'repair adapter/dry-run evidence before any source promotion'
      : 'manual source-page spot-check of normalized samples; keep publishAllowed=false until that checkpoint and full discovery/pagination readiness are recorded',
  };

  await fs.writeFile(OUTPUT_PATH, JSON.stringify(payload, null, 2));
  console.log(JSON.stringify({ output: OUTPUT_PATH, parsed: rawRows.length, normalizedIce: normalized.length, blockedElectrified: blockedElectrified.length, failures }, null, 2));
  if (failures.length) throw new Error(`chngoodcar_exact_dry_run_failed:${failures.join(',')}`);
  return payload;
}

if (import.meta.url === new URL(process.argv[1], 'file:').href) {
  runGoodCarExactDryRun().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
