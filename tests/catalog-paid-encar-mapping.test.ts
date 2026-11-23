import test, {mock} from 'node:test';
import assert from 'node:assert/strict';
import {normalizePaidEncarOffer} from '../scripts/lib/paid-encar-offer.mjs';
import {EncarDirectAdapter} from '../apps/web/lib/catalog/adapters';
import {LocalJsonStorage} from '../apps/web/lib/data';
import {resetCatalogRateCache} from '../apps/web/lib/catalog/rates';
import {prepareSellerInventory} from '../apps/web/lib/catalog/prepare-seller-inventory';
import {normalizeVehicleOfferSpecs} from '../apps/web/lib/catalog/spec-normalization';
import {classifySpecificationEvidence} from '../apps/web/lib/catalog/specification-evidence-audit';
import {catalogPowerBand} from '../apps/web/lib/catalog/power-mix';
import {hasKnownMildHybridIdentity} from '../apps/web/lib/catalog/powertrain-safety';
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

test('alternative source fuels stay unresolved through actual seller publication', async () => {
  await withOfflinePublication(async () => {
    for (const engine_type of ['Бензин / Дизель', 'Petrol or diesel', 'Бензин или Дизель',
      'Бензин либо Дизель', 'Бензин или Электричество', 'Бензин или неизвестно']) {
      const offer = mapped({engine_type});
      assert.equal(offer.fuel, undefined); assert.equal(offer.powertrainKind, 'unknown');
      assert.equal(offer.operational.semanticEvidence.fuel.status, 'ambiguous');
      assert.equal(offer.operational.semanticEvidence.fuel.reason, 'alternative_source_fuels');
      assert.equal(offer.operational.semanticEvidence.fuel.rawValue, engine_type);
      assert.equal(classifySpecificationEvidence(offer, 'fuelPowertrain').state, 'ambiguous');
      const prepared = await prepareSellerInventory(normalizeVehicleOfferSpecs(offer));
      assert.ok(prepared, 'unknown fuel alone must not silently remove the listing');
      assert.equal(prepared.fuel, undefined); assert.equal(prepared.powertrainKind, 'unknown');
      assert.equal(prepared.totalRub, null); assert.equal(prepared.catalogPricingMode, 'seller');
    }
    assert.equal(mapped({engine_type: 'Бензин / Gasoline'}).fuel, 'petrol', 'two names for the same fuel are not alternatives');
    for (const engine_type of ['Бензин + Электричество', 'Бензин / Электричество', 'Gasoline/Electricity']) {
      assert.equal(mapped({engine_type, model: 'Niro', configuration: 'Hybrid'}).fuel, 'hybrid');
    }
    assert.equal(mapped({engine_type: 'Gasoline/LPG'}).fuel, 'lpg');
  });
});

test('alternative driven axles never acquire exact single-axis evidence or exclude the listing', async () => {
  await withOfflinePublication(async () => {
    for (const drive_type of ['FWD / RWD', 'FWD or AWD', 'AWD | FWD', 'Передний привод или задний привод', 'FWD or unknown']) {
      const offer = mapped({drive_type});
      assert.equal(offer.drive, undefined);
      assert.equal(offer.operational.semanticEvidence.drive.status, 'missing');
      assert.equal(offer.operational.sourceDriveEvidence.status, 'ambiguous');
      assert.equal(offer.operational.sourceDriveEvidence.rawValue, drive_type);
      const prepared = await prepareSellerInventory(normalizeVehicleOfferSpecs(offer));
      assert.ok(prepared);
      assert.equal(publicOffer(compactPublicStorageOffer(prepared)).drive, undefined);
    }
    assert.equal(mapped({drive_type: 'AWD / 4WD'}).drive, 'awd', 'equivalent source labels remain usable');
  });
});

