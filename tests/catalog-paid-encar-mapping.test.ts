import test, {mock} from 'node:test';
import assert from 'node:assert/strict';
import {normalizePaidEncarOffer} from '../scripts/lib/paid-encar-offer.mjs';
import {EncarDirectAdapter} from '../apps/web/lib/catalog/adapters';
import {LocalJsonStorage} from '../apps/web/lib/data';
import {resetCatalogRateCache} from '../apps/web/lib/catalog/rates';
import {prepareSellerInventory} from '../apps/web/lib/catalog/prepare-seller-inventory';
import {normalizeVehicleOfferSpecs} from '../apps/web/lib/catalog/spec-normalization';
import {classifySpecificationEvidence} from '../apps/web/lib/catalog/specification-evidence-audit';
import {compactPublicStorageOffer, publicOffer, searchProjectionFromOffer} from '../apps/web/lib/catalog/storage';

const observedAt = '2026-11-16T15:00:00.000Z';
const adapter = new EncarDirectAdapter();
// Only these reported technical fields/IDs come from the supplier discussion.
// Year, price, mileage and image below are synthetic publication fixtures, not
// a claim about a complete saved/live listing.
const reported = [
  {inner_id: '42799484', mark: 'Kia', model: 'Morning', configuration: 'GT Line', engine_type: 'Бензин', displacement_cc: 998, power: 76},
  {inner_id: '42760061', mark: 'Kia', model: 'Seltos', configuration: '1.6T 2WD', engine_type: 'Бензин', displacement_cc: 1598, power: 193, drive_type: '2WD'},
];
function data(patch: Record<string, unknown> = {}) {
  return {...reported[0], year: 2024, price: 12000000, currency: 'KRW', km_age: 12000,
    transmission_type: 'Автомат', ...patch};
}
function withPhoto(offer: any) {
  offer.images = Array.from({length: 5}, (_, i) => ({id: '',
    url: `https://ci.encar.com/carpicture04/pic4279/${offer.sourceOfferId}_${String(i + 1).padStart(3, '0')}.jpg`,
    objectKey: '', checksum: '', size: 0, mimeType: 'image/jpeg'}));
  Object.assign(offer.operational, {provider: 'auto_api_encar', exactDetail: true, detailIdentityVerified: true,
    exactPhotos: true, photoIdentityVerified: true, galleryImageCount: offer.images.length});
  return offer;
}
function mapped(patch: Record<string, unknown> = {}) {
  const row = data(patch);
  return withPhoto(normalizePaidEncarOffer(row, {id: row.inner_id, observedAt, adapter}));
}
function previousMapping(row: ReturnType<typeof data>) {
  // The exact pre-fix restorer argument list: Power and field provenance were
  // absent even when the saved v3 row supplied them.
  const d: any = row;
  return withPhoto(adapter.normalizeOffer({Id: d.inner_id, Manufacturer: d.mark, Model: d.model, FormYear: d.year,
    Price: d.price, Badge: d.configuration, BadgeDetail: d.complectation, Mileage: d.km_age,
    FuelType: d.engine_type, Transmission: d.transmission_type, DriveType: d.drive_type,
    Category: d.body_type, Displacement: d.displacement_cc, Color: d.color, UpdatedDate: observedAt}));
}
async function withOfflinePublication(run: () => Promise<void>) {
  const previous = process.env.CATALOG_LIVE_RATE_DISABLED;
  process.env.CATALOG_LIVE_RATE_DISABLED = 'true'; resetCatalogRateCache();
  mock.timers.enable({apis: ['Date'], now: new Date(observedAt)});
  const rates = {updatedAt: observedAt,
    KRW: {cbrRate: 6, nominal: 100, rateDate: observedAt, rateSource: 'cbr'},
    EUR: {cbrRate: 100, nominal: 1, rateDate: observedAt, rateSource: 'cbr'},
    USD: {cbrRate: 90, nominal: 1, rateDate: observedAt, rateSource: 'cbr'}};
  // No knowledge variants or business configuration are invented. Both the
  // complete-calculation attempt and seller fallback use the actual code.
  const read = mock.method(LocalJsonStorage.prototype, 'readJsonWithMeta', async (key: string) =>
    ({found: true, value: key === 'fees/exchange-rates.json' ? rates : []}));
  const write = mock.method(LocalJsonStorage.prototype, 'writeJson', async () => {throw Error('unexpected_test_write');});
  try {await run();}
  finally {
    read.mock.restore(); write.mock.restore(); mock.timers.reset(); resetCatalogRateCache();
    if (previous === undefined) delete process.env.CATALOG_LIVE_RATE_DISABLED;
    else process.env.CATALOG_LIVE_RATE_DISABLED = previous;
  }
}