test('paid v3 fails the entire mapping when a later normalization invents undocumented 30-minute power', () => {
  for (const patch of [
    {configuration: 'Hybrid 30 min 50 kW'},
    {complectation: '30-minute power 50 kW'},
    {configuration: 'Гибрид 30 минут 50 кВт'},
    {configuration: {power30MinKw: 50}},
  ]) {
    const row = data({engine_type: 'Гибрид', model: 'Niro', configuration: 'Hybrid',
      displacement_cc: 1580, power: 141, power_ice_hp: 105, power_electro_kw: 32, ...patch});
    const unchanged = structuredClone(row);
    assert.throws(() => normalizePaidEncarOffer(row, {id: row.inner_id, observedAt, adapter}),
      /^Error: paid_encar_v3_undocumented_30_min_power$/);
    assert.deepEqual(row, unchanged, 'source trim and raw fields must not be rewritten to evade the guard');
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

test('paid v3 retains separately reported hybrid ICE power when total hp is missing', async () => {
  await withOfflinePublication(async () => {
    const patch = {engine_type: 'Гибрид', model: 'Niro', configuration: 'Hybrid', power: null,
      displacement_cc: 1598, power_ice_hp: 105, power_electro_kw: 32};
    const offer = mapped(patch);
    const prepared = await prepareSellerInventory(normalizeVehicleOfferSpecs(offer));
    assert.ok(prepared);
    for (const row of [offer, prepared, compactPublicStorageOffer(prepared)]) {
      assert.ok(Math.abs(row.icePowerKw - 105 / 1.35962) < 0.01, JSON.stringify({stage:row===offer?"mapped":row===prepared?"prepared":"compact",ice:row.icePowerKw,source:row.operational?.semanticEvidence?.powerHp, fuel:row.operational?.semanticEvidence?.fuel}));
      assert.equal(row.power30MinKw, undefined);
      assert.equal(row.utilizationPowerKw, undefined);
    }
    assert.equal(offer.powerHp, undefined);
    assert.equal(offer.operational.semanticEvidence.powerHp.status, 'missing');
    assert.equal(mapped({...patch, engine_type: 'Электро'}).icePowerKw, undefined);
    assert.equal(mapped({...patch, engine_type: 'Бензин'}).icePowerKw, undefined);
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
    const alternative = mapped({...note, engine_type: 'Гибрид или Электро'});
    assert.equal(alternative.fuel, undefined);
    assert.equal(alternative.powertrainKind, 'unknown', 'a named layout cannot resolve an explicit source alternative');
    assert.equal(alternative.operational.semanticEvidence.powertrainKind.source, 'auto_api_encar:v3:engine_type');
    assert.equal(classifySpecificationEvidence(normalizeVehicleOfferSpecs(alternative), 'fuelPowertrain').state, 'ambiguous');
    const unresolved = await prepareSellerInventory(normalizeVehicleOfferSpecs(alternative));
    assert.ok(unresolved);
    assert.equal(unresolved.fuel, undefined); assert.equal(unresolved.totalRub, null);
    assert.throws(() => mapped({...note, configuration: 'e-POWER 30 min 50 kW'}),
      /^Error: paid_encar_v3_undocumented_30_min_power$/,
      'a compatible named hybrid still cannot supply uncertified 30-minute power');
    for (const patch of [{...note, engine_type: 'Бензин'}, {...note, engine_type: 'Электро'},
      {...note, engine_type: 'Parallel hybrid'}, {...note, engine_type: 'Параллельный гибрид'},
      {...note, model: 'EV6', configuration: 'BEV', engine_type: 'Гибрид'}]) {
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

test('paid XC40 B4 reuses its existing mild-hybrid identity through actual publication without certifying power', async () => {
  await withOfflinePublication(async () => {
    // These technical fields identify a saved 45077320093/1 observation.
    // Price, mileage and photos remain synthetic fixtures from data()/mapped().
    const patch = {inner_id:'41593352', mark:'Volvo', model:'XC40', configuration:'B4 Ultimate Bright',
      year:2023, engine_type:'Бензин', displacement_cc:1969, power:197, power_ice_hp:197};
    const source = mapped(patch);
    assert.equal(hasKnownMildHybridIdentity(source), true);
    assert.equal(source.operational.semanticEvidence.fuel.source, 'auto_api_encar:v3:engine_type+identity_name');
    assert.equal(source.operational.semanticEvidence.powerHp.status, 'exact');
    assert.equal(source.operational.sourcePower.totalHp.value, 197);
    assert.equal(source.operational.sourcePower.iceHp.value, 197);
    assert.ok(source.operational.sourceSpecifications.groups.flatMap(group => group.items)
      .some(item => item.name === 'Тип двигателя по данным поставщика' && item.value === 'Бензин'));
    const normalized = normalizeVehicleOfferSpecs(source);
    const prepared = await prepareSellerInventory(normalized);
    assert.ok(prepared);
    for (const row of [source, normalized, prepared, publicOffer(compactPublicStorageOffer(prepared)),
      searchProjectionFromOffer(compactPublicStorageOffer(prepared))]) {
      assert.equal(row.powerHp, 197); assert.equal(row.engineCc, 1969);
      assert.equal(row.fuel, 'hybrid'); assert.equal(row.powertrainKind, 'other_hybrid');
      assert.equal(row.power30MinKw, undefined); assert.equal(row.utilizationPowerKw, undefined);
      assert.equal(catalogPowerBand(row), 'unknown');
    }
    assert.equal(prepared.totalRub, null, 'unknown certified power remains seller-priced');
    assert.equal(mapped({...patch, power:null}).powerHp, undefined, 'no horsepower is invented when the source omits it');
    const low = mapped({...patch, power:150, power_ice_hp:150});
    assert.equal(catalogPowerBand(normalizeVehicleOfferSpecs(low)), 'unknown', 'system hp below160 is not certified power');
    for (const engine_type of ['Дизель', 'Электро', 'Бензин или Электричество']) {
      const rejected = mapped({...patch, engine_type});
      assert.notEqual(rejected.operational.semanticEvidence.fuel.status, 'exact');
    }
    for (const change of [{mark:'Kia'}, {model:'XC60'}, {configuration:'T4'}, {year:2019}])
      assert.equal(hasKnownMildHybridIdentity(mapped({...patch, ...change})), false);
  });
});

test('named hybrid resolutions preserve saved conflicts without explicit provider hybrid identity', () => {
  // Technical examples from the same saved intake; unrelated fixture fields
  // still come from data(). Their mixed source facts are not resolved here.
  for (const patch of [
    {inner_id:'40859072', mark:'Porsche', model:'911', configuration:'Carrera GTS', year:2025,
      engine_type:'Бензин', displacement_cc:3591, power:541, power_ice_hp:485, power_electro_kw:40},
    {inner_id:'38418605', mark:'BMW', model:'X5', configuration:'xDrive 30d M Sport', year:2023,
      engine_type:'Дизель', displacement_cc:2993, power:298, power_ice_hp:286, power_electro_kw:9},
    {inner_id:'41344555', mark:'Mercedes-Benz', model:'GLE-Class', configuration:'GLE300d 4MATIC', year:2022,
      engine_type:'Дизель', displacement_cc:1993, power:272, power_ice_hp:245},
  ]) {
    const offer = mapped(patch);
    assert.equal(hasKnownMildHybridIdentity(offer), false);
    assert.equal(offer.powerHp, undefined);
    assert.equal(offer.operational.semanticEvidence.powerHp.status, 'conflict');
    assert.equal(offer.operational.semanticEvidence.powerHp.reason, 'combustion_total_ice_mismatch');
    assert.equal(offer.operational.sourcePower.totalHp.value, patch.power);
    assert.equal(offer.operational.sourcePower.iceHp.value, patch.power_ice_hp);
  }
});

const namedProviderHybrid = {inner_id:'42054624', mark:'Peugeot', model:'3008', configuration:'1.2 HYbrid Allure', year:2025,
  engine_type:'Бензин', displacement_cc:1199, power:145, power_ice_hp:136, power_electro_kw:15.6};

test('same-row provider Hybrid/HEV names and three exact power fields survive publication without certifying power', async () => {
  await withOfflinePublication(async () => {
    // IDs, retained configuration names and technical measurements come from
    // saved 45077320093/1. Commercial fields/photos are synthetic as above.
    for (const patch of [namedProviderHybrid,
      {...namedProviderHybrid, inner_id:'42207128', model:'408', configuration:'1.2 Hybrid GT'},
      {inner_id:'42434022', mark:'Kia', model:'Seltos', configuration:'HEV 1.6 2WD Signature X Line', year:2026,
        engine_type:'Бензин', displacement_cc:1580, power:141, power_ice_hp:105, power_electro_kw:32},
    ]) {
      const source = mapped(patch);
      assert.equal(source.operational.semanticEvidence.fuel.status, 'exact');
      assert.equal(source.operational.semanticEvidence.fuel.source,
        'auto_api_encar:v3:engine_type+configuration+complectation+power+power_ice_hp+power_electro_kw');
      assert.equal(source.operational.semanticEvidence.powertrainKind.status, 'exact');
      assert.equal(source.operational.semanticEvidence.powerHp.status, 'exact');
      assert.equal(source.operational.sourcePower.totalHp.value, patch.power);
      assert.equal(source.operational.sourcePower.iceHp.value, patch.power_ice_hp);
      assert.equal(source.operational.sourcePower.electricPeakKw.value, patch.power_electro_kw);
      const normalized = normalizeVehicleOfferSpecs(source);
      const prepared = await prepareSellerInventory(normalized);
      assert.ok(prepared);
      const compact = compactPublicStorageOffer(prepared);
      for (const row of [source, normalized, prepared, compact, publicOffer(compact), searchProjectionFromOffer(compact)]) {
        assert.equal(row.powerHp, patch.power); assert.equal(row.engineCc, patch.displacement_cc);
        assert.equal(row.fuel, 'hybrid'); assert.equal(row.powertrainKind, 'other_hybrid');
        assert.equal(row.power30MinKw, undefined); assert.equal(row.power30MinKwByMotor, undefined);
        assert.equal(row.utilizationPowerKw, undefined);
        assert.equal(catalogPowerBand(row), 'unknown', '141/145 system hp must not admit the car to the <=160 certified filter');
      }
      assert.equal(prepared.icePowerKw, Math.round(patch.power_ice_hp / 1.35962 * 100) / 100);
      assert.equal(prepared.motorPeakKw, patch.power_electro_kw);
      assert.equal(prepared.totalRub, null, 'source system/peak power is not certified 30-minute power');
    }
    // The explicit name may be in either documented provider field.
    const trim = mapped({...namedProviderHybrid, configuration:'1.2', complectation:'Hybrid Allure'});
    assert.equal(trim.powertrainKind, 'other_hybrid'); assert.equal(trim.powerHp, 145);
  });
});

test('provider hybrid resolution fails closed for incomplete or incompatible power and incompatible fuels', () => {
  for (const field of ['power', 'power_ice_hp', 'power_electro_kw']) {
    for (const value of [undefined, null, 0, -1, 'unknown']) {
      const source = mapped({...namedProviderHybrid, [field]:value});
      assert.equal(source.powerHp, undefined, field);
      assert.notEqual(source.operational.semanticEvidence.fuel.status, 'exact', field);
      assert.equal(source.power30MinKw, undefined); assert.equal(source.utilizationPowerKw, undefined);
    }
  }
  for (const change of [{power:100}, {power:900}, {power_electro_kw:200}, {power:9999}]) {
    const source = mapped({...namedProviderHybrid, ...change});
    assert.equal(source.powerHp, undefined);
    assert.notEqual(source.operational.semanticEvidence.powerHp.status, 'exact');
  }
  for (const engine_type of ['Дизель', 'Электро', 'Бензин или Электричество', 'Petrol or diesel']) {
    const source = mapped({...namedProviderHybrid, engine_type});
    assert.notEqual(source.operational.semanticEvidence.fuel.status, 'exact');
    assert.equal(source.operational.semanticEvidence.fuel.source, 'auto_api_encar:v3:engine_type');
    assert.equal(source.power30MinKw, undefined); assert.equal(source.utilizationPowerKw, undefined);
  }
  for (const configuration of ['1.2 GT', 'series hybrid', 'BEV']) {
    const source = mapped({...namedProviderHybrid, configuration});
    assert.equal(source.powerHp, undefined);
    assert.notEqual(source.operational.semanticEvidence.fuel.status, 'exact');
  }
  assert.throws(() => mapped({...namedProviderHybrid, configuration:'Hybrid 30 min 50 kW'}),
    /^Error: paid_encar_v3_undocumented_30_min_power$/);
});

test('provider hybrid evidence cannot be supplied by an enriched identity or a foreign source record', () => {
  const normalizeWith = (row: any, modify: (offer: any) => any) => normalizePaidEncarOffer(row,
    {id:row.inner_id, observedAt, adapter:{normalizeOffer(raw: any) {return modify(adapter.normalizeOffer(raw));}}});
  for (const modify of [
    (offer: any) => ({...offer, sourceOfferId:'99999999'}),
    (offer: any) => ({...offer, sourceOfferId:undefined}),
    (offer: any) => ({...offer, sourceId:'foreign_source'}),
    (offer: any) => ({...offer, market:'europe'}),
  ]) {
    const source = normalizeWith(data(namedProviderHybrid), modify);
    assert.equal(source.powerHp, undefined); assert.notEqual(source.operational.semanticEvidence.fuel.status, 'exact');
  }
  for (const extra of [{trim:'1.2 Hybrid Allure'}, {sourceTitle:'Peugeot 3008 Hybrid'},
    {operational:{encyclopediaIdentity:{rawModel:'3008 Hybrid', rawTrim:'Hybrid'}}},
    {operational:{raw:{recommendedTitle:'Peugeot Hybrid'}}}]) {
    const source = normalizeWith(data({...namedProviderHybrid, configuration:'1.2 Allure'}),
      offer => ({...offer, ...extra, operational:{...offer.operational, ...(extra.operational || {})}}));
    assert.equal(source.powerHp, undefined);
    assert.notEqual(source.operational.semanticEvidence.fuel.status, 'exact');
  }
  assert.throws(() => normalizePaidEncarOffer({...data(namedProviderHybrid), inner_id:undefined},
    {id:namedProviderHybrid.inner_id, observedAt, adapter}), /^Error: Encar identity mismatch$/);
});

test('paid v3 equipment and exact listing fields reach the stored detail without seller columns', async () => {
  await withOfflinePublication(async () => {
    const offer = mapped({options: {'Безопасность': ['Камера заднего вида', 'Камера заднего вида'], 'Салон': ['Кожа']},
      generation_code: 'JA', inspection: {engine_code: 'G3LA'}, seat_count: 5, owners_count: 0,
      seller: 'private-seller', address: 'private-address', vin: 'private-vin', drive_type: '2WD'});
    const stored = compactPublicStorageOffer(await prepareSellerInventory(normalizeVehicleOfferSpecs(offer)));
    const snapshot = stored.operational.sourceSpecifications;
    assert.equal(snapshot.sourceOfferId, stored.sourceOfferId);
    const {offerSpecificationGroups} = await import('../apps/web/lib/catalog/offer-specification-groups');
    const values = offerSpecificationGroups(stored).flatMap(group => group.items);
    for (const [name, value] of [['Число мест','5'], ['Число владельцев по данным поставщика','0'],
      ['Код двигателя по акту осмотра','G3LA'], ['Код поколения','JA'], ['Обозначение привода у поставщика','2WD'],
      ['Камера заднего вида','Есть'], ['Кожа','Есть']])
      assert.ok(values.some(item => item.name === name && item.value === value), name);
    assert.equal(stored.drive, undefined);
    assert.doesNotMatch(JSON.stringify(snapshot), /private-seller|private-address|private-vin/);
    assert.equal(values.filter(item => item.name === 'Камера заднего вида').length, 1);
  });
});