test('paid v3 maps reported cc and total hp with field-bound source evidence', () => {
  for (const row of reported) {
    const offer = mapped(row);
    assert.equal(offer.engineCc, row.displacement_cc); assert.equal(offer.powerHp, row.power);
    assert.equal(offer.fuel, 'petrol'); assert.equal(offer.powertrainKind, 'combustion');
    assert.equal(offer.powerDataConfidence, 'source_exact');
    assert.equal(offer.powerDataSource, 'auto_api_encar:v3:power');
    for (const field of ['year', 'fuelPowertrain', 'engineCc', 'powerHp'] as const)
      assert.equal(classifySpecificationEvidence(offer, field).state, 'exact', field);
    assert.equal(offer.operational.semanticEvidence.engineCc.unit, 'cm3');
    assert.equal(offer.operational.sourcePower.totalHp.unit, 'hp');
  }
  const hundred = mapped({power: 100});
  assert.equal(hundred.powerHp, 100); assert.equal(classifySpecificationEvidence(hundred, 'powerHp').state, 'exact');
});

test('v3 never mistakes litres, ranges, units or invalid values for exact source numbers', () => {
  for (const cc of [undefined, null, 1.598, '1.6', '1598 cc', '1500-2000', true, 0, -1598]) {
    const offer = mapped({displacement_cc: cc, displacement: 1.6, configuration: '1.6 L 76 hp'});
    assert.equal(offer.engineCc, undefined);
    assert.notEqual(offer.operational.semanticEvidence.engineCc.status, 'exact');
    assert.equal(offer.operational.sourceDisplacementLitres, 1.6);
  }
  for (const power of [undefined, null, '76 kW', '76-90', true, -76, 0, 9999]) {
    const offer = mapped({power, configuration: '76 hp'});
    assert.equal(offer.powerHp, undefined); assert.equal(offer.powerKw, undefined);
    assert.notEqual(offer.powerDataConfidence, 'source_exact');
  }
  const exact = mapped({displacement_cc: 1598, displacement: 1.6, power: '193'});
  assert.equal(exact.engineCc, 1598); assert.equal(exact.powerHp, 193);
  assert.equal(mapped({displacement_cc: undefined, displacement: '2996'}).engineCc, undefined);
});

test('reported fields survive actual seller publication, compact storage and public projection', async () => {
  await withOfflinePublication(async () => {
    for (const row of reported) {
      const old = previousMapping(data(row));
      assert.equal(old.powerHp, undefined, 'pre-fix restorer omitted source power');
      const oldPublished = await prepareSellerInventory(old);
      assert.ok(oldPublished); assert.equal(oldPublished.engineCc, undefined);
      assert.equal(oldPublished.fuel, undefined); assert.equal(oldPublished.powerHp, undefined);
      const prepared = await prepareSellerInventory(normalizeVehicleOfferSpecs(mapped(row)));
      assert.ok(prepared);
      const compact = compactPublicStorageOffer(prepared);
      assert.equal(compact.operational?.raw, undefined);
      for (const published of [prepared, compact, publicOffer(compact), searchProjectionFromOffer(compact)]) {
        assert.equal(published.engineCc, row.displacement_cc);
        assert.equal(published.powerHp, row.power); assert.equal(published.fuel, 'petrol');
        assert.equal(published.powertrainKind, 'combustion');
        assert.equal(published.drive || undefined, undefined, '2WD/missing axle must not reappear as FWD');
      }
    }
  });
});

test('2WD stays unassigned without excluding the listing; explicit driven axles remain usable', async () => {
  const offer = mapped(reported[1]);
  assert.equal(offer.drive, undefined);
  assert.equal(offer.operational.semanticEvidence.drive.status, 'missing');
  assert.equal(offer.operational.semanticEvidence.drive.reason, 'driven_axle_unspecified');
  assert.equal(offer.operational.sourceDriveEvidence.status, 'ambiguous');
  assert.equal(offer.operational.sourceDriveEvidence.rawValue, '2WD');
  for (const [drive_type, expected] of [['FWD', 'fwd'], ['RWD', 'rwd'], ['AWD', 'awd'], ['4WD', 'awd'], ['2WD', undefined], ['4x2', undefined]]) {
    await withOfflinePublication(async () => {
      const prepared = await prepareSellerInventory(normalizeVehicleOfferSpecs(mapped({drive_type})));
      assert.ok(prepared); assert.equal(publicOffer(compactPublicStorageOffer(prepared)).drive, expected);
    });
  }
});

test('hybrid total hp and electric peak kW never become ICE or certified utilization power', async () => {
  await withOfflinePublication(async () => {
    const hybrid = mapped({engine_type: 'Бензин + Электричество', power: 227, power_ice_hp: 180, power_electro_kw: 44.2,
      displacement_cc: 1598, model: 'Niro', configuration: 'Hybrid'});
    assert.equal(hybrid.powertrainKind, 'other_hybrid'); assert.equal(hybrid.powerHp, 227);
    assert.equal(hybrid.icePowerKw, Math.round(180 / 1.35962 * 1000000) / 1000000);
    assert.equal(hybrid.motorPeakKw, 44.2);
    const noIce = mapped({engine_type: 'Гибрид', power: 227, power_electro_kw: 44.2, model: 'Niro', configuration: 'Hybrid'});
    assert.equal(noIce.icePowerKw, undefined, 'system power does not prove ICE output');
    for (const source of [hybrid, noIce, mapped({engine_type: 'Электро', displacement_cc: null, power: 204, power_electro_kw: 150, model: 'EV6', configuration: ''})]) {
      const normalized = normalizeVehicleOfferSpecs(source);
      const prepared = await prepareSellerInventory(normalized);
      assert.ok(prepared); assert.equal(prepared.totalRub, null); assert.equal(prepared.catalogPricingMode, 'seller');
      for (const published of [source, normalized, prepared, searchProjectionFromOffer(compactPublicStorageOffer(prepared))]) {
        assert.equal(published.power30MinKw, undefined); assert.equal(published.power30MinKwByMotor, undefined);
        assert.equal(published.utilizationPowerKw, undefined);
        if (source === noIce) assert.equal(published.icePowerKw, undefined, 'missing hybrid ICE power cannot be inferred from total hp');
      }
    }
    const conflicting = mapped({power: 193, power_ice_hp: 160, displacement_cc: 1598});
    assert.equal(conflicting.powerHp, undefined); assert.equal(conflicting.operational.semanticEvidence.powerHp.status, 'conflict');
    const unclassifiedHybrid = mapped({power: 193, power_electro_kw: 12, displacement_cc: 1598});
    assert.equal(classifySpecificationEvidence(unclassifiedHybrid, 'fuelPowertrain').state, 'ambiguous');
  });
});

test('legacy adapter contract remains separate from the paid v3 mapper', () => {
  const legacy = adapter.normalizeOffer({Id: 'legacy-fixture', Manufacturer: 'Kia', Model: 'Cerato', FormYear: 2024,
    Price: 1200, FuelType: 'Gasoline', Displacement: '1998', Power: '150', DriveType: 'FWD', UpdatedDate: observedAt});
  assert.ok(legacy); assert.equal(legacy.sourcePrice, 12000000);
  assert.equal(legacy.engineCc, 1998); assert.equal(legacy.powerHp, 150); assert.equal(legacy.drive, 'fwd');
});

test('coarse hybrid fuel permits an explicit series or plug-in identity without hiding fuel contradictions', async () => {
  await withOfflinePublication(async () => {
    const note = {mark: 'Nissan', model: 'Note', configuration: 'e-POWER', engine_type: 'Гибрид',
      displacement_cc: 1198, power: 136, power_ice_hp: 82, power_electro_kw: 100};
    for (const [patch, expectedKind] of [[note, 'series_hybrid'],
      [{...note, mark: 'Kia', model: 'Niro', configuration: 'PHEV'}, 'other_hybrid']] as const) {
      const source = mapped(patch);
      assert.equal(source.powertrainKind, expectedKind);
      assert.equal(source.operational.semanticEvidence.fuel.status, 'exact');
      assert.equal(source.operational.semanticEvidence.powertrainKind.status, 'exact');
      if (expectedKind === 'series_hybrid')
        assert.equal(source.operational.semanticEvidence.powertrainKind.source, 'auto_api_encar:v3:engine_type+identity_name');
      const normalized = normalizeVehicleOfferSpecs(source);
      assert.equal(classifySpecificationEvidence(normalized, 'fuelPowertrain').state, 'exact');
      const prepared = await prepareSellerInventory(normalized);
      assert.ok(prepared);
      for (const row of [source, normalized, prepared, publicOffer(compactPublicStorageOffer(prepared)),
        searchProjectionFromOffer(compactPublicStorageOffer(prepared))]) {
        assert.equal(row.fuel, 'hybrid'); assert.equal(row.powertrainKind, expectedKind);
        assert.equal(row.engineCc, 1198); assert.equal(row.powerHp, 136);
        assert.equal(row.power30MinKw, undefined); assert.equal(row.utilizationPowerKw, undefined);
      }
      assert.equal(prepared.icePowerKw, Math.round(82 / 1.35962 * 100) / 100);
      assert.equal(prepared.operational?.sourcePower.iceHp.value, 82);
      assert.equal(prepared.motorPeakKw, 100);
      assert.equal(prepared.totalRub, null);
    }
    for (const patch of [{...note, engine_type: 'Бензин'}, {...note, engine_type: 'Электро'},
      {...note, engine_type: 'Parallel hybrid'}, {...note, model: 'EV6', configuration: 'BEV', engine_type: 'Гибрид'}]) {
      const source = mapped(patch);
      assert.equal(source.operational.semanticEvidence.fuel.status, 'conflict');
      assert.equal(classifySpecificationEvidence(normalizeVehicleOfferSpecs(source), 'fuelPowertrain').state, 'conflict');
      const prepared = await prepareSellerInventory(normalizeVehicleOfferSpecs(source));
      if (prepared) {
        assert.equal(classifySpecificationEvidence(prepared, 'fuelPowertrain').state, 'conflict');
        assert.equal(prepared.fuel, undefined); assert.equal(prepared.totalRub, null);
      }
    }
  });
});
